import { domainCoveredBy } from './domains';
import type { DayOfWeek, PendingRuleChange, RulePatch, WebsiteRule } from '@shared/index';

export function isCommitted(rule: Pick<WebsiteRule, 'commitmentEndsAt'>, now: number): boolean {
  return Boolean(rule.commitmentEndsAt && rule.commitmentEndsAt > now);
}

function allowanceFor(rule: WebsiteRule, day: number): number | undefined {
  if (!rule.dailyAllowance) return undefined;
  return rule.dailyAllowance.byWeekday?.[day as DayOfWeek] ?? rule.dailyAllowance.defaultMinutes;
}

/** Every blocked (weekday, minute) slot in the weekly cycle, as a bitmap of 7 × 1440 minutes. */
export function scheduleCoverage(rule: Pick<WebsiteRule, 'schedules'>): Uint8Array {
  const slots = new Uint8Array(7 * 1440);
  const mark = (day: number, from: number, to: number) => slots.fill(1, day * 1440 + from, day * 1440 + to);
  for (const schedule of rule.schedules) {
    for (const day of schedule.days) {
      if (schedule.startMinute === schedule.endMinute) mark(day, 0, 1440);
      else if (schedule.startMinute < schedule.endMinute) mark(day, schedule.startMinute, schedule.endMinute);
      else {
        mark(day, schedule.startMinute, 1440);
        mark((day + 1) % 7, 0, schedule.endMinute);
      }
    }
  }
  return slots;
}

/** Human-readable list of the ways `proposed` is looser than `current`. Empty means not weaker. */
export function weakeningReasons(current: WebsiteRule, proposed: WebsiteRule): string[] {
  const reasons: string[] = [];
  if (current.enabled && !proposed.enabled) reasons.push('turns the restriction off');
  if (current.domains.some((domain) => !domainCoveredBy(domain, proposed.domains))) reasons.push('removes a restricted website');
  for (let day = 0; day < 7; day += 1) {
    const before = allowanceFor(current, day);
    const after = allowanceFor(proposed, day);
    if (before !== undefined && (after === undefined || after > before)) { reasons.push('increases or removes a daily allowance'); break; }
  }
  const before = scheduleCoverage(current);
  const after = scheduleCoverage(proposed);
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] && !after[index]) { reasons.push('shortens a blocked time window'); break; }
  }
  if (current.commitmentEndsAt && (!proposed.commitmentEndsAt || proposed.commitmentEndsAt < current.commitmentEndsAt)) {
    reasons.push('ends the commitment early');
  }
  if (current.enforcementMode === 'strict' && proposed.enforcementMode !== 'strict') reasons.push('relaxes the enforcement mode');
  return reasons;
}

export function isWeakeningChange(current: WebsiteRule, proposed: WebsiteRule): boolean {
  return weakeningReasons(current, proposed).length > 0;
}

export type RuleMutationResult =
  | { outcome: 'applied'; rule: WebsiteRule }
  | { outcome: 'pending'; rule: WebsiteRule; pending: PendingRuleChange; reasons: string[] };

/**
 * The single gate for editing an existing rule. Identity fields always come from the stored
 * rule, so a caller cannot smuggle in a different id, creation time or pending change.
 * While committed, any weakening edit is stored as a pending change and the live rule is unchanged.
 */
export function mutateRule(current: WebsiteRule, proposed: WebsiteRule, now: number): RuleMutationResult {
  const candidate: WebsiteRule = {
    ...proposed,
    id: current.id,
    createdAt: current.createdAt,
    pendingChange: current.pendingChange,
    updatedAt: now
  };
  if (!isCommitted(current, now)) return { outcome: 'applied', rule: candidate };
  const reasons = weakeningReasons(current, candidate);
  if (!reasons.length) return { outcome: 'applied', rule: candidate };
  const pending: PendingRuleChange = {
    requestedAt: now,
    applyAt: current.commitmentEndsAt!,
    patch: {
      label: candidate.label,
      domains: candidate.domains,
      enabled: candidate.enabled,
      dailyAllowance: candidate.dailyAllowance,
      schedules: candidate.schedules
    }
  };
  return { outcome: 'pending', pending, reasons, rule: { ...current, pendingChange: pending, updatedAt: now } };
}

export function requestRemoval(current: WebsiteRule, now: number): { outcome: 'removed' } | { outcome: 'pending'; rule: WebsiteRule } {
  if (!isCommitted(current, now)) return { outcome: 'removed' };
  const patch: RulePatch = { remove: true };
  return { outcome: 'pending', rule: { ...current, pendingChange: { requestedAt: now, applyAt: current.commitmentEndsAt!, patch }, updatedAt: now } };
}

/** Applies a pending change once the commitment (including any later extension) has ended. Returns undefined for a queued removal. */
export function applyMaturePendingChange(rule: WebsiteRule, now: number): WebsiteRule | undefined {
  if (!rule.pendingChange) return rule;
  const applyAt = Math.max(rule.pendingChange.applyAt, rule.commitmentEndsAt ?? 0);
  if (applyAt > now) return rule;
  const { remove, ...patch } = rule.pendingChange.patch;
  if (remove) return undefined;
  return { ...rule, ...patch, pendingChange: undefined, updatedAt: now };
}
