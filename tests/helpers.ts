import { createDefaultState, emptyUsageDay } from '@core/defaults';
import { localDateKey } from '@core/date';
import type { AppState, WebsiteRule } from '@shared/index';

/** Local-time constructor (TZ is fixed to America/New_York in vitest.config.ts). month is 0-based. */
export const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => new Date(year, month, day, hour, minute, second).getTime();
export const MIN = 60_000;

export const rule = (patch: Partial<WebsiteRule> = {}): WebsiteRule => ({
  id: 'youtube', label: 'YouTube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], enabled: true,
  dailyAllowance: { defaultMinutes: 30 }, schedules: [], enforcementMode: 'pin', createdAt: 1, updatedAt: 1, ...patch
});

export function stateWith(rules: WebsiteRule[], patch: Partial<AppState> = {}): AppState {
  return { ...createDefaultState(), rules, ...patch };
}

export function setUsage(state: AppState, ms: number, ruleId: string, now: number): AppState {
  const key = localDateKey(new Date(now));
  state.usage[key] = state.usage[key] ?? emptyUsageDay(key);
  state.usage[key].millisecondsByRule[ruleId] = ms;
  return state;
}

export class Clock {
  constructor(public value: number) {}
  now = () => this.value;
  advance(ms: number) { this.value += ms; return this.value; }
}
