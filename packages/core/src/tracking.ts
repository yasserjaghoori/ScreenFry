import { MINUTE, localDateKey, nextLocalMidnight } from "./date";
import { emptyUsageDay, USAGE_RETENTION_DAYS } from "./defaults";
import { displayHost } from "./domains";
import {
  activeFreeTime,
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
import type { AccessWindow, AppState } from "@shared/index";
export const MAX_CREDIT_MS = 90_000;
export const WARNING_THRESHOLDS_MINUTES = [5, 1];
export type IdleState = "active" | "idle" | "locked";
export interface TrackingSession {
  tabId: number;
  windowId: number;
  url: string;
  startedAt: number;
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
) {
  const rules = new Map<string, string>();
  /** Fry Time usage keys (window and website) to the URL being used. */
  const freeWindows = new Map<string, { window: AccessWindow; url: string }>();
  for (const url of urls) {
    // Blocked pages and playback outside a window do not consume a future allowance.
    if (evaluatePolicy(state, url, at).status === "blocked") continue;
    for (const rule of matchingRules(state, url)) rules.set(rule.id, url);
    for (const w of freeWindowsFor(state, url))
      if (isScheduleActive(w, new Date(at)))
        freeWindows.set(fryUsageKey(w, fryKeyFor(w, url)), { window: w, url });
  }
  if (!rules.size && !freeWindows.size) return;
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
    credited += end - at;
    while (at < end) {
      const next = Math.min(
        end,
        nextLocalMidnight(new Date(at)),
        nextPolicyBoundary(state, at),
      );
      creditSlice(state, urls, at, next - at, warnings);
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
