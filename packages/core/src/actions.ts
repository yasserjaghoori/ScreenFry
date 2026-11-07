/**
 * State transitions behind every extension message. All Sealproof rules are enforced here
 * (and in commitments.ts / the policy engine), never by hiding buttons in the UI.
 * Each function takes an injected store and clock so it can be tested without a browser.
 */
import { applyMaturePendingChange, isCommitted, mutateRule, requestRemoval } from './commitments';
import { createDefaultState, feedDefaults, OVERRIDE_HISTORY_LIMIT, OVERRIDE_MS } from './defaults';
import { expandDomainAliases, isValidDomain, normalizeDomain } from './domains';
import { localDateKey } from './date';
import { clearPinAttempts, createPinVerifier, recordFailedPin, validatePinFormat, verifyPin } from './pin';
import type { StateStore } from './store';
import { pruneUsage } from './tracking';
import { evaluatePolicy, evaluateRule, isOverrideActive, matchingRules } from '@policy/index';
import type { AppState, DayOfWeek, FeedSettings, FeedSite, PrivateAccessStatus, TemporaryOverride, WebsiteRule, WeeklySchedule } from '@shared/index';

export interface ActionContext { store: StateStore; now: () => number }
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; cooldownUntil?: number };

const fail = <T>(error: string, cooldownUntil?: number): ActionResult<T> => ({ ok: false, error, cooldownUntil });
const MAX_COMMITMENT_MS = 366 * 86_400_000;
const CLOCK_ROLLBACK_TOLERANCE_MS = 2 * 60_000;

export function hasActiveCommitment(state: AppState, now: number): boolean {
  return state.rules.some((rule) => isCommitted(rule, now));
}

// ───────────────────────────── PIN ─────────────────────────────

export async function createPin(ctx: ActionContext, pin: string): Promise<ActionResult<AppState>> {
  if (!validatePinFormat(pin)) return fail('PIN must be exactly six digits.');
  const state = await ctx.store.get();
  // A PIN can only be (re)created during onboarding, before anything depends on it.
  if (state.pin && (state.onboardingComplete || hasActiveCommitment(state, ctx.now()))) {
    return fail('A PIN already exists. Change it in Settings using your current PIN.');
  }
  const verifier = await createPinVerifier(pin);
  return { ok: true, data: await ctx.store.update((current) => ({ ...current, pin: verifier, pinAttempts: clearPinAttempts() })) };
}

/** Rate-limited PIN check shared by overrides, PIN changes and reset. */
async function checkPin(ctx: ActionContext, pin: string): Promise<ActionResult<true>> {
  const now = ctx.now();
  const state = await ctx.store.get();
  if (!state.pin) return fail('PIN setup is incomplete.');
  const cooldown = state.pinAttempts.cooldownUntil;
  if (cooldown && cooldown > now) return fail('Too many incorrect attempts. Try again after the cooldown.', cooldown);
  if (await verifyPin(pin, state.pin)) {
    await ctx.store.update((current) => ({ ...current, pinAttempts: clearPinAttempts() }));
    return { ok: true, data: true };
  }
  const updated = await ctx.store.update((current) => ({ ...current, pinAttempts: recordFailedPin(current.pinAttempts, now) }));
  return fail('Incorrect PIN.', updated.pinAttempts.cooldownUntil);
}

export async function changePin(ctx: ActionContext, currentPin: string, nextPin: string): Promise<ActionResult<AppState>> {
  if (!validatePinFormat(nextPin)) return fail('New PIN must be exactly six digits.');
  const check = await checkPin(ctx, currentPin);
  if (!check.ok) return check;
  const verifier = await createPinVerifier(nextPin);
  return { ok: true, data: await ctx.store.update((current) => ({ ...current, pin: verifier })) };
}

export async function pinStatus(ctx: ActionContext): Promise<ActionResult<{ hasPin: boolean; cooldownUntil?: number; failedAttempts: number }>> {
  const state = await ctx.store.get();
  const cooldown = state.pinAttempts.cooldownUntil;
  return { ok: true, data: { hasPin: Boolean(state.pin), failedAttempts: state.pinAttempts.failedAttempts, cooldownUntil: cooldown && cooldown > ctx.now() ? cooldown : undefined } };
}

// ─────────────────────────── Overrides ──────────────────────────

