import type { AppState, FeedSettings } from '@shared/index';

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

export function createDefaultState(browser: 'chrome' | 'safari' = 'chrome'): AppState {
  return {
    schemaVersion: 1,
    onboardingComplete: false,
    pinAttempts: { failedAttempts: 0 },
    rules: [],
    usage: {},
    overrides: {},
    overrideHistory: [],
    feedSettings: structuredClone(feedDefaults),
    protection: { browser, privateAccess: browser === 'chrome' ? 'unverified' : 'unavailable' },
    trackingEnabled: true,
    warningsEnabled: true
  };
}
