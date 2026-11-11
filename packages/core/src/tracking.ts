import { MINUTE, localDateKey, nextLocalMidnight } from "./date";
import { emptyUsageDay, USAGE_RETENTION_DAYS } from "./defaults";
import { displayHost } from "./domains";
import {
  activeFreeTime,
  fryTimeHasEffect,
  earnCapRemaining,
  earnGoalsFor,
  earnRemaining,
  earnedFryKey,
  earnedFryRemaining,
  evaluatePolicy,
  evaluateRule,
  freeTimeRemaining,
  freeWindowsFor,
  fryKeyFor,
  fryUsageKey,
  isScheduleActive,
  matchingRules,
  nextPolicyBoundary,
} from "@policy/index";
import type { AccessWindow, AppState, EarnGoal } from "@shared/index";
export const MAX_CREDIT_MS = 90_000;
export const WARNING_THRESHOLDS_MINUTES = [5, 1];
export type IdleState = "active" | "idle" | "locked";
export interface TrackingSession {
  tabId: number;
  windowId: number;
  url: string;
  startedAt: number;
  /**
   * The tab was in front and the user was active (input within the last minute). Only such
   * time counts toward earn goals; background playback still counts for limits. Missing on
   * sessions saved before 0.7.3, which count as active.
   */
  active?: boolean;
}
export interface TabLike {
  id?: number;
  windowId: number;
  active: boolean;
  url?: string;
  audible?: boolean;
  mediaPlaying?: boolean;
  incognito?: boolean;
}
/** Count the focused active tab AND any background tabs actually playing media. */
export function pickTrackedTabs<T extends TabLike>(
  tabs: T[],
  focusedWindowId: number | undefined,
  idleState: IdleState = "active",
): T[] {
  return tabs.filter(
    (t) =>
      t.id !== undefined &&
      displayHost(t.url ?? "") &&
      shouldCount({
        windowFocused: t.active && t.windowId === focusedWindowId,
        idleState,
        audible: t.audible,
        mediaPlaying: t.mediaPlaying,
      }),
  );
}
export function shouldCount(input: {
  windowFocused: boolean;
  idleState: IdleState;
  audible?: boolean;
  mediaPlaying?: boolean;
}): boolean {
  return Boolean(
    input.audible ||
      input.mediaPlaying ||
      (input.windowFocused && input.idleState !== "locked"),
  );
}
export interface CreditWarning {
  ruleId: string;
  label: string;
  minutesRemaining: number;
}
function creditSlice(
  state: AppState,
  urls: string[],
  at: number,
  ms: number,
  warnings: CreditWarning[],
  activeUrls: Set<string> = new Set(urls),
) {
  const rules = new Map<string, string>();
  /** Fry Time usage keys (window and website) to the URL being used. */
  const freeWindows = new Map<string, { window: AccessWindow; url: string }>();
  const goals = new Set<string>();
  /** Earned Fry Time keys (goal and website) to the URL using them. */
  const earnedFry = new Map<string, { goal: EarnGoal; url: string }>();
  for (const url of urls) {
    // Blocked pages and playback outside a window do not consume a future allowance.
    if (evaluatePolicy(state, url, at).status === "blocked") continue;
    for (const rule of matchingRules(state, url)) rules.set(rule.id, url);
    // Earn goals count only active time: the tab in front and someone using it.
    if (activeUrls.has(url)) for (const goal of earnGoalsFor(state, url)) goals.add(goal.id);
    const fry = activeFreeTime(state, url, at);
    if (fry?.earned) {
      const goal = state.earnGoals!.find((g) => `earn:${g.id}` === fry.windowId)!;
      earnedFry.set(earnedFryKey(goal), { goal, url });
    }
    // Fry Time with nothing to lift (no filters on) uses none of its minutes.
    if (fryTimeHasEffect(state, url, at))
      for (const w of freeWindowsFor(state, url))
        if (isScheduleActive(w, new Date(at)))
        freeWindows.set(fryUsageKey(w, fryKeyFor(w, url)), { window: w, url });
  }
  if (!rules.size && !freeWindows.size && !goals.size && !earnedFry.size) return;
  const key = localDateKey(new Date(at)),
    day = state.usage[key] ?? emptyUsageDay(key);
  state.usage[key] = day;
  // Fry Time, like an allowance, counts once per wall-clock second across a website's tabs,
  // separately for each website in the window.
  day.millisecondsByWindow ??= {};
  for (const [id, { window: w, url }] of freeWindows) {
    const left = freeTimeRemaining(state, w, url, at);
    if (left === 0) continue;
    day.millisecondsByWindow[id] =
      (day.millisecondsByWindow[id] ?? 0) + (left === undefined ? ms : Math.min(ms, left));
  }
  // Earned Fry Time is used up like a Fry Time window's, per website.
  for (const [id, { goal, url }] of earnedFry) {
    const left = earnedFryRemaining(state, goal, at);
    if (left > 0) day.millisecondsByWindow[id] = (day.millisecondsByWindow[id] ?? 0) + Math.min(ms, left);
  }
  // Earn goals count once per wall-clock second too, and stop once nothing more can be
  // earned today (met, or every repeat of a Fry Time goal paid out).
  if (goals.size) day.millisecondsByGoal ??= {};
  for (const id of goals) {
    const goal = state.earnGoals!.find((g) => g.id === id)!;
    const left = earnCapRemaining(state, goal, at);
    if (left > 0)
      day.millisecondsByGoal![id] = (day.millisecondsByGoal![id] ?? 0) + Math.min(ms, left);
  }
  // Several playing tabs on one website consume one second of allowance per wall-clock second.
  for (const [id] of rules) {
    const rule = state.rules.find((r) => r.id === id)!;
    const before = evaluateRule(state, rule, at).remainingMilliseconds;
    const counted = before === undefined ? ms : Math.min(ms, before);
    day.millisecondsByRule[id] = (day.millisecondsByRule[id] ?? 0) + counted;
    if (before === undefined || !state.warningsEnabled) continue;
    for (const threshold of WARNING_THRESHOLDS_MINUTES) {
      const sent = day.warningsSent[id] ?? [];
      if (
        before > threshold * MINUTE &&
        before - ms <= threshold * MINUTE &&
        before - ms > 0 &&
        !sent.includes(threshold)
      ) {
        day.warningsSent[id] = [...sent, threshold];
        warnings.push({
          ruleId: id,
          label: rule.label,
          minutesRemaining: threshold,
        });
      }
    }
  }
}
/** Union overlapping sessions before crediting, splitting at midnight and each session boundary. */
export function creditSessions(
  state: AppState,
  sessions: TrackingSession[],
  to: number,
): { state: AppState; credited: number; warnings: CreditWarning[] } {
  const warnings: CreditWarning[] = [];
  const ranges = sessions
    .filter((s) => to > s.startedAt)
    .map((s) => ({ ...s, end: Math.min(to, s.startedAt + MAX_CREDIT_MS) }));
  const boundaries = [
    ...new Set(ranges.flatMap((s) => [s.startedAt, s.end])),
  ].sort((a, b) => a - b);
  let credited = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    let at = boundaries[i],
      end = boundaries[i + 1];
    const urls = [
      ...new Set(
        ranges
          .filter((s) => s.startedAt <= at && s.end >= end)
          .map((s) => s.url),
      ),
    ];
    if (!urls.length) continue;
    const activeUrls = new Set(
      ranges
        .filter((s) => s.startedAt <= at && s.end >= end && s.active !== false)
        .map((s) => s.url),
    );
    credited += end - at;
    while (at < end) {
      const next = Math.min(
        end,
        nextLocalMidnight(new Date(at)),
        nextPolicyBoundary(state, at),
      );
      creditSlice(state, urls, at, next - at, warnings, activeUrls);
      at = next;
    }
  }
  return { state, credited, warnings };
}
export const creditUsage = (
  state: AppState,
  url: string,
  from: number,
  to: number,
) =>
  creditSessions(state, [{ tabId: 0, windowId: 0, url, startedAt: from }], to);
