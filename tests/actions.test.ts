import { beforeEach, describe, expect, it } from 'vitest';
import * as actions from '@core/actions';
import { MemoryStateStore } from '@core/store';
import { localDateKey } from '@core/date';
import { evaluatePolicy } from '@policy/index';
import type { WebsiteRule } from '@shared/index';
import { Clock, MIN, at, rule, setUsage } from './helpers';

const PIN = '482915';
let clock: Clock;
let store: MemoryStateStore;
let ctx: actions.ActionContext;

async function setup(rules: WebsiteRule[] = [], usageMs?: number) {
  clock = new Clock(at(2026, 10, 3, 12));
  store = new MemoryStateStore();
  ctx = { store, now: clock.now };
  expect((await actions.createPin(ctx, PIN)).ok).toBe(true);
  await actions.completeOnboarding(ctx);
  for (const item of rules) expect((await actions.saveRule(ctx, item)).ok).toBe(true);
  if (usageMs !== undefined) await store.update((state) => setUsage(state, usageMs, rules[0].id, clock.value));
}

describe('PIN setup and changes', () => {
  beforeEach(() => setup());

  it('stores only a verifier and rejects malformed PINs', async () => {
    const state = await store.get();
    expect(JSON.stringify(state)).not.toContain(PIN);
    expect((await actions.createPin({ store: new MemoryStateStore(), now: clock.now }, '12345')).ok).toBe(false);
    expect((await actions.createPin({ store: new MemoryStateStore(), now: clock.now }, 'abcdef')).ok).toBe(false);
  });

  it('refuses to overwrite an existing PIN without the current one', async () => {
    const result = await actions.createPin(ctx, '000000');
    expect(result.ok).toBe(false);
    expect((await actions.changePin(ctx, '111111', '000000')).ok).toBe(false);
    expect((await actions.changePin(ctx, PIN, '000000')).ok).toBe(true);
    expect((await actions.changePin(ctx, PIN, '222222')).ok).toBe(false);
  });

  it('requires a PIN before restrictions can be created', async () => {
    const bare = { store: new MemoryStateStore(), now: clock.now };
    expect((await actions.saveRule(bare, rule())).ok).toBe(false);
    expect((await actions.completeOnboarding(bare)).ok).toBe(false);
  });
});

