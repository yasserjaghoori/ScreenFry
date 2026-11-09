import {
  DAY_MS,
  MINUTE,
  floorToMinute,
  localDateKey,
  minutesSinceMidnight,
  nextLocalMidnight,
} from "@core/date";
import { urlMatchesDomains } from "@core/domains";
import { shortFormBlock, siteFor } from "@feeds/index";
import type {
  AccessWindow,
  AppState,
  DayOfWeek,
  FeedSettings,
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
    (w) =>
      w.enabled &&
      (w.mode ?? "allow") === "allow" &&
      urlMatchesDomains(url, w.domains),
  );
  return (
    windows.length > 0 &&
    !windows.some((w) => isScheduleActive(w, new Date(now)))
  );
}
/** True while any enabled block window listing this website is active. */
export function insideBlockWindow(
  state: AppState,
  url: string,
  now: number,
): boolean {
  return state.windows.some(
    (w) =>
      w.enabled &&
      w.mode === "block" &&
      urlMatchesDomains(url, w.domains) &&
      isScheduleActive(w, new Date(now)),
  );
}
export const freeWindowsFor = (state: AppState, url: string) =>
  state.windows.filter(
    (w) => w.enabled && w.mode === "free" && urlMatchesDomains(url, w.domains),
  );
/** Free time left today in a free-time window; undefined when it has no budget. */
export function freeTimeRemaining(
  state: AppState,
  window: AccessWindow,
  now: number,
): number | undefined {
  if (window.freeMinutes === undefined) return undefined;
  const used =
    state.usage[localDateKey(new Date(now))]?.millisecondsByWindow?.[
      window.id
    ] ?? 0;
  return Math.max(0, window.freeMinutes * MINUTE - used);
}
/**
 * The free-time window currently pausing this website's feed blocking, if any: one that is
 * on now and still has free time left today. An unbudgeted window beats a budgeted one.
 */
export function activeFreeTime(
  state: AppState,
  url: string,
  now: number,
): PolicyDecision["freeTime"] {
  let best: PolicyDecision["freeTime"];
  for (const w of freeWindowsFor(state, url)) {
    if (!isScheduleActive(w, new Date(now))) continue;
    const remaining = freeTimeRemaining(state, w, now);
    if (remaining === 0) continue;
    if (
      !best ||
      (best.remainingMilliseconds !== undefined &&
        (remaining === undefined || remaining > best.remainingMilliseconds))
    )
      best = { windowId: w.id, label: w.label, remainingMilliseconds: remaining };
  }
  return best;
}
/**
 * Why free time isn't running for a website that has free-time windows, and when it next
 * starts: either a window is on but today's minutes are spent, or no window is on.
 */
export function freeTimeOff(
  state: AppState,
  url: string,
  now: number,
): PolicyDecision["freeTimeOff"] {
  const windows = freeWindowsFor(state, url);
  if (!windows.length || activeFreeTime(state, url, now)) return undefined;
  const spent = windows.find((w) => isScheduleActive(w, new Date(now)));
  const nextAt = candidateTimes(windows, now, now + HORIZON).find((at) =>
    activeFreeTime(state, url, at),
  );
  const next = windows.find(
    (w) => nextAt !== undefined && isScheduleActive(w, new Date(nextAt)),
  );
  return {
    state: spent ? "used-up" : "not-started",
    label: (spent ?? next ?? windows[0]).label,
    ...(nextAt === undefined ? {} : { nextAt }),
  };
}
/**
 * The feed settings in force on this page: the saved ones, with this website's feed and
 * short-form blocking switched off while its free time is running.
 */
export function effectiveFeedSettings(
  state: AppState,
  url: string,
  now: number,
): FeedSettings {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return state.feedSettings;
  }
  const site = siteFor(host);
  if (!site || !activeFreeTime(state, url, now)) return state.feedSettings;
  const feeds = structuredClone(state.feedSettings);
  for (const key of Object.keys(feeds.sites[site.site] ?? {}))
    feeds.sites[site.site][key] = false;
  return feeds;
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
  if (insideBlockWindow(state, url, at)) reasons.push("block-window");
  const short = shortFormBlock(effectiveFeedSettings(state, url, at), url);
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
  const freeTime = activeFreeTime(state, url, now);
  if (freeTime) result.freeTime = freeTime;
  const off = freeTimeOff(state, url, now);
  if (off) result.freeTimeOff = off;
  if (
    result.status !== "blocked" ||
    result.reasons.includes("short-form") ||
    result.reasons.includes("site-blocked")
  )
    return result;
  // Status only changes at local midnight (allowances reset) or at a window's start or end,
  // so checking those moments finds the same answer as a minute-by-minute scan, far faster.
  for (const at of candidateTimes(state.windows, now, now + HORIZON))
    if (decisionAt(state, url, at, now).status === "allowed") {
      result.nextAccessAt = at;
      break;
    }
  return result;
}
/**
 * Sorted, de-duplicated moments after `now` and up to `until` when a decision can change:
 * every local midnight and every enabled window's start and end minute on each day.
 */
function candidateTimes(
  windows: AppState["windows"],
  now: number,
  until: number,
): number[] {
  const times = new Set<number>();
  const enabled = windows.filter((w) => w.enabled);
  const first = new Date(now);
  for (let day = -1; ; day++) {
    const y = first.getFullYear(),
      m = first.getMonth(),
      d = first.getDate() + day;
    const midnight = new Date(y, m, d).getTime();
    if (midnight > until) break;
    times.add(midnight);
    for (const w of enabled)
      for (const minute of [w.startMinute, w.endMinute])
        times.add(new Date(y, m, d, 0, minute).getTime());
  }
  return [...times]
    .filter((t) => t > now && t <= until)
    .sort((a, b) => a - b);
}
export function nextPolicyBoundary(state: AppState, now: number): number {
  const midnight = nextLocalMidnight(new Date(now));
  let next = midnight;
  for (const w of state.windows.filter((w) => w.enabled)) {
    const active = isScheduleActive(w, new Date(now));
    for (const at of candidateTimes([w], now, midnight))
      if (at < next && isScheduleActive(w, new Date(at)) !== active) {
        next = at;
        break;
      }
  }
  return next;
}
