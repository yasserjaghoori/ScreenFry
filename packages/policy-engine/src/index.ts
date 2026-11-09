import {
  DAY_MS,
  MINUTE,
  floorToMinute,
  localDateKey,
  minutesSinceMidnight,
  nextLocalMidnight,
} from "@core/date";
import {
  expandDomainAliases,
  hostMatchesDomain,
  urlMatchesDomains,
} from "@core/domains";
import { shortFormBlock, siteDefinitions, siteFor } from "@feeds/index";
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
  return activeAt(
    schedule,
    date.getDay() as DayOfWeek,
    minutesSinceMidnight(date),
  );
}
/** Whether a weekly schedule is on at a minute of a weekday (no clock or time zone). */
function activeAt(
  schedule: WeeklySchedule,
  day: DayOfWeek,
  minute: number,
): boolean {
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
  const windows = runningWindows(state.windows).filter(
    (w) =>
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
  return runningWindows(state.windows).some(
    (w) =>
      w.mode === "block" &&
      urlMatchesDomains(url, w.domains) &&
      isScheduleActive(w, new Date(now)),
  );
}
export const freeWindowsFor = (state: AppState, url: string) =>
  runningWindows(state.windows).filter(
    (w) => w.mode === "free" && urlMatchesDomains(url, w.domains),
  );
/** The key a Fry Time budget uses for a domain: its site id ("youtube"), else the domain. */
export const fryKeyForDomain = (domain: string) => siteFor(domain)?.site ?? domain;
/** Which of the window's websites a URL belongs to, as a Fry Time key. */
export function fryKeyFor(window: AccessWindow, url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* not a web address */
  }
  const site = siteFor(host)?.site;
  if (site) return site;
  return window.domains.find((d) => hostMatchesDomain(host, d)) ?? host;
}
/** A website's Fry Time minutes in a window; undefined means the whole window. */
export function fryMinutesFor(window: AccessWindow, key: string): number | undefined {
  return window.freeMinutesBySite
    ? window.freeMinutesBySite[key]
    : window.freeMinutes;
}
/** Where a website's Fry Time use in a window is counted (per website, per day). */
export const fryUsageKey = (window: AccessWindow, key: string) => `${window.id}:${key}`;
/**
 * Fry Time left today for this website in a Fry Time window; undefined when it has no
 * budget. Each website has its own minutes: one running out doesn't end another's.
 */
export function freeTimeRemaining(
  state: AppState,
  window: AccessWindow,
  url: string,
  now: number,
): number | undefined {
  const key = fryKeyFor(window, url);
  const budget = fryMinutesFor(window, key);
  if (budget === undefined) return undefined;
  const used =
    state.usage[localDateKey(new Date(now))]?.millisecondsByWindow?.[
      fryUsageKey(window, key)
    ] ?? 0;
  return Math.max(0, budget * MINUTE - used);
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
    const remaining = freeTimeRemaining(state, w, url, now);
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
  const enabled = runningWindows(windows);
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
  for (const w of runningWindows(state.windows)) {
    const active = isScheduleActive(w, new Date(now));
    for (const at of candidateTimes([w], now, midnight))
      if (at < next && isScheduleActive(w, new Date(at)) !== active) {
        next = at;
        break;
      }
  }
  return next;
}

/**
 * Two windows contradict when one blocks a website while the other, at the same time, allows
 * it (an allow window) or opens its feeds (free time): inside the overlap they say opposite
 * things. Allow + allow, block + block and allow + free time can coexist.
 */
export interface WindowConflict {
  other: AccessWindow;
  /** Site names (or domains) both windows list. */
  sites: string[];
  /** The first overlapping minute of the week, starting Monday. */
  day: DayOfWeek;
  minute: number;
}
const contradicts = (a: AccessWindow, b: AccessWindow) => {
  const modes = new Set([a.mode ?? "allow", b.mode ?? "allow"]);
  return modes.has("block") && modes.size === 2;
};
function sharedSites(a: AccessWindow, b: AccessWindow): string[] {
  const shared = a.domains.filter((d) =>
    b.domains.some((e) => hostMatchesDomain(d, e) || hostMatchesDomain(e, d)),
  );
  const names = shared.map(
    (d) =>
      siteDefinitions.find((site) =>
        expandDomainAliases(site.domains).some((sd) => hostMatchesDomain(d, sd)),
      )?.name ?? d,
  );
  return [...new Set(names)];
}
const WEEK_ORDER: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];
/** Conflicts between `window` and the other enabled windows; none when it is disabled. */
export function windowConflicts(
  windows: AccessWindow[],
  window: AccessWindow,
): WindowConflict[] {
  if (!window.enabled) return [];
  const conflicts: WindowConflict[] = [];
  for (const other of windows) {
    if (other.id === window.id || !other.enabled || !contradicts(window, other))
      continue;
    const sites = sharedSites(window, other);
    if (!sites.length) continue;
    search: for (const day of WEEK_ORDER)
      for (let minute = 0; minute < 1440; minute++)
        if (activeAt(window, day, minute) && activeAt(other, day, minute)) {
          conflicts.push({ other, sites, day, minute });
          break search;
        }
  }
  return conflicts;
}
const suspendedCache = new WeakMap<AccessWindow[], Set<string>>();
/**
 * Enabled windows that contradict another enabled window. A contradiction is saved (so it
 * can be fixed by editing either window), but neither side runs until it is reconciled:
 * ScreenFry never guesses which of two opposite instructions was meant.
 */
export function suspendedWindowIds(windows: AccessWindow[]): Set<string> {
  let ids = suspendedCache.get(windows);
  if (!ids) {
    ids = new Set(
      windows.filter((w) => windowConflicts(windows, w).length).map((w) => w.id),
    );
    suspendedCache.set(windows, ids);
  }
  return ids;
}
/** Windows that are switched on and not paused by a contradiction. */
export function runningWindows(windows: AccessWindow[]): AccessWindow[] {
  const suspended = suspendedWindowIds(windows);
  return windows.filter((w) => w.enabled && !suspended.has(w.id));
}
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const listSites = (sites: string[]) =>
  sites.length < 3
    ? sites.join(" and ")
    : `${sites.slice(0, -1).join(", ")} and ${sites.at(-1)}`;
/** A sentence explaining a conflict, for errors and the window editor. */
export function describeConflict(
  window: AccessWindow,
  conflict: WindowConflict,
): string {
  const hour = Math.floor(conflict.minute / 60),
    minute = String(conflict.minute % 60).padStart(2, "0");
  const time = `${((hour + 11) % 12) + 1}:${minute} ${hour < 12 ? "AM" : "PM"}`;
  const blocking = (window.mode ?? "allow") === "block" ? window : conflict.other;
  const opening = blocking === window ? conflict.other : window;
  const one = conflict.sites.length === 1;
  const kind =
    opening.mode === "free"
      ? `opens ${one ? "its" : "their"} feeds`
      : `allows ${one ? "it" : "them"}`;
  return `“${blocking.label}” blocks ${listSites(conflict.sites)} while “${opening.label}” ${kind} (overlap starts ${DAY_NAMES[conflict.day]} ${time}). Both are paused until you change the times, days or websites so they don’t overlap.`;
}