describe('PIN overrides', () => {
  beforeEach(() => setup([rule()], 30 * MIN));

  it('grants exactly 10 minutes, shared by every URL of the site', async () => {
    const result = await actions.requestOverride(ctx, 'https://www.youtube.com/watch?v=1', PIN);
    expect(result.ok && result.data.expiresAt - result.data.startedAt).toBe(10 * MIN);
    const state = await store.get();
    expect(evaluatePolicy(state, 'https://youtu.be/x', clock.advance(9 * MIN)).status).toBe('temporarily-unlocked');
    expect(evaluatePolicy(state, 'https://m.youtube.com', clock.advance(MIN)).status).toBe('blocked');
  });

  it('does not create a second allowance from another tab', async () => {
    const first = await actions.requestOverride(ctx, 'https://youtube.com/a', PIN);
    clock.advance(4 * MIN);
    const second = await actions.requestOverride(ctx, 'https://youtube.com/b', PIN);
    expect(second.ok && second.data.alreadyActive).toBe(true);
    expect(first.ok && second.ok && second.data.expiresAt).toBe(first.ok ? first.data.expiresAt : -1);
    expect((await store.get()).overrideHistory).toHaveLength(1);
  });

  it('survives a browser restart without restarting the timer', async () => {
    const result = await actions.requestOverride(ctx, 'https://youtube.com', PIN);
    const reopened = store.reopen();
    clock.advance(5 * MIN);
    await actions.maintain({ store: reopened, now: clock.now });
    const state = await reopened.get();
    expect(state.overrides.youtube.expiresAt).toBe(result.ok ? result.data.expiresAt : 0);
    expect(evaluatePolicy(state, 'https://youtube.com', clock.advance(5 * MIN)).status).toBe('blocked');
  });

  it('reapplies restrictions and requires the PIN again after expiry', async () => {
    await actions.requestOverride(ctx, 'https://youtube.com', PIN);
    clock.advance(10 * MIN);
    await actions.maintain(ctx);
    const state = await store.get();
    expect(state.overrides.youtube).toBeUndefined();
    expect(evaluatePolicy(state, 'https://youtube.com', clock.value).status).toBe('blocked');
    expect((await actions.requestOverride(ctx, 'https://youtube.com', '000000')).ok).toBe(false);
    expect((await actions.requestOverride(ctx, 'https://youtube.com', PIN)).ok).toBe(true);
  });

  it('never changes the rule, today’s usage or the commitment', async () => {
    await store.update((state) => { state.rules[0].commitmentEndsAt = clock.value + 7 * 24 * 60 * MIN; return state; });
    const before = await store.get();
    await actions.requestOverride(ctx, 'https://youtube.com', PIN);
    const after = await store.get();
    expect(after.rules).toEqual(before.rules);
    expect(after.usage).toEqual(before.usage);
  });

  it('escalates cooldowns on wrong PINs and blocks attempts during them', async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) expect((await actions.requestOverride(ctx, 'https://youtube.com', '000000') as { cooldownUntil?: number }).cooldownUntil).toBeUndefined();
    const third = await actions.requestOverride(ctx, 'https://youtube.com', '000000');
    expect(third.ok ? 0 : third.cooldownUntil).toBe(clock.value + 30_000);
    const duringCooldown = await actions.requestOverride(ctx, 'https://youtube.com', PIN);
    expect(duringCooldown.ok).toBe(false);
    clock.advance(30_000);
    const fourth = await actions.requestOverride(ctx, 'https://youtube.com', '000000');
    expect(fourth.ok ? 0 : fourth.cooldownUntil).toBe(clock.value + 60_000);
    clock.advance(60_000);
    expect((await actions.requestOverride(ctx, 'https://youtube.com', PIN)).ok).toBe(true);
    expect((await store.get()).pinAttempts.failedAttempts).toBe(0);
  });

  it('refuses overrides for sites that are not blocked', async () => {
    expect((await actions.requestOverride(ctx, 'https://example.com', PIN)).ok).toBe(false);
  });

  it('records override history', async () => {
    await actions.requestOverride(ctx, 'https://youtube.com', PIN);
    expect((await store.get()).overrideHistory[0]).toMatchObject({ ruleId: 'youtube', label: 'YouTube' });
  });
});

