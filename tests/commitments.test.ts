import { describe, expect, it } from 'vitest';
import { applyMaturePendingChange, isWeakeningChange, mutateRule, requestRemoval, weakeningReasons } from '@core/commitments';
import type { WebsiteRule } from '@shared/index';

const base = (): WebsiteRule => ({
  id: 'r', label: 'Reddit', domains: ['reddit.com', 'redd.it'], enabled: true, dailyAllowance: { defaultMinutes: 20 },
  schedules: [{ id: 's', days: [1], startMinute: 540, endMinute: 1020 }], commitmentEndsAt: 10_000, enforcementMode: 'pin', createdAt: 1, updatedAt: 1
});

describe('commitment locking', () => {
  it('classifies every loosening as weakening', () => {
    expect(isWeakeningChange(base(), { ...base(), dailyAllowance: { defaultMinutes: 30 } })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), dailyAllowance: undefined })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), dailyAllowance: { defaultMinutes: 20, byWeekday: { 6: 60 } } })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), enabled: false })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), schedules: [{ id: 's', days: [1], startMinute: 600, endMinute: 900 }] })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), schedules: [] })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), domains: ['example.com'] })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), domains: ['reddit.com'] })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), commitmentEndsAt: undefined })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), commitmentEndsAt: 9_000 })).toBe(true);
  });

  it('treats stricter or neutral edits as not weakening', () => {
    expect(isWeakeningChange(base(), { ...base(), dailyAllowance: { defaultMinutes: 5, byWeekday: { 0: 0 } } })).toBe(false);
    expect(isWeakeningChange(base(), { ...base(), schedules: [{ id: 'x', days: [1, 2], startMinute: 480, endMinute: 1080 }] })).toBe(false);
    expect(isWeakeningChange(base(), { ...base(), domains: ['reddit.com', 'redd.it', 'old-reddit.example'] })).toBe(false);
    expect(isWeakeningChange(base(), { ...base(), label: 'Renamed', commitmentEndsAt: 20_000 })).toBe(false);
  });

  it('applies stricter changes immediately while committed', () => {
    const result = mutateRule(base(), { ...base(), dailyAllowance: { defaultMinutes: 10 }, commitmentEndsAt: 50_000 }, 5_000);
    expect(result.outcome).toBe('applied');
    expect(result.rule.dailyAllowance?.defaultMinutes).toBe(10);
    expect(result.rule.commitmentEndsAt).toBe(50_000);
  });

  it('queues weakening changes and leaves the live rule untouched', () => {
    const result = mutateRule(base(), { ...base(), enabled: false, dailyAllowance: { defaultMinutes: 5 } }, 5_000);
    expect(result.outcome).toBe('pending');
    expect(result.rule.enabled).toBe(true);
    expect(result.rule.dailyAllowance?.defaultMinutes).toBe(20);
    expect(applyMaturePendingChange(result.rule, 9_999)?.enabled).toBe(true);
    expect(applyMaturePendingChange(result.rule, 10_000)?.enabled).toBe(false);
  });

  it('cannot remove the commitment by omitting it from an otherwise neutral edit', () => {
    const result = mutateRule(base(), { ...base(), label: 'Reddit!', commitmentEndsAt: undefined }, 5_000);
    expect(result.outcome).toBe('pending');
    expect(result.rule.commitmentEndsAt).toBe(10_000);
  });

  it('ignores identity fields supplied by the caller', () => {
    const result = mutateRule(base(), { ...base(), id: 'other', createdAt: 99, pendingChange: { requestedAt: 0, applyAt: 0, patch: { enabled: false } } }, 5_000);
    expect(result.rule.id).toBe('r');
    expect(result.rule.createdAt).toBe(1);
    expect(result.rule.pendingChange).toBeUndefined();
  });

  it('allows any edit once the commitment has ended', () => {
    expect(mutateRule(base(), { ...base(), enabled: false }, 10_000).outcome).toBe('applied');
  });

  it('defers a queued change until an extended commitment ends', () => {
    const pending = mutateRule(base(), { ...base(), enabled: false }, 5_000).rule;
    const extended = mutateRule(pending, { ...pending, commitmentEndsAt: 30_000 }, 6_000).rule;
    expect(applyMaturePendingChange(extended, 20_000)?.enabled).toBe(true);
    expect(applyMaturePendingChange(extended, 30_000)?.enabled).toBe(false);
  });

  it('queues removal of a committed rule and removes it at expiry', () => {
    const result = requestRemoval(base(), 5_000);
    expect(result.outcome).toBe('pending');
    if (result.outcome !== 'pending') return;
    expect(applyMaturePendingChange(result.rule, 9_999)).toBeDefined();
    expect(applyMaturePendingChange(result.rule, 10_000)).toBeUndefined();
    expect(requestRemoval(base(), 10_000).outcome).toBe('removed');
  });

  it('explains why a change is queued', () => {
    expect(weakeningReasons(base(), { ...base(), enabled: false, domains: ['reddit.com'] })).toEqual(['turns the restriction off', 'removes a restricted website']);
  });
});
