import { localDateKey, minutesSinceMidnight, nextLocalMidnight } from '@core/date';
import { urlMatchesDomains } from '@core/domains';
import type { AppState, PolicyDecision, WebsiteRule, WeeklySchedule } from '@shared/index';

export function isScheduleActive(schedule: WeeklySchedule, date: Date): boolean {
  const day = date.getDay();
  const minute = minutesSinceMidnight(date);
  if (schedule.startMinute === schedule.endMinute) return schedule.days.includes(day as never);
  if (schedule.startMinute < schedule.endMinute) {
    return schedule.days.includes(day as never) && minute >= schedule.startMinute && minute < schedule.endMinute;
  }
  if (schedule.days.includes(day as never) && minute >= schedule.startMinute) return true;
  const previousDay = ((day + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  return schedule.days.includes(previousDay) && minute < schedule.endMinute;
}

function scheduleBlocked(rule: WebsiteRule, date: Date): boolean {
  return rule.schedules.some((schedule) => isScheduleActive(schedule, date));
}

function allowanceMilliseconds(rule: WebsiteRule, date: Date): number | undefined {
  const minutes = rule.dailyAllowance?.byWeekday?.[date.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6]
    ?? rule.dailyAllowance?.defaultMinutes;
  return minutes === undefined ? undefined : minutes * 60_000;
}

function nextScheduleAvailability(rule: WebsiteRule, now: Date): number | undefined {
  if (!scheduleBlocked(rule, now)) return now.getTime();
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let minute = 0; minute <= 8 * 24 * 60; minute += 1) {
    if (!scheduleBlocked(rule, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return undefined;
}

export function evaluatePolicy(state: AppState, url: string, nowMs: number): PolicyDecision {
  const rule = state.rules.find((candidate) => candidate.enabled && urlMatchesDomains(url, candidate.domains));
  if (!rule) return { status: 'allowed', reasons: [] };

  const override = state.overrides[rule.id];
  if (override?.expiresAt && override.expiresAt > nowMs) {
    return {
      status: 'temporarily-unlocked', ruleId: rule.id, ruleLabel: rule.label, reasons: [],
      overrideExpiresAt: override.expiresAt
    };
  }

  const now = new Date(nowMs);
  const allowance = allowanceMilliseconds(rule, now);
  const usage = state.usage[localDateKey(now)]?.millisecondsByRule[rule.id] ?? 0;
  const limitBlocked = allowance !== undefined && usage >= allowance;
  const activeSchedule = scheduleBlocked(rule, now);
  const reasons = [
    ...(limitBlocked ? ['daily-limit' as const] : []),
    ...(activeSchedule ? ['schedule' as const] : [])
  ];
  if (!reasons.length) {
    return {
      status: 'allowed', ruleId: rule.id, ruleLabel: rule.label, reasons: [],
      remainingMilliseconds: allowance === undefined ? undefined : Math.max(0, allowance - usage)
    };
  }

  const limitEnd = limitBlocked ? nextLocalMidnight(now) : nowMs;
  const scheduleEnd = activeSchedule ? nextScheduleAvailability(rule, now) ?? Number.POSITIVE_INFINITY : nowMs;
  return {
    status: 'blocked', ruleId: rule.id, ruleLabel: rule.label, reasons,
    nextAccessAt: Math.max(limitEnd, scheduleEnd),
    remainingMilliseconds: limitBlocked ? 0 : allowance === undefined ? undefined : Math.max(0, allowance - usage)
  };
}
