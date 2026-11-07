import { describe, expect, it } from 'vitest';
import { evaluatePolicy, isScheduleActive, nextAccessTime, nextPolicyBoundary, upcomingScheduleWindows } from '@policy/index';
import type { WeeklySchedule } from '@shared/index';
import { MIN, at, rule, setUsage, stateWith } from './helpers';

// 2026-11-02 is a Monday.
describe('daily limits', () => {
  it('blocks every YouTube URL form once the limit is used, and nothing unrelated', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 30 * MIN, 'youtube', now);
    for (const url of [
      'https://youtube.com/', 'https://www.youtube.com/watch?v=abc', 'https://m.youtube.com/shorts/abc', 'https://youtu.be/abc?t=4',
      'https://www.youtube-nocookie.com/embed/abc', 'https://music.youtube.com/', 'http://YOUTUBE.com./feed'
    ]) expect(evaluatePolicy(state, url, now).status, url).toBe('blocked');
    for (const url of ['https://google.com/search?q=youtube', 'https://notyoutube.com/', 'https://youtube.com.evil.example/', 'chrome://extensions']) {
      expect(evaluatePolicy(state, url, now).status, url).toBe('allowed');
    }
  });

  it('reports remaining allowance before the limit', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 5 * MIN, 'youtube', now);
    const decision = evaluatePolicy(state, 'https://youtube.com', now);
    expect(decision.status).toBe('allowed');
    expect(decision.remainingMilliseconds).toBe(25 * MIN);
  });

  it('uses weekday allowances and resets at local midnight', () => {
    const now = at(2026, 10, 2, 23, 59); // Monday
    const state = setUsage(stateWith([rule({ dailyAllowance: { defaultMinutes: 30, byWeekday: { 1: 10 } } })]), 10 * MIN, 'youtube', now);
    const decision = evaluatePolicy(state, 'https://youtube.com', now);
    expect(decision.status).toBe('blocked');
    expect(decision.allowanceMinutes).toBe(10);
    expect(decision.nextAccessAt).toBe(at(2026, 10, 3, 0));
    expect(evaluatePolicy(state, 'https://youtube.com', at(2026, 10, 3, 0)).status).toBe('allowed');
  });

  it('skips days with a zero-minute allowance when computing next access', () => {
    const now = at(2026, 10, 6, 20); // Friday
    const state = setUsage(stateWith([rule({ dailyAllowance: { defaultMinutes: 30, byWeekday: { 6: 0, 0: 0 } } })]), 30 * MIN, 'youtube', now);
    expect(evaluatePolicy(state, 'https://youtube.com', now).nextAccessAt).toBe(at(2026, 10, 9, 0)); // Monday
  });

  it('resets correctly on DST days (25-hour day, Nov 1 2026)', () => {
    const now = at(2026, 10, 1, 22);
    const state = setUsage(stateWith([rule()]), 30 * MIN, 'youtube', now);
    expect(evaluatePolicy(state, 'https://youtube.com', now).nextAccessAt).toBe(at(2026, 10, 2, 0));
  });
});