/**
 * Grants one 10-minute visit to every rule currently blocking `url`. The site is resolved by the
 * background from the URL, so a page cannot ask to unlock an arbitrary rule. If a visit is
 * already running, its existing expiry is returned and no new time is created.
 */
export async function requestOverride(ctx: ActionContext, url: string, pin: string): Promise<ActionResult<TemporaryOverride & { alreadyActive: boolean }>> {
  const now = ctx.now();
  const state = await ctx.store.get();
  const decision = evaluatePolicy(state, url, now);
  if (decision.status === 'temporarily-unlocked') {
    return { ok: true, data: { ruleId: decision.ruleId!, startedAt: state.overrides[decision.ruleId!].startedAt, expiresAt: decision.overrideExpiresAt!, alreadyActive: true } };
  }
  if (decision.status !== 'blocked') return fail('This website is not restricted right now.');
  if (!decision.canOverride) return fail('This commitment does not allow PIN visits.');
  const check = await checkPin(ctx, pin);
  if (!check.ok) return check;

  let granted: TemporaryOverride | undefined;
  await ctx.store.update((current) => {
    const at = ctx.now();
    for (const rule of matchingRules(current, url)) {
      const ruleDecision = evaluateRule(current, rule, at);
      if (ruleDecision.status === 'temporarily-unlocked') { granted ??= current.overrides[rule.id]; continue; }
      if (ruleDecision.status !== 'blocked' || !ruleDecision.canOverride) continue;
      const override: TemporaryOverride = { ruleId: rule.id, startedAt: at, expiresAt: at + OVERRIDE_MS };
      current.overrides[rule.id] = override;
      current.overrideHistory.unshift({ ...override, id: crypto.randomUUID(), label: rule.label });
      granted ??= override;
    }
    current.overrideHistory = current.overrideHistory.slice(0, OVERRIDE_HISTORY_LIMIT);
    return current;
  });
  return granted ? { ok: true, data: { ...granted, alreadyActive: false } } : fail('This website is not restricted right now.');
}

// ───────────────────────────── Rules ────────────────────────────

const clampMinutes = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1440 ? Math.round(number) : undefined;
};

function sanitizeSchedule(schedule: WeeklySchedule): WeeklySchedule | undefined {
  const days = [...new Set(schedule.days)].filter((day): day is DayOfWeek => Number.isInteger(day) && day >= 0 && day <= 6).sort();
  const start = Number(schedule.startMinute);
  const end = Number(schedule.endMinute);
  if (!days.length || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 1439 || end < 0 || end > 1439) return undefined;
  return { id: String(schedule.id || crypto.randomUUID()), days, startMinute: start, endMinute: end };
}

/** Validates untrusted input from a UI page and fills fields the client must not control. */
export function sanitizeRule(input: WebsiteRule, now: number): { rule?: WebsiteRule; error?: string } {
  const domains = expandDomainAliases((input.domains ?? []).map(normalizeDomain).filter(Boolean));
  if (!domains.length || !domains.every(isValidDomain)) return { error: 'Enter a valid website such as youtube.com.' };
  let dailyAllowance: WebsiteRule['dailyAllowance'];
  if (input.dailyAllowance) {
    const defaultMinutes = clampMinutes(input.dailyAllowance.defaultMinutes);
    if (defaultMinutes === undefined) return { error: 'Daily allowance must be between 0 and 1440 minutes.' };
    const byWeekday: Partial<Record<DayOfWeek, number>> = {};
    for (const [day, minutes] of Object.entries(input.dailyAllowance.byWeekday ?? {})) {
      const value = clampMinutes(minutes);
      if (value === undefined || !/^[0-6]$/.test(day)) return { error: 'Weekday allowances must be between 0 and 1440 minutes.' };
      byWeekday[Number(day) as DayOfWeek] = value;
    }
    dailyAllowance = Object.keys(byWeekday).length ? { defaultMinutes, byWeekday } : { defaultMinutes };
  }
  const schedules: WeeklySchedule[] = [];
  for (const schedule of input.schedules ?? []) {
    const clean = sanitizeSchedule(schedule);
    if (!clean) return { error: 'Each schedule needs at least one day and valid times.' };
    schedules.push(clean);
  }
  if (!dailyAllowance && !schedules.length) return { error: 'Add a daily allowance or at least one schedule.' };
  let commitmentEndsAt: number | undefined = Number(input.commitmentEndsAt) || undefined;
  if (commitmentEndsAt !== undefined && commitmentEndsAt > now + MAX_COMMITMENT_MS) return { error: 'Commitments can last at most one year.' };
  if (commitmentEndsAt !== undefined && commitmentEndsAt <= now) commitmentEndsAt = undefined;
  const label = String(input.label ?? '').trim().slice(0, 60) || domains[0];
  return {
    rule: {
      id: String(input.id || crypto.randomUUID()),
      label,
      domains,
      enabled: input.enabled !== false,
      dailyAllowance,
      schedules,
      commitmentEndsAt,
      // Strict mode is not offered in Phase 1.
      enforcementMode: 'pin',
      createdAt: now,
      updatedAt: now
    }
  };
}