/**
 * Strict earn goals count only unbroken time: when none of a strict goal's websites is in
 * active use any more, its time toward the next completion goes back to zero (completions
 * already made are kept). Returns the goals that were reset.
 */
export function resetBrokenStrictGoals(state: AppState, activeUrls: string[], now: number): string[] {
  const day = state.usage[localDateKey(new Date(now))];
  const reset: string[] = [];
  for (const goal of state.earnGoals ?? []) {
    if (!goal.enabled || !goal.strict) continue;
    if (activeUrls.some((url) => earnGoalsFor(state, url).some((g) => g.id === goal.id))) continue;
    const used = day?.millisecondsByGoal?.[goal.id] ?? 0;
    const step = goal.minutes * 60_000;
    const kept = Math.floor(used / step) * step;
    if (used > kept) {
      day!.millisecondsByGoal![goal.id] = kept;
      reset.push(goal.id);
    }
  }
  return reset;
}
export function pruneUsage(state: AppState, now: number): AppState {
  const cutoff = localDateKey(
    new Date(now - USAGE_RETENTION_DAYS * 86_400_000),
  );
  for (const key of Object.keys(state.usage))
    if (key < cutoff) delete state.usage[key];
  return state;
}
export function nextTrackingBoundary(
  state: AppState,
  url: string,
  now: number,
): number | undefined {
  const times: number[] = [];
  // When free time runs out, feed blocking returns: credit and re-evaluate right then.
  const free = activeFreeTime(state, url, now)?.remainingMilliseconds;
  if (free !== undefined) times.push(now + free);
  // When an earn goal is met (or pays out Fry Time again), re-evaluate right then.
  for (const goal of earnGoalsFor(state, url)) {
    const left = earnRemaining(state, goal, now);
    if (left > 0) times.push(now + left);
  }
  for (const rule of matchingRules(state, url)) {
    const d = evaluateRule(state, rule, now);
    if (d.status !== "allowed" || d.remainingMilliseconds === undefined)
      continue;
    times.push(now + d.remainingMilliseconds);
    for (const n of WARNING_THRESHOLDS_MINUTES)
      if (d.remainingMilliseconds > n * MINUTE)
        times.push(now + d.remainingMilliseconds - n * MINUTE);
  }
  return times.length ? Math.min(...times) : undefined;
}
