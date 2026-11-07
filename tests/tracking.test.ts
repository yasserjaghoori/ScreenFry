import { describe, expect, it } from 'vitest';
import { localDateKey } from '@core/date';
import { creditUsage, MAX_CREDIT_MS, nextTrackingBoundary, pickTrackedTab, shouldCount } from '@core/tracking';
import { MIN, at, rule, setUsage, stateWith } from './helpers';

describe('what counts as usage', () => {
  it('counts only a focused window with a present user', () => {
    expect(shouldCount({ windowFocused: true, idleState: 'active' })).toBe(true);
    expect(shouldCount({ windowFocused: false, idleState: 'active' })).toBe(false);
    expect(shouldCount({ windowFocused: true, idleState: 'idle' })).toBe(false);
    expect(shouldCount({ windowFocused: true, idleState: 'locked', audible: true })).toBe(false);
  });

  it('keeps counting while media plays without input', () => {
    expect(shouldCount({ windowFocused: true, idleState: 'idle', audible: true })).toBe(true);
  });

  it('tracks a single tab: the active tab of the focused window', () => {
    const tabs = [
      { id: 1, windowId: 1, active: true, url: 'https://youtube.com/a' },
      { id: 2, windowId: 1, active: false, url: 'https://youtube.com/b' },
      { id: 3, windowId: 2, active: true, url: 'https://reddit.com/' },
      { id: 4, windowId: 3, active: true, url: 'chrome://settings' }
    ];
    expect(pickTrackedTab(tabs, 1)?.id).toBe(1);
    expect(pickTrackedTab(tabs, 2)?.id).toBe(3);
    expect(pickTrackedTab(tabs, 3)).toBeUndefined();
    expect(pickTrackedTab(tabs, -1)).toBeUndefined();
  });
});

describe('crediting usage', () => {
  it('credits the matching rule and host, never two tabs at once', () => {
    const now = at(2026, 10, 3, 12);
    const state = stateWith([rule()]);
    creditUsage(state, 'https://www.youtube.com/watch?v=1', now, now + 30_000);
    creditUsage(state, 'https://youtu.be/2', now + 30_000, now + 60_000);
    const day = state.usage[localDateKey(new Date(now))];
    expect(day.millisecondsByRule.youtube).toBe(60_000);
    expect(day.millisecondsByHost['youtube.com']).toBe(30_000);
    expect(day.millisecondsByHost['youtu.be']).toBe(30_000);
  });

  it('caps a single gap so sleep or a suspended worker is not counted', () => {
    const now = at(2026, 10, 3, 12);
    const state = stateWith([rule()]);
    const { credited } = creditUsage(state, 'https://youtube.com', now, now + 3 * 60 * MIN);
    expect(credited).toBe(MAX_CREDIT_MS);
  });

  it('splits a session that crosses local midnight', () => {
    const start = at(2026, 10, 3, 23, 59, 30);
    const state = stateWith([rule()]);
    creditUsage(state, 'https://youtube.com', start, start + 60_000);
    expect(state.usage['2026-11-03'].millisecondsByRule.youtube).toBe(30_000);
    expect(state.usage['2026-11-04'].millisecondsByRule.youtube).toBe(30_000);
  });

  it('counts override time separately and never toward the limit', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 30 * MIN, 'youtube', now);
    state.overrides.youtube = { ruleId: 'youtube', startedAt: now, expiresAt: now + 10 * MIN };
    creditUsage(state, 'https://youtube.com', now, now + 60_000);
    const day = state.usage[localDateKey(new Date(now))];
    expect(day.millisecondsByRule.youtube).toBe(30 * MIN);
    expect(day.overrideMillisecondsByRule.youtube).toBe(60_000);
  });

  it('always measures restricted sites even with general history off', () => {
    const now = at(2026, 10, 3, 12);
    const state = stateWith([rule()], { trackingEnabled: false });
    creditUsage(state, 'https://youtube.com', now, now + 60_000);
    creditUsage(state, 'https://example.com', now + 60_000, now + 90_000);
    const day = state.usage[localDateKey(new Date(now))];
    expect(day.millisecondsByRule.youtube).toBe(60_000);
    expect(day.millisecondsByHost).toEqual({});
  });

  it('raises the 5- and 1-minute warnings once each', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 24.5 * MIN, 'youtube', now);
    expect(creditUsage(state, 'https://youtube.com', now, now + 60_000).warnings).toEqual([{ ruleId: 'youtube', label: 'YouTube', minutesRemaining: 5 }]);
    expect(creditUsage(state, 'https://youtube.com', now + 60_000, now + 120_000).warnings).toEqual([]);
    setUsage(state, 28.5 * MIN, 'youtube', now);
    expect(creditUsage(state, 'https://youtube.com', now, now + 60_000).warnings.map((w) => w.minutesRemaining)).toEqual([1]);
  });

  it('suppresses warnings when disabled', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()], { warningsEnabled: false }), 24.5 * MIN, 'youtube', now);
    expect(creditUsage(state, 'https://youtube.com', now, now + 60_000).warnings).toEqual([]);
  });

  it('schedules a precise check for the next warning or the limit', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 20 * MIN, 'youtube', now);
    expect(nextTrackingBoundary(state, 'https://youtube.com', now)).toBe(now + 5 * MIN);
    setUsage(state, 29 * MIN, 'youtube', now);
    expect(nextTrackingBoundary(state, 'https://youtube.com', now)).toBe(now + MIN);
  });
});
