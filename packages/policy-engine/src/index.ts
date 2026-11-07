import {
  DAY_MS,
  MINUTE,
  floorToMinute,
  localDateKey,
  minutesSinceMidnight,
  nextLocalMidnight,
} from "@core/date";
import { urlMatchesDomains } from "@core/domains";
import { shortFormBlock } from "@feeds/index";
import type {
  AppState,
  DayOfWeek,
  PolicyDecision,
  PolicyReason,
  WebsiteRule,
  WeeklySchedule,
} from "@shared/index";
const HORIZON = 8 * DAY_MS;
export function isScheduleActive(
  schedule: WeeklySchedule,
  date: Date,
): boolean {
  const day = date.getDay() as DayOfWeek,
    minute = minutesSinceMidnight(date);
  if (schedule.startMinute === schedule.endMinute)
    return schedule.days.includes(day);
  if (schedule.startMinute < schedule.endMinute)
    return (
      schedule.days.includes(day) &&
      minute >= schedule.startMinute &&
      minute < schedule.endMinute
    );
  return (
    (schedule.days.includes(day) && minute >= schedule.startMinute) ||
    (schedule.days.includes(((day + 6) % 7) as DayOfWeek) &&
      minute < schedule.endMinute)
  );
}
export function allowanceMinutes(
  rule: WebsiteRule,
  date: Date,
): number | undefined {
  return (
    rule.dailyAllowance?.byWeekday?.[date.getDay() as DayOfWeek] ??
    rule.dailyAllowance?.defaultMinutes
  );
}
export const usageFor = (state: AppState, id: string, date: Date) =>
  state.usage[localDateKey(date)]?.millisecondsByRule[id] ?? 0;
export const matchingRules = (state: AppState, url: string) =>
  state.rules.filter((r) => r.enabled && urlMatchesDomains(url, r.domains));
export function evaluateRule(
  state: AppState,
  rule: WebsiteRule,
  now: number,
): PolicyDecision {
  const allowance = allowanceMinutes(rule, new Date(now));
  const remaining =
    allowance === undefined
      ? undefined
      : Math.max(
          0,
          allowance * MINUTE - usageFor(state, rule.id, new Date(now)),
        );
  const reasons: PolicyReason[] = [];
  if (rule.blocked) reasons.push("site-blocked");
  if (remaining === 0) reasons.push("daily-limit");
  return {
    ruleId: rule.id,
    ruleLabel: rule.label,
    status: reasons.length ? "blocked" : "allowed",
    reasons,
    allowanceMinutes: allowance,
    remainingMilliseconds: remaining,
  };
}
export function outsideWindow(
  state: AppState,
  url: string,
  now: number,
): boolean {
  const windows = state.windows.filter(
    (w) => w.enabled && urlMatchesDomains(url, w.domains),
  );
  return (
    windows.length > 0 &&
    !windows.some((w) => isScheduleActive(w, new Date(now)))
  );
}
function decisionAt(
  state: AppState,
  url: string,
  at: number,
  base = at,
): PolicyDecision {
  const reasons: PolicyReason[] = [];
  const rules = matchingRules(state, url);
  const decisions = rules.map((r) => {
    const d = evaluateRule(state, r, at);
    // Forecasts use today's remaining budget and a fresh budget on future calendar days.
    if (
      localDateKey(new Date(at)) !== localDateKey(new Date(base)) &&
      !r.blocked
    ) {
      const allowance = allowanceMinutes(r, new Date(at));
      return {
        ...d,
        status: allowance === 0 ? "blocked" : "allowed",
        reasons: allowance === 0 ? ["daily-limit"] : [],
      } as PolicyDecision;
    }
    return d;
  });
  reasons.push(...decisions.flatMap((d) => d.reasons));
  if (outsideWindow(state, url, at)) reasons.push("outside-window");
  const short = shortFormBlock(state.feedSettings, url);
  if (short) reasons.push("short-form");
  const primary =
    decisions.find((d) => d.status === "blocked") ??
    decisions
      .filter((d) => d.remainingMilliseconds !== undefined)
      .sort((a, b) => a.remainingMilliseconds! - b.remainingMilliseconds!)[0] ??
    decisions[0];
  return {
    ...primary,
    ruleLabel: short ?? primary?.ruleLabel,
    status: reasons.length ? "blocked" : "allowed",
    reasons: [...new Set(reasons)],
  };
}
export function evaluatePolicy(
  state: AppState,
  url: string,
  now: number,
): PolicyDecision {
  const result = decisionAt(state, url, now);
  if (
    result.status !== "blocked" ||
    result.reasons.includes("short-form") ||
    result.reasons.includes("site-blocked")
  )
    return result;
  for (
    let at = floorToMinute(now) + MINUTE;
    at <= now + HORIZON;
    at += MINUTE
  ) {
    if (decisionAt(state, url, at, now).status === "allowed") {
      result.nextAccessAt = at;
      break;
    }
  }
  return result;
}
export function nextPolicyBoundary(state: AppState, now: number): number {
  let next = nextLocalMidnight(new Date(now));
  for (const w of state.windows.filter((w) => w.enabled)) {
    const active = isScheduleActive(w, new Date(now));
    for (let at = floorToMinute(now) + MINUTE; at < next; at += MINUTE) {
      if (isScheduleActive(w, new Date(at)) !== active) {
        next = at;
        break;
      }
    }
  }
  return next;
}