export type SaveRuleOutcome = { state: AppState; outcome: 'created' | 'applied' | 'pending'; reasons?: string[] };

export async function saveRule(ctx: ActionContext, input: WebsiteRule): Promise<ActionResult<SaveRuleOutcome>> {
  const now = ctx.now();
  const { rule, error } = sanitizeRule(input, now);
  if (!rule) return fail(error ?? 'Invalid restriction.');
  if (!(await ctx.store.get()).pin) return fail('Create your PIN before adding restrictions.');
  let outcome: SaveRuleOutcome['outcome'] = 'created';
  let reasons: string[] | undefined;
  const state = await ctx.store.update((current) => {
    const index = current.rules.findIndex((candidate) => candidate.id === rule.id);
    if (index < 0) { current.rules.push(rule); return current; }
    const existing = current.rules[index];
    // The stored rule keeps its enforcement mode; Phase 1 never downgrades or upgrades it here.
    const result = mutateRule(existing, { ...rule, enforcementMode: existing.enforcementMode }, now);
    outcome = result.outcome;
    if (result.outcome === 'pending') reasons = result.reasons;
    current.rules[index] = result.rule;
    return current;
  });
  return { ok: true, data: { state, outcome, reasons } };
}

export async function deleteRule(ctx: ActionContext, ruleId: string): Promise<ActionResult<{ state: AppState; outcome: 'removed' | 'pending' | 'missing' }>> {
  const now = ctx.now();
  let outcome: 'removed' | 'pending' | 'missing' = 'missing';
  const state = await ctx.store.update((current) => {
    const rule = current.rules.find((candidate) => candidate.id === ruleId);
    if (!rule) return current;
    const result = requestRemoval(rule, now);
    outcome = result.outcome;
    if (result.outcome === 'removed') {
      current.rules = current.rules.filter((candidate) => candidate.id !== ruleId);
      delete current.overrides[ruleId];
    } else current.rules = current.rules.map((candidate) => (candidate.id === ruleId ? result.rule : candidate));
    return current;
  });
  return { ok: true, data: { state, outcome } };
}

/** Withdrawing a queued loosening keeps the rule as strict as it is, so it is always allowed. */
export async function cancelPendingChange(ctx: ActionContext, ruleId: string): Promise<ActionResult<AppState>> {
  const now = ctx.now();
  return {
    ok: true,
    data: await ctx.store.update((current) => {
      current.rules = current.rules.map((rule) => (rule.id === ruleId ? { ...rule, pendingChange: undefined, updatedAt: now } : rule));
      return current;
    })
  };
}

// ─────────────────────── Feeds & preferences ────────────────────

export async function setFeeds(ctx: ActionContext, input: FeedSettings): Promise<ActionResult<AppState>> {
  return {
    ok: true,
    data: await ctx.store.update((current) => {
      const next: FeedSettings = { globalEnabled: Boolean(input?.globalEnabled), sites: structuredClone(feedDefaults.sites) };
      for (const site of Object.keys(feedDefaults.sites) as FeedSite[]) {
        for (const key of Object.keys(feedDefaults.sites[site])) {
          next.sites[site][key] = Boolean(input?.sites?.[site]?.[key] ?? current.feedSettings.sites[site][key]);
        }
      }
      current.feedSettings = next;
      return current;
    })
  };
}

