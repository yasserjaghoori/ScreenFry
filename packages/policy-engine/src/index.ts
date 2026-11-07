import { isCommitted } from '@core/commitments';
import { DAY_MS, MINUTE, floorToMinute, localDateKey, minutesSinceMidnight, nextLocalMidnight } from '@core/date';
import { OVERRIDE_MS } from '@core/defaults';
import { urlMatchesDomains } from '@core/domains';
import type { AppState, DayOfWeek, PolicyDecision, PolicyReason, TemporaryOverride, WebsiteRule, WeeklySchedule } from '@shared/index';

const SEARCH_HORIZON_MS = 8 * DAY_MS;

export function isScheduleActive(schedule: WeeklySchedule, date: Date): boolean {
  const day = date.getDay() as DayOfWeek;
  const minute = minutesSinceMidnight(date);
  if (schedule.startMinute === schedule.endMinute) return schedule.days.includes(day);
  if (schedule.startMinute < schedule.endMinute) {
    return schedule.days.includes(day) && minute >= schedule.startMinute && minute < schedule.endMinute;
  }
  if (schedule.days.includes(day) && minute >= schedule.startMinute) return true;
  const previousDay = ((day + 6) % 7) as DayOfWeek;
  return schedule.days.includes(previousDay) && minute < schedule.endMinute;
}

export function scheduleBlocked(rule: Pick<WebsiteRule, 'schedules'>, date: Date): boolean {
  return rule.schedules.some((schedule) => isScheduleActive(schedule, date));
}

export function allowanceMinutes(rule: WebsiteRule, date: Date): number | undefined {
  if (!rule.dailyAllowance) return undefined;
  return rule.dailyAllowance.byWeekday?.[date.getDay() as DayOfWeek] ?? rule.dailyAllowance.defaultMinutes;
}

export function usageFor(state: AppState, ruleId: string, date: Date): number {
  return state.usage[localDateKey(date)]?.millisecondsByRule[ruleId] ?? 0;
}

/**
 * An override is honoured only inside its original window. A start time in the future
 * (clock moved backwards) or a window longer than 10 minutes (edited storage) is ignored.
 */
export function isOverrideActive(override: TemporaryOverride | undefined, now: number): override is TemporaryOverride {
  return Boolean(override && override.startedAt <= now && now < override.expiresAt && override.expiresAt - override.startedAt <= OVERRIDE_MS);
}

/** PIN mode always allows a temporary visit. Future strict mode refuses it while committed. */
export function canOverride(rule: WebsiteRule, now: number): boolean {
  return !(rule.enforcementMode === 'strict' && isCommitted(rule, now));
}

export function matchingRules(state: AppState, url: string): WebsiteRule[] {
  return state.rules.filter((rule) => rule.enabled && urlMatchesDomains(url, rule.domains));
}

function limitBlockedToday(state: AppState, rule: WebsiteRule, now: Date): boolean {
  const allowance = allowanceMinutes(rule, now);
  return allowance !== undefined && usageFor(state, rule.id, now) >= allowance * MINUTE;
}

/**
 * Earliest instant ≥ now when neither the schedule nor the daily allowance blocks the rule.
 * Future days start with zero usage, so only a 0-minute allowance blocks them.
 */
export function nextAccessTime(state: AppState, rule: WebsiteRule, nowMs: number): number | undefined {
  const now = new Date(nowMs);
  const todayEnd = nextLocalMidnight(now);
  const todayLimited = limitBlockedToday(state, rule, now);
  const blockedAt = (t: number) => {
    const date = new Date(t);
    if (scheduleBlocked(rule, date)) return true;
    if (t < todayEnd) return todayLimited;
    return allowanceMinutes(rule, date) === 0;
  };
  if (!blockedAt(nowMs)) return nowMs;
  for (let t = floorToMinute(nowMs) + MINUTE; t <= nowMs + SEARCH_HORIZON_MS; t += MINUTE) {
    // Midnight is not always on a minute grid relative to `now` across DST, so test it explicitly.
    if (t > todayEnd && t - MINUTE < todayEnd && !blockedAt(todayEnd)) return todayEnd;
    if (!blockedAt(t)) return t;
  }
  return undefined;
}

