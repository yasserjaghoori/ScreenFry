import type { AppState, BrowserKind, FeedSettings, FeedSite, UsageDay } from '@shared/index';

export const OVERRIDE_MS = 10 * 60_000;
export const USAGE_RETENTION_DAYS = 120;
export const OVERRIDE_HISTORY_LIMIT = 500;

export const feedDefaults: FeedSettings = {
  globalEnabled: true,
  sites: {
    youtube: { home: true, shorts: true, recommendations: true, comments: false },
    x: { forYou: true, following: false, trending: true },
    instagram: { home: true, reels: true, explore: true },
    reddit: { home: true, popular: true, recommendations: true },
    facebook: { main: true, suggested: true },
    linkedin: { main: true, recommended: true }
  }
};

export function createDefaultState(browser: BrowserKind = 'chrome'): AppState {
  return {
    schemaVersion: 2,
    onboardingComplete: false,
    pinAttempts: { failedAttempts: 0 },
    rules: [],
    usage: {},
    overrides: {},
    overrideHistory: [],
    feedSettings: structuredClone(feedDefaults),
    protection: { browser, privateAccess: 'unverified' },
    trackingEnabled: true,
    warningsEnabled: true
  };
}

export function emptyUsageDay(dateKey: string): UsageDay {
  return { dateKey, millisecondsByRule: {}, overrideMillisecondsByRule: {}, millisecondsByHost: {}, warningsSent: {} };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Accepts anything read from storage (older schema, partially written, or hand-edited) and
 * returns a complete AppState. Unknown values fall back to safe defaults; nothing is loosened:
 * rules and commitments are preserved as stored.
 */
export function migrateState(raw: unknown, browser: BrowserKind = 'chrome'): AppState {
  const base = createDefaultState(browser);
  if (!isObject(raw)) return base;
  const state = { ...base, ...raw } as AppState;
  state.schemaVersion = 2;
  state.pinAttempts = isObject(raw.pinAttempts) ? { failedAttempts: Number(raw.pinAttempts.failedAttempts) || 0, cooldownUntil: raw.pinAttempts.cooldownUntil as number | undefined } : base.pinAttempts;
  state.rules = Array.isArray(raw.rules) ? (raw.rules as AppState['rules']).map((rule) => ({ ...rule, schedules: rule.schedules ?? [], domains: rule.domains ?? [], enforcementMode: rule.enforcementMode ?? 'pin' })) : [];
  state.usage = {};
  if (isObject(raw.usage)) {
    for (const [key, day] of Object.entries(raw.usage)) {
      if (!isObject(day)) continue;
      state.usage[key] = { ...emptyUsageDay(key), ...(day as Partial<UsageDay>), dateKey: key };
    }
  }
  state.overrides = isObject(raw.overrides) ? raw.overrides as AppState['overrides'] : {};
  state.overrideHistory = Array.isArray(raw.overrideHistory) ? (raw.overrideHistory as AppState['overrideHistory']).map((entry) => ({ ...entry, label: entry.label ?? 'Website' })) : [];
  const feeds = isObject(raw.feedSettings) ? raw.feedSettings as Partial<FeedSettings> : {};
  state.feedSettings = { globalEnabled: feeds.globalEnabled ?? true, sites: structuredClone(feedDefaults.sites) };
  for (const site of Object.keys(feedDefaults.sites) as FeedSite[]) {
    state.feedSettings.sites[site] = { ...feedDefaults.sites[site], ...(feeds.sites?.[site] ?? {}) };
  }
  const protection = isObject(raw.protection) ? raw.protection as Partial<AppState['protection']> : {};
  const status = protection.privateAccess;
  state.protection = {
    browser,
    privateAccess: status === 'verified' || status === 'observed' ? status : 'unverified',
    lastCheckedAt: protection.lastCheckedAt,
    lastObservedAt: protection.lastObservedAt
  };
  return state;
}
