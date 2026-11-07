import { describe, expect, it } from 'vitest';
import { createDefaultState, migrateState } from '@core/defaults';
import { MemoryStateStore } from '@core/store';
import { rule } from './helpers';

describe('storage persistence', () => {
  it('round-trips state through serialization (browser restart)', async () => {
    const store = new MemoryStateStore();
    await store.update((state) => ({ ...state, rules: [rule({ commitmentEndsAt: 123_456 })], overrides: { youtube: { ruleId: 'youtube', startedAt: 1, expiresAt: 2 } } }));
    const reopened = await store.reopen().get();
    expect(reopened.rules[0].commitmentEndsAt).toBe(123_456);
    expect(reopened.overrides.youtube.expiresAt).toBe(2);
  });

  it('migrates the original schema without loosening anything', () => {
    const legacy = {
      schemaVersion: 1, onboardingComplete: true, pinAttempts: { failedAttempts: 2 },
      rules: [{ ...rule({ commitmentEndsAt: 999 }), schedules: undefined }],
      usage: { '2026-11-01': { dateKey: '2026-11-01', millisecondsByRule: { youtube: 5 } } },
      overrides: {}, overrideHistory: [{ id: 'a', ruleId: 'youtube', startedAt: 1, expiresAt: 2 }],
      feedSettings: { globalEnabled: false, sites: { youtube: { home: false } } },
      protection: { browser: 'chrome', privateAccess: 'unavailable' }, trackingEnabled: true, warningsEnabled: true
    };
    const state = migrateState(legacy);
    expect(state.schemaVersion).toBe(2);
    expect(state.rules[0].commitmentEndsAt).toBe(999);
    expect(state.rules[0].schedules).toEqual([]);
    expect(state.usage['2026-11-01'].millisecondsByRule.youtube).toBe(5);
    expect(state.usage['2026-11-01'].overrideMillisecondsByRule).toEqual({});
    expect(state.feedSettings.globalEnabled).toBe(false);
    expect(state.feedSettings.sites.youtube.home).toBe(false);
    expect(state.feedSettings.sites.youtube.shorts).toBe(true);
    expect(state.protection.privateAccess).toBe('unverified');
    expect(state.pinAttempts.failedAttempts).toBe(2);
  });

  it('falls back to defaults for missing or corrupt storage', () => {
    expect(migrateState(undefined)).toEqual(createDefaultState());
    expect(migrateState('garbage')).toEqual(createDefaultState());
  });

  it('keeps working after a failed update', async () => {
    const store = new MemoryStateStore();
    await expect(store.update(() => { throw new Error('disk full'); })).rejects.toThrow('disk full');
    const next = await store.update((state) => ({ ...state, warningsEnabled: false }));
    expect(next.warningsEnabled).toBe(false);
  });
});