describe('commitment enforcement through actions', () => {
  const sealed = () => rule({ commitmentEndsAt: at(2026, 10, 10, 12) });
  beforeEach(() => setup([sealed()]));

  it('queues an allowance increase', async () => {
    const result = await actions.saveRule(ctx, { ...sealed(), dailyAllowance: { defaultMinutes: 120 } });
    expect(result.ok && result.data.outcome).toBe('pending');
    expect((await store.get()).rules[0].dailyAllowance?.defaultMinutes).toBe(30);
  });

  it('queues swapping the website for another', async () => {
    const result = await actions.saveRule(ctx, { ...sealed(), domains: ['example.com'] });
    expect(result.ok && result.data.outcome).toBe('pending');
    expect((await store.get()).rules[0].domains).toContain('youtube.com');
  });

  it('queues removing the commitment date', async () => {
    const result = await actions.saveRule(ctx, { ...sealed(), commitmentEndsAt: undefined });
    expect(result.ok && result.data.outcome).toBe('pending');
    expect((await store.get()).rules[0].commitmentEndsAt).toBe(at(2026, 10, 10, 12));
  });

  it('queues deletion and applies it when the commitment ends', async () => {
    const result = await actions.deleteRule(ctx, 'youtube');
    expect(result.ok && result.data.outcome).toBe('pending');
    expect((await store.get()).rules).toHaveLength(1);
    clock.value = at(2026, 10, 10, 12);
    await actions.maintain(ctx);
    expect((await store.get()).rules).toHaveLength(0);
  });

  it('applies stricter edits and extensions immediately', async () => {
    const result = await actions.saveRule(ctx, { ...sealed(), dailyAllowance: { defaultMinutes: 10 }, commitmentEndsAt: at(2026, 11, 3) });
    expect(result.ok && result.data.outcome).toBe('applied');
    const saved = (await store.get()).rules[0];
    expect(saved.dailyAllowance?.defaultMinutes).toBe(10);
    expect(saved.commitmentEndsAt).toBe(at(2026, 11, 3));
  });

  it('cannot enable strict mode or otherwise smuggle fields through saveRule', async () => {
    await actions.saveRule(ctx, { ...sealed(), enforcementMode: 'strict' });
    expect((await store.get()).rules[0].enforcementMode).toBe('pin');
  });

  it('keeps the rule enabled after the commitment expires', async () => {
    clock.value = at(2026, 10, 10, 13);
    await actions.maintain(ctx);
    const saved = (await store.get()).rules[0];
    expect(saved.enabled).toBe(true);
    expect((await actions.saveRule(ctx, { ...saved, dailyAllowance: { defaultMinutes: 90 } })).ok && (await store.get()).rules[0].dailyAllowance?.defaultMinutes).toBe(90);
  });

  it('keeps today’s usage for committed limits when history is deleted', async () => {
    await store.update((state) => setUsage(state, 12 * MIN, 'youtube', clock.value));
    await actions.deleteHistory(ctx);
    const state = await store.get();
    expect(state.usage[localDateKey(new Date(clock.value))].millisecondsByRule.youtube).toBe(12 * MIN);
  });

  it('refuses a full reset while a commitment is active', async () => {
    expect((await actions.resetAll(ctx, PIN)).ok).toBe(false);
    clock.value = at(2026, 10, 11);
    expect((await actions.resetAll(ctx, '000000')).ok).toBe(false);
    expect((await actions.resetAll(ctx, PIN)).ok).toBe(true);
    expect((await store.get()).pin).toBeUndefined();
  });

  it('cannot recreate the PIN to escape cooldowns once onboarding is complete', async () => {
    expect((await actions.createPin(ctx, '000000')).ok).toBe(false);
  });
});

describe('rule validation', () => {
  beforeEach(() => setup());

  it('normalizes domains and expands product aliases', async () => {
    const result = await actions.saveRule(ctx, rule({ id: 'x', label: '', domains: ['https://www.X.com/home'] }));
    const saved = (await store.get()).rules[0];
    expect(result.ok).toBe(true);
    expect(saved.domains).toEqual(['x.com', 'twitter.com']);
    expect(saved.label).toBe('x.com');
  });

  it('rejects invalid input', async () => {
    expect((await actions.saveRule(ctx, rule({ domains: ['not a domain'] }))).ok).toBe(false);
    expect((await actions.saveRule(ctx, rule({ dailyAllowance: undefined, schedules: [] }))).ok).toBe(false);
    expect((await actions.saveRule(ctx, rule({ dailyAllowance: { defaultMinutes: -5 } }))).ok).toBe(false);
    expect((await actions.saveRule(ctx, rule({ schedules: [{ id: 's', days: [], startMinute: 0, endMinute: 60 }] }))).ok).toBe(false);
    expect((await actions.saveRule(ctx, rule({ commitmentEndsAt: clock.value + 400 * 86_400_000 }))).ok).toBe(false);
  });
});

describe('clock changes', () => {
  beforeEach(() => setup([rule()], 30 * MIN));

  it('flags a backwards clock and discards an override that now appears to start in the future', async () => {
    await actions.requestOverride(ctx, 'https://youtube.com', PIN);
    await actions.maintain(ctx);
    clock.advance(-60 * MIN);
    const state = await actions.maintain(ctx);
    expect(state.possibleClockRollbackAt).toBe(clock.value);
    expect(state.overrides.youtube).toBeUndefined();
  });

  it('caps a PIN cooldown that a rolled-back clock would stretch to days', async () => {
    await store.update((state) => ({ ...state, pinAttempts: { failedAttempts: 9, cooldownUntil: clock.value + 5 * 24 * 60 * MIN } }));
    const state = await actions.maintain(ctx);
    expect(state.pinAttempts.cooldownUntil).toBe(clock.value + 60 * MIN);
  });
});
