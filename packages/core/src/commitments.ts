import type { PendingRuleChange, WebsiteRule } from '@shared/index';

function allowanceFor(rule: WebsiteRule, day: number): number | undefined {
  return rule.dailyAllowance?.byWeekday?.[day as 0 | 1 | 2 | 3 | 4 | 5 | 6]
    ?? rule.dailyAllowance?.defaultMinutes;
}

function scheduleCoverage(rule: WebsiteRule): Set<string> {
  const slots = new Set<string>();
  for (const schedule of rule.schedules) {
    for (const day of schedule.days) {
      if (schedule.startMinute === schedule.endMinute) {
        for (let minute = 0; minute < 1440; minute += 1) slots.add(`${day}:${minute}`);
      } else if (schedule.startMinute < schedule.endMinute) {
        for (let minute = schedule.startMinute; minute < schedule.endMinute; minute += 1) slots.add(`${day}:${minute}`);
      } else {
        for (let minute = schedule.startMinute; minute < 1440; minute += 1) slots.add(`${day}:${minute}`);
        const nextDay = ((day + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
        for (let minute = 0; minute < schedule.endMinute; minute += 1) slots.add(`${nextDay}:${minute}`);
      }
    }
  }
  return slots;
}

export function isWeakeningChange(current: WebsiteRule, proposed: WebsiteRule): boolean {
  if (current.enabled && !proposed.enabled) return true;
  for (let day = 0; day < 7; day += 1) {
    const before = allowanceFor(current, day);
    const after = allowanceFor(proposed, day);
    if (before !== undefined && (after === undefined || after > before)) return true;
  }
  const proposedSlots = scheduleCoverage(proposed);
  for (const slot of scheduleCoverage(current)) if (!proposedSlots.has(slot)) return true;
  return false;
}

export type RuleMutationResult =
  | { outcome: 'applied'; rule: WebsiteRule }
  | { outcome: 'pending'; rule: WebsiteRule; pending: PendingRuleChange };

export function mutateRule(current: WebsiteRule, proposed: WebsiteRule, now: number): RuleMutationResult {
  const committed = Boolean(current.commitmentEndsAt && current.commitmentEndsAt > now);
  if (!committed || !isWeakeningChange(current, proposed)) {
    return { outcome: 'applied', rule: { ...proposed, pendingChange: current.pendingChange, updatedAt: now } };
  }
  const pending: PendingRuleChange = {
    requestedAt: now,
    applyAt: current.commitmentEndsAt!,
    patch: {
      enabled: proposed.enabled,
      dailyAllowance: proposed.dailyAllowance,
      schedules: proposed.schedules
    }
  };
  return { outcome: 'pending', pending, rule: { ...current, pendingChange: pending, updatedAt: now } };
}

export function applyMaturePendingChange(rule: WebsiteRule, now: number): WebsiteRule {
  if (!rule.pendingChange || rule.pendingChange.applyAt > now) return rule;
  return { ...rule, ...rule.pendingChange.patch, pendingChange: undefined, updatedAt: now };
}