export async function setPreferences(ctx: ActionContext, input: { trackingEnabled?: boolean; warningsEnabled?: boolean }): Promise<ActionResult<AppState>> {
  return {
    ok: true,
    data: await ctx.store.update((current) => ({
      ...current,
      trackingEnabled: input.trackingEnabled ?? current.trackingEnabled,
      warningsEnabled: input.warningsEnabled ?? current.warningsEnabled
    }))
  };
}

export async function completeOnboarding(ctx: ActionContext): Promise<ActionResult<AppState>> {
  const state = await ctx.store.get();
  if (!state.pin) return fail('Create a PIN first.');
  return { ok: true, data: await ctx.store.update((current) => ({ ...current, onboardingComplete: true })) };
}

export async function recordProtection(ctx: ActionContext, input: { privateAccess?: PrivateAccessStatus; observedPrivateTab?: boolean }): Promise<AppState> {
  const now = ctx.now();
  return ctx.store.update((current) => {
    const protection = { ...current.protection, lastCheckedAt: now };
    if (input.observedPrivateTab) { protection.lastObservedAt = now; if (protection.privateAccess !== 'verified') protection.privateAccess = 'observed'; }
    if (input.privateAccess) protection.privateAccess = input.privateAccess === 'unverified' && protection.browser === 'safari' && protection.lastObservedAt ? 'observed' : input.privateAccess;
    current.protection = protection;
    return current;
  });
}

// ───────────────────────────── Data ─────────────────────────────

/**
 * Deletes browsing history. Today's counted usage for committed rules is kept, because erasing
 * it would reset an active daily limit. Rules, commitments, PIN and running overrides are untouched.
 */
export async function deleteHistory(ctx: ActionContext): Promise<ActionResult<AppState>> {
  const now = ctx.now();
  const todayKey = localDateKey(new Date(now));
  return {
    ok: true,
    data: await ctx.store.update((current) => {
      const today = current.usage[todayKey];
      current.usage = {};
      current.overrideHistory = [];
      if (today) {
        const kept = { ...today, millisecondsByHost: {}, millisecondsByRule: {} as Record<string, number>, overrideMillisecondsByRule: {} };
        for (const rule of current.rules) {
          if (isCommitted(rule, now) && today.millisecondsByRule[rule.id]) kept.millisecondsByRule[rule.id] = today.millisecondsByRule[rule.id];
        }
        current.usage[todayKey] = kept;
      }
      return current;
    })
  };
}

/** Full reset. Refused while any commitment is active; requires the PIN because it removes it. */
export async function resetAll(ctx: ActionContext, pin: string): Promise<ActionResult<AppState>> {
  const state = await ctx.store.get();
  if (hasActiveCommitment(state, ctx.now())) return fail('Active commitments must end before Screentime can be reset.');
  const check = await checkPin(ctx, pin);
  if (!check.ok) return check;
  return { ok: true, data: await ctx.store.update((current) => ({ ...createDefaultState(current.protection.browser), protection: current.protection })) };
}

export function exportData(state: AppState): Record<string, unknown> {
  const { pin: _pin, pinAttempts: _attempts, ...rest } = state;
  return { exportedAt: new Date().toISOString(), format: 'screentime-export-v1', ...rest };
}

// ─────────────────────────── Maintenance ─────────────────────────

export async function maintain(ctx: ActionContext): Promise<AppState> {
  const now = ctx.now();
  return ctx.store.update((state) => {
    const rules: WebsiteRule[] = [];
    for (const rule of state.rules) {
      const next = applyMaturePendingChange(rule, now);
      if (next) rules.push(next);
      else delete state.overrides[rule.id];
    }
    state.rules = rules;
    for (const [ruleId, override] of Object.entries(state.overrides)) {
      if (!isOverrideActive(override, now)) delete state.overrides[ruleId];
    }
    if (state.lastWallClockAt && now < state.lastWallClockAt - CLOCK_ROLLBACK_TOLERANCE_MS) state.possibleClockRollbackAt = now;
    state.lastWallClockAt = now;
    if (state.pinAttempts.cooldownUntil && state.pinAttempts.cooldownUntil - now > 2 * 60 * 60_000) {
      // A cooldown far in the future means the clock moved backwards; cap it rather than lock out for days.
      state.pinAttempts = { ...state.pinAttempts, cooldownUntil: now + 60 * 60_000 };
    }
    return pruneUsage(state, now);
  });
}
