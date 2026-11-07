import { describe, expect, it } from 'vitest';
import { createDefaultState } from '@core/defaults';
import { localDateKey } from '@core/date';
import { evaluatePolicy, isScheduleActive } from '@policy/index';
import type { WebsiteRule, WeeklySchedule } from '@shared/index';

const at = (year: number, month: number, day: number, hour: number, minute = 0) => new Date(year, month, day, hour, minute);
const rule = (patch: Partial<WebsiteRule> = {}): WebsiteRule => ({
  id: 'youtube', label: 'YouTube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], enabled: true,
  dailyAllowance: { defaultMinutes: 30 }, schedules: [], enforcementMode: 'pin', createdAt: 1, updatedAt: 1, ...patch
});

describe('policy engine', () => {
  it('blocks all supported YouTube URL forms after the limit', () => {
    const now = at(2026, 10, 3, 12);
    const state = createDefaultState(); state.rules = [rule()];
    state.usage[localDateKey(now)] = { dateKey: localDateKey(now), millisecondsByRule: { youtube: 30 * 60_000 } };
    for (const url of ['https://youtube.com/', 'https://www.youtube.com/watch?v=a', 'https://m.youtube.com/shorts/a', 'https://youtu.be/a', 'https://www.youtube-nocookie.com/embed/a']) {
      expect(evaluatePolicy(state, url, now.getTime()).status).toBe('blocked');
    }
    expect(evaluatePolicy(state, 'https://google.com/', now.getTime()).status).toBe('allowed');
  });

  it('returns remaining allowance before the limit', () => {
    const now = at(2026, 10, 3, 12); const state = createDefaultState(); state.rules = [rule()];
    state.usage[localDateKey(now)] = { dateKey: localDateKey(now), millisecondsByRule: { youtube: 5 * 60_000 } };
    expect(evaluatePolicy(state, 'https://youtube.com', now.getTime()).remainingMilliseconds).toBe(25 * 60_000);
  });

  it('uses weekday-specific allowance and local midnight reset boundaries', () => {
    const now = at(2026, 10, 2, 23, 59); const state = createDefaultState();
    state.rules = [rule({ dailyAllowance: { defaultMinutes: 30, byWeekday: { 1: 10 } } })];
    state.usage[localDateKey(now)] = { dateKey: localDateKey(now), millisecondsByRule: { youtube: 10 * 60_000 } };
    const decision = evaluatePolicy(state, 'https://youtube.com', now.getTime());
    expect(decision.status).toBe('blocked');
    expect(decision.nextAccessAt).toBe(at(2026, 10, 3, 0).getTime());
    expect(evaluatePolicy(state, 'https://youtube.com', at(2026, 10, 3, 0).getTime()).status).toBe('allowed');
  });

  it('handles same-day and overnight weekly schedules', () => {
    const work: WeeklySchedule = { id: 'work', days: [1,2,3,4,5], startMinute: 9*60, endMinute: 17*60 };
    const night: WeeklySchedule = { id: 'night', days: [1,2,3,4,5,6,0], startMinute: 22*60, endMinute: 7*60 };
    expect(isScheduleActive(work, at(2026, 10, 2, 10))).toBe(true);
    expect(isScheduleActive(work, at(2026, 10, 2, 18))).toBe(false);
    expect(isScheduleActive(night, at(2026, 10, 2, 23))).toBe(true);
    expect(isScheduleActive(night, at(2026, 10, 3, 6))).toBe(true);
    expect(isScheduleActive(night, at(2026, 10, 3, 8))).toBe(false);
  });

  it('requires all overlapping restrictions to end', () => {
    const now = at(2026, 10, 2, 23); const state = createDefaultState();
    state.rules = [rule({ schedules: [{ id:'night', days:[1], startMinute:22*60, endMinute:7*60 }] })];
    state.usage[localDateKey(now)] = { dateKey: localDateKey(now), millisecondsByRule: { youtube: 30 * 60_000 } };
    const decision = evaluatePolicy(state, 'https://youtube.com', now.getTime());
    expect(decision.reasons).toEqual(['daily-limit', 'schedule']);
    expect(decision.nextAccessAt).toBe(at(2026, 10, 3, 7).getTime());
  });

  it('shares one unexpired override across URLs and lets it survive state reload', () => {
    const now = Date.now(); const state = createDefaultState(); state.rules = [rule()];
    state.usage[localDateKey(new Date(now))] = { dateKey: localDateKey(new Date(now)), millisecondsByRule: { youtube: 99 * 60_000 } };
    state.overrides.youtube = { ruleId: 'youtube', startedAt: now - 1000, expiresAt: now + 9 * 60_000 };
    expect(evaluatePolicy(structuredClone(state), 'https://youtu.be/video', now).status).toBe('temporarily-unlocked');
    expect(evaluatePolicy(state, 'https://youtube.com/video', now + 10 * 60_000).status).toBe('blocked');
  });
});
