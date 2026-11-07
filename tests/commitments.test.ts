import { describe, expect, it } from 'vitest';
import { applyMaturePendingChange, isWeakeningChange, mutateRule } from '@core/commitments';
import type { WebsiteRule } from '@shared/index';

const base = (): WebsiteRule => ({ id:'r', label:'Reddit', domains:['reddit.com'], enabled:true, dailyAllowance:{ defaultMinutes:20 }, schedules:[{ id:'s', days:[1], startMinute:540, endMinute:1020 }], commitmentEndsAt:10_000, enforcementMode:'pin', createdAt:1, updatedAt:1 });

describe('commitment locking', () => {
  it('classifies more time, disabling, and shorter schedules as weakening', () => {
    expect(isWeakeningChange(base(), { ...base(), dailyAllowance:{ defaultMinutes:30 } })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), enabled:false })).toBe(true);
    expect(isWeakeningChange(base(), { ...base(), schedules:[{ id:'s', days:[1], startMinute:600, endMinute:900 }] })).toBe(true);
  });

  it('applies stricter changes during commitment', () => {
    const proposed = { ...base(), dailyAllowance:{ defaultMinutes:10 } };
    const result = mutateRule(base(), proposed, 5_000);
    expect(result.outcome).toBe('applied');
    expect(result.rule.dailyAllowance?.defaultMinutes).toBe(10);
  });

  it('queues weakening changes and applies them only at expiry', () => {
    const result = mutateRule(base(), { ...base(), enabled:false }, 5_000);
    expect(result.outcome).toBe('pending'); expect(result.rule.enabled).toBe(true);
    expect(applyMaturePendingChange(result.rule, 9_999).enabled).toBe(true);
    expect(applyMaturePendingChange(result.rule, 10_000).enabled).toBe(false);
  });
});