describe('schedules', () => {
  const work: WeeklySchedule = { id: 'work', days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 };
  const night: WeeklySchedule = { id: 'night', days: [0, 1, 2, 3, 4, 5, 6], startMinute: 22 * 60, endMinute: 7 * 60 };

  it('handles same-day and overnight windows', () => {
    expect(isScheduleActive(work, new Date(at(2026, 10, 2, 10)))).toBe(true);
    expect(isScheduleActive(work, new Date(at(2026, 10, 2, 17)))).toBe(false);
    expect(isScheduleActive(work, new Date(at(2026, 10, 7, 10)))).toBe(false); // Saturday
    expect(isScheduleActive(night, new Date(at(2026, 10, 2, 23)))).toBe(true);
    expect(isScheduleActive(night, new Date(at(2026, 10, 3, 6, 59)))).toBe(true);
    expect(isScheduleActive(night, new Date(at(2026, 10, 3, 7)))).toBe(false);
  });

  it('continues an overnight window into a day not listed', () => {
    const friday: WeeklySchedule = { id: 'f', days: [5], startMinute: 23 * 60, endMinute: 2 * 60 };
    expect(isScheduleActive(friday, new Date(at(2026, 10, 7, 1)))).toBe(true); // Saturday 1 AM
  });

  it('reports the next access time at the end of the window', () => {
    const state = stateWith([rule({ dailyAllowance: undefined, schedules: [work] })]);
    const decision = evaluatePolicy(state, 'https://youtube.com', at(2026, 10, 2, 10, 30, 15));
    expect(decision.reasons).toEqual(['schedule']);
    expect(decision.nextAccessAt).toBe(at(2026, 10, 2, 17));
  });

  it('merges overlapping schedules', () => {
    const late: WeeklySchedule = { id: 'late', days: [1], startMinute: 16 * 60, endMinute: 19 * 60 };
    const state = stateWith([rule({ dailyAllowance: undefined, schedules: [work, late] })]);
    expect(evaluatePolicy(state, 'https://youtube.com', at(2026, 10, 2, 10)).nextAccessAt).toBe(at(2026, 10, 2, 19));
  });

  it('keeps access blocked until both an exhausted limit and a schedule have ended', () => {
    const now = at(2026, 10, 2, 23);
    const state = setUsage(stateWith([rule({ schedules: [night] })]), 30 * MIN, 'youtube', now);
    const decision = evaluatePolicy(state, 'https://youtube.com', now);
    expect(decision.reasons).toEqual(['daily-limit', 'schedule']);
    expect(decision.nextAccessAt).toBe(at(2026, 10, 3, 7));
  });

  it('respects a schedule that is active right at midnight after a limit', () => {
    const now = at(2026, 10, 2, 20);
    const early: WeeklySchedule = { id: 'e', days: [2], startMinute: 0, endMinute: 8 * 60 };
    const state = setUsage(stateWith([rule({ schedules: [early] })]), 30 * MIN, 'youtube', now);
    expect(evaluatePolicy(state, 'https://youtube.com', now).nextAccessAt).toBe(at(2026, 10, 3, 8));
  });

  it('reports no availability for an always-blocked rule', () => {
    const always: WeeklySchedule = { id: 'a', days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0 };
    const state = stateWith([rule({ dailyAllowance: undefined, schedules: [always] })]);
    expect(nextAccessTime(state, state.rules[0], at(2026, 10, 2, 9))).toBeUndefined();
  });

  it('evaluates in the current local zone across the DST change', () => {
    // 2026-11-01 01:30 happens twice in New York; a 1:00–3:00 block covers both.
    const block: WeeklySchedule = { id: 'b', days: [0], startMinute: 60, endMinute: 180 };
    const state = stateWith([rule({ dailyAllowance: undefined, schedules: [block] })]);
    const firstPass = at(2026, 10, 1, 1, 30);
    expect(evaluatePolicy(state, 'https://youtube.com', firstPass).status).toBe('blocked');
    expect(evaluatePolicy(state, 'https://youtube.com', firstPass + 60 * MIN).status).toBe('blocked');
    expect(evaluatePolicy(state, 'https://youtube.com', firstPass).nextAccessAt).toBe(at(2026, 10, 1, 3));
  });

  it('lists upcoming windows and the next boundary', () => {
    const state = stateWith([rule({ dailyAllowance: undefined, schedules: [work] })]);
    const now = at(2026, 10, 2, 7);
    expect(upcomingScheduleWindows(state, now)[0]).toMatchObject({ startsAt: at(2026, 10, 2, 9), endsAt: at(2026, 10, 2, 17) });
    expect(nextPolicyBoundary(state, now)).toBe(at(2026, 10, 2, 9));
  });
});

describe('overrides in the policy engine', () => {
  it('shares one override across URLs and expires it exactly after 10 minutes', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 99 * MIN, 'youtube', now);
    state.overrides.youtube = { ruleId: 'youtube', startedAt: now, expiresAt: now + 10 * MIN };
    expect(evaluatePolicy(state, 'https://youtu.be/video', now + 9 * MIN).status).toBe('temporarily-unlocked');
    expect(evaluatePolicy(state, 'https://m.youtube.com/', now + 10 * MIN - 1).overrideExpiresAt).toBe(now + 10 * MIN);
    expect(evaluatePolicy(state, 'https://youtube.com/video', now + 10 * MIN).status).toBe('blocked');
  });

  it('ignores overrides that start in the future (clock rolled back) or last longer than 10 minutes', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 99 * MIN, 'youtube', now);
    state.overrides.youtube = { ruleId: 'youtube', startedAt: now + 5 * MIN, expiresAt: now + 15 * MIN };
    expect(evaluatePolicy(state, 'https://youtube.com', now).status).toBe('blocked');
    state.overrides.youtube = { ruleId: 'youtube', startedAt: now - MIN, expiresAt: now + 24 * 60 * MIN };
    expect(evaluatePolicy(state, 'https://youtube.com', now).status).toBe('blocked');
  });

  it('refuses PIN visits for committed strict rules (future mode)', () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule({ enforcementMode: 'strict', commitmentEndsAt: now + 60 * MIN })]), 99 * MIN, 'youtube', now);
    state.overrides.youtube = { ruleId: 'youtube', startedAt: now, expiresAt: now + 10 * MIN };
    const decision = evaluatePolicy(state, 'https://youtube.com', now);
    expect(decision.status).toBe('blocked');
    expect(decision.canOverride).toBe(false);
  });

  it('uses the strictest rule when several cover a URL', () => {
    const now = at(2026, 10, 2, 10);
    const work: WeeklySchedule = { id: 'w', days: [1], startMinute: 9 * 60, endMinute: 12 * 60 };
    const state = stateWith([rule({ id: 'a', schedules: [] }), rule({ id: 'b', domains: ['youtube.com'], dailyAllowance: undefined, schedules: [work] })]);
    const decision = evaluatePolicy(state, 'https://youtube.com', now);
    expect(decision.status).toBe('blocked');
    expect(decision.ruleId).toBe('b');
  });
});