export function evaluateRule(state: AppState, rule: WebsiteRule, nowMs: number): PolicyDecision {
  const now = new Date(nowMs);
  const allowance = allowanceMinutes(rule, now);
  const usage = usageFor(state, rule.id, now);
  const remaining = allowance === undefined ? undefined : Math.max(0, allowance * MINUTE - usage);
  const reasons: PolicyReason[] = [];
  if (allowance !== undefined && usage >= allowance * MINUTE) reasons.push('daily-limit');
  if (scheduleBlocked(rule, now)) reasons.push('schedule');
  const base = { ruleId: rule.id, ruleLabel: rule.label, allowanceMinutes: allowance, remainingMilliseconds: remaining, canOverride: canOverride(rule, nowMs) };
  if (!reasons.length) return { ...base, status: 'allowed', reasons };
  const override = state.overrides[rule.id];
  if (isOverrideActive(override, nowMs) && base.canOverride) {
    return { ...base, status: 'temporarily-unlocked', reasons, overrideExpiresAt: override.expiresAt, nextAccessAt: nextAccessTime(state, rule, nowMs) };
  }
  return { ...base, status: 'blocked', reasons, nextAccessAt: nextAccessTime(state, rule, nowMs) };
}

/**
 * Deterministic decision for a URL. When several rules cover the URL, the strictest wins:
 * any blocking rule blocks, and access returns only when every blocking rule has ended.
 */
export function evaluatePolicy(state: AppState, url: string, nowMs: number): PolicyDecision {
  const decisions = matchingRules(state, url).map((rule) => evaluateRule(state, rule, nowMs));
  if (!decisions.length) return { status: 'allowed', reasons: [] };
  const blocked = decisions.filter((decision) => decision.status === 'blocked');
  if (blocked.length) {
    const nextAccessAt = blocked.some((decision) => decision.nextAccessAt === undefined)
      ? undefined
      : Math.max(...blocked.map((decision) => decision.nextAccessAt!));
    const primary = blocked.find((decision) => decision.nextAccessAt === nextAccessAt) ?? blocked[0];
    return {
      ...primary,
      reasons: [...new Set(blocked.flatMap((decision) => decision.reasons))].sort() as PolicyReason[],
      nextAccessAt,
      canOverride: blocked.every((decision) => decision.canOverride)
    };
  }
  const unlocked = decisions.filter((decision) => decision.status === 'temporarily-unlocked');
  if (unlocked.length) return unlocked.reduce((a, b) => (a.overrideExpiresAt! <= b.overrideExpiresAt! ? a : b));
  const limited = decisions.filter((decision) => decision.remainingMilliseconds !== undefined);
  return limited.length ? limited.reduce((a, b) => (a.remainingMilliseconds! <= b.remainingMilliseconds! ? a : b)) : decisions[0];
}

/** Next instant a rule's schedule starts or stops within 24 hours, for precise re-evaluation. */
export function nextScheduleChange(rule: WebsiteRule, nowMs: number): number | undefined {
  if (!rule.schedules.length) return undefined;
  const initial = scheduleBlocked(rule, new Date(nowMs));
  for (let t = floorToMinute(nowMs) + MINUTE; t <= nowMs + DAY_MS; t += MINUTE) {
    if (scheduleBlocked(rule, new Date(t)) !== initial) return t;
  }
  return undefined;
}

/** Earliest upcoming time at which any decision could change without user activity. */
export function nextPolicyBoundary(state: AppState, nowMs: number): number {
  const candidates = [nextLocalMidnight(new Date(nowMs))];
  for (const override of Object.values(state.overrides)) if (override.expiresAt > nowMs) candidates.push(override.expiresAt);
  for (const rule of state.rules) {
    if (rule.pendingChange) candidates.push(Math.max(rule.pendingChange.applyAt, rule.commitmentEndsAt ?? 0));
    if (rule.commitmentEndsAt && rule.commitmentEndsAt > nowMs) candidates.push(rule.commitmentEndsAt);
    if (!rule.enabled) continue;
    const change = nextScheduleChange(rule, nowMs);
    if (change) candidates.push(change);
  }
  return Math.min(...candidates.filter((value) => value > nowMs));
}

/** Upcoming schedule windows (start/end) across all rules, for the dashboard. */
export function upcomingScheduleWindows(state: AppState, nowMs: number, horizonMs = DAY_MS): { ruleId: string; label: string; startsAt: number; endsAt?: number }[] {
  const windows: { ruleId: string; label: string; startsAt: number; endsAt?: number }[] = [];
  for (const rule of state.rules) {
    if (!rule.enabled || !rule.schedules.length || scheduleBlocked(rule, new Date(nowMs))) continue;
    for (let t = floorToMinute(nowMs) + MINUTE; t <= nowMs + horizonMs; t += MINUTE) {
      if (!scheduleBlocked(rule, new Date(t))) continue;
      const end = nextScheduleChange(rule, t);
      windows.push({ ruleId: rule.id, label: rule.label, startsAt: t, endsAt: end });
      break;
    }
  }
  return windows.sort((a, b) => a.startsAt - b.startsAt);
}
