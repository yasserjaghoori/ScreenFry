import { MINUTE, localDateKey, nextLocalMidnight } from './date';
import { emptyUsageDay, USAGE_RETENTION_DAYS } from './defaults';
import { displayHost } from './domains';
import { evaluateRule, matchingRules } from '@policy/index';
import type { AppState } from '@shared/index';

/** Longest interval credited in one step. Heartbeats run every minute, so a larger gap means sleep or suspension. */
export const MAX_CREDIT_MS = 90_000;
export const WARNING_THRESHOLDS_MINUTES = [5, 1];

export type IdleState = 'active' | 'idle' | 'locked';

export interface TrackingSession {
  tabId: number;
  windowId: number;
  url: string;
  startedAt: number;
}

export interface TabLike { id?: number; windowId: number; active: boolean; url?: string; audible?: boolean; incognito?: boolean }

/** Only one tab is ever tracked: the active tab of the focused window. */
export function pickTrackedTab<T extends TabLike>(tabs: T[], focusedWindowId: number | undefined): T | undefined {
  if (focusedWindowId === undefined || focusedWindowId < 0) return undefined;
  return tabs.find((tab) => tab.active && tab.windowId === focusedWindowId && tab.id !== undefined && displayHost(tab.url ?? '') !== undefined);
}

/**
 * Counts only a focused, active tab while the user is present. Media playing in that tab
 * keeps counting through input-idle (watching a video is still use); a locked screen never counts.
 */
export function shouldCount(input: { windowFocused: boolean; idleState: IdleState; audible?: boolean }): boolean {
  if (!input.windowFocused || input.idleState === 'locked') return false;
  return input.idleState === 'active' || Boolean(input.audible);
}

export interface CreditWarning { ruleId: string; label: string; minutesRemaining: number }

function creditSlice(state: AppState, url: string, at: number, ms: number, warnings: CreditWarning[]): void {
  const date = new Date(at);
  const key = localDateKey(date);
  const day = state.usage[key] ?? emptyUsageDay(key);
  state.usage[key] = day;
  if (state.trackingEnabled) {
    const host = displayHost(url);
    if (host) day.millisecondsByHost[host] = (day.millisecondsByHost[host] ?? 0) + ms;
  }
  for (const rule of matchingRules(state, url)) {
    const decision = evaluateRule(state, rule, at);
    if (decision.status === 'temporarily-unlocked') {
      day.overrideMillisecondsByRule[rule.id] = (day.overrideMillisecondsByRule[rule.id] ?? 0) + ms;
    } else if (decision.status === 'allowed') {
      const before = decision.remainingMilliseconds;
      day.millisecondsByRule[rule.id] = (day.millisecondsByRule[rule.id] ?? 0) + ms;
      if (before === undefined || !state.warningsEnabled) continue;
      const after = before - ms;
      for (const threshold of WARNING_THRESHOLDS_MINUTES) {
        const sent = day.warningsSent[rule.id] ?? [];
        if (before > threshold * MINUTE && after <= threshold * MINUTE && after > 0 && !sent.includes(threshold)) {
          day.warningsSent[rule.id] = [...sent, threshold];
          warnings.push({ ruleId: rule.id, label: rule.label, minutesRemaining: threshold });
        }
      }
    }
    // Blocked: nothing is credited; enforcement is about to replace the page.
  }
}

/**
 * Credits focused time on `url` between `from` and `to`, splitting at local midnight so each
 * calendar day receives its own share. Mutates and returns `state`.
 */
export function creditUsage(state: AppState, url: string, from: number, to: number): { state: AppState; credited: number; warnings: CreditWarning[] } {
  const warnings: CreditWarning[] = [];
  if (to <= from) return { state, credited: 0, warnings };
  const end = Math.min(to, from + MAX_CREDIT_MS);
  let cursor = from;
  while (cursor < end) {
    const boundary = Math.min(end, nextLocalMidnight(new Date(cursor)));
    creditSlice(state, url, cursor, boundary - cursor, warnings);
    cursor = boundary;
  }
  return { state, credited: end - from, warnings };
}

export function pruneUsage(state: AppState, now: number): AppState {
  const cutoff = localDateKey(new Date(now - USAGE_RETENTION_DAYS * 86_400_000));
  for (const key of Object.keys(state.usage)) if (key < cutoff) delete state.usage[key];
  return state;
}

/** Earliest moment the currently tracked URL could cross a warning threshold or exhaust a limit. */
export function nextTrackingBoundary(state: AppState, url: string, now: number): number | undefined {
  const times: number[] = [];
  for (const rule of matchingRules(state, url)) {
    const decision = evaluateRule(state, rule, now);
    if (decision.status !== 'allowed' || decision.remainingMilliseconds === undefined) continue;
    const remaining = decision.remainingMilliseconds;
    times.push(now + remaining);
    for (const threshold of WARNING_THRESHOLDS_MINUTES) if (remaining > threshold * MINUTE) times.push(now + remaining - threshold * MINUTE);
  }
  return times.length ? Math.min(...times) : undefined;
}
