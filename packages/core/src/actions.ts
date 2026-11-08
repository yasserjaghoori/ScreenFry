/** Every user mutation is authorized here, independently of disabled UI controls. */
import { createDefaultState, feedDefaults } from "./defaults";
import { expandDomainAliases, isValidDomain, normalizeDomain } from "./domains";
import { localDateKey } from "./date";
import {
  createPasswordVerifier,
  failedPasswordAttempt,
  validPassword,
  verifyPassword,
} from "./password";
import { pruneUsage } from "./tracking";
import type { StateStore } from "./store";
import type {
  AccessWindow,
  AppState,
  DayOfWeek,
  FeedSettings,
  FeedSite,
  PrivateAccessStatus,
  WebsiteRule,
} from "@shared/index";
export interface ActionContext {
  store: StateStore;
  now: () => number;
  password?: string;
}
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; cooldownUntil?: number };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });
/** Authorization runs inside the serialized store update; changing/removing the password cannot race a write. */
async function protectedUpdate(
  ctx: ActionContext,
  mutate: (state: AppState) => AppState | Promise<AppState>,
): Promise<ActionResult<AppState>> {
  let denied: { error: string; cooldownUntil?: number } | undefined;
  const result = await ctx.store.update(async (state) => {
    if (state.settingsPassword) {
      const now = ctx.now(),
        until = state.passwordAttempts.cooldownUntil;
      if (until && now < until) {
        denied = {
          error: "Too many attempts. Try again after the cooldown.",
          cooldownUntil: until,
        };
        return state;
      }
      if (!(await verifyPassword(ctx.password ?? "", state.settingsPassword))) {
        // Merely opening settings is not an incorrect password attempt.
        if (ctx.password)
          state.passwordAttempts = failedPasswordAttempt(
            state.passwordAttempts,
            now,
          );
        denied = {
          error: "Enter your settings password to make changes.",
          cooldownUntil: state.passwordAttempts.cooldownUntil,
        };
        return state;
      }
      state.passwordAttempts = { failedAttempts: 0 };
    }
    return mutate(state);
  });
  return denied ? { ok: false, ...denied } : { ok: true, data: result };
}
export const unlockSettings = (ctx: ActionContext) =>
  protectedUpdate(ctx, (s) => s);
export async function setSettingsPassword(
  ctx: ActionContext,
  password: string,
): Promise<ActionResult<AppState>> {
  if (password !== "" && !validPassword(password))
    return fail("Use a password between 4 and 128 characters.");
  const verifier = password
    ? await createPasswordVerifier(password)
    : undefined;
  return protectedUpdate(ctx, (s) => ({
    ...s,
    settingsPassword: verifier,
    passwordAttempts: { failedAttempts: 0 },
  }));
}
const minutes = (x: unknown) =>
  typeof x === "number" &&
  Number.isFinite(x) &&
  x >= 0 &&
  x <= 1440 &&
  Number.isInteger(x);
const cleanDomains = (domains: string[]) =>
  expandDomainAliases(domains.map(normalizeDomain));
export function sanitizeRule(
  input: WebsiteRule,
  now: number,
): { rule?: WebsiteRule; error?: string } {
  if (
    !input ||
    !Array.isArray(input.domains) ||
    !input.domains.every((d) => typeof d === "string")
  )
    return { error: "Choose a valid website." };
  const domains = cleanDomains(input.domains);
  if (!domains.length || !domains.every(isValidDomain))
    return { error: "Enter a valid website domain." };
  let dailyAllowance: WebsiteRule["dailyAllowance"];
  if (input.dailyAllowance) {
    if (!minutes(input.dailyAllowance.defaultMinutes))
      return { error: "Daily limit must be between 0 and 1440 minutes." };
    const byWeekday: Partial<Record<DayOfWeek, number>> = {};
    for (const [day, value] of Object.entries(
      input.dailyAllowance.byWeekday ?? {},
    )) {
      if (!/^[0-6]$/.test(day) || !minutes(value))
        return { error: "Weekday limits must use valid days and minutes." };
      byWeekday[Number(day) as DayOfWeek] = value;
    }
    dailyAllowance = {
      defaultMinutes: input.dailyAllowance.defaultMinutes,
      ...(Object.keys(byWeekday).length ? { byWeekday } : {}),
    };
  }
  return {
    rule: {
      id: String(input.id || crypto.randomUUID()),
      label: String(input.label ?? domains[0]).slice(0, 60),
      domains,
      enabled: input.enabled !== false,
      blocked: input.blocked === true,
      dailyAllowance,
      showTimer: input.showTimer === true,
      createdAt: now,
      updatedAt: now,
    },
  };
}
export async function saveRule(
  ctx: ActionContext,
  input: WebsiteRule,
): Promise<ActionResult<AppState>> {
  const { rule, error } = sanitizeRule(input, ctx.now());
  if (!rule) return fail(error!);
  return protectedUpdate(ctx, (state) => {
    const existing = state.rules.find((r) => r.id === rule.id);
    if (existing) rule.createdAt = existing.createdAt;
    // A different ID must not reset a site's existing allowance or leave duplicate editors.
    const duplicate = state.rules.find(
      (r) =>
        r.id !== rule.id && r.domains.some((d) => rule.domains.includes(d)),
    );
    if (duplicate)
      throw new Error(
        "This website already has settings. Edit its existing entry.",
      );
    state.rules = [...state.rules.filter((r) => r.id !== rule.id), rule];
    return state;
  });
}
export const deleteRule = (ctx: ActionContext, id: string) =>
  protectedUpdate(ctx, (s) => ({
    ...s,
    rules: s.rules.filter((r) => r.id !== id),
  }));
export async function saveWindow(
  ctx: ActionContext,
  input: AccessWindow,
): Promise<ActionResult<AppState>> {
  if (
    !input ||
    !Array.isArray(input.domains) ||
    !input.domains.every((d) => typeof d === "string") ||
    !Array.isArray(input.days)
  )
    return fail("Choose websites and days for this window.");
  const domains = cleanDomains(input.domains),
    days = [...new Set(input.days)];
  if (!domains.length || !domains.every(isValidDomain))
    return fail("Whitelist at least one valid website.");
  if (
    !days.length ||
    !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  )
    return fail("Choose at least one valid day.");
  if (
    !minutes(input.startMinute) ||
    input.startMinute === 1440 ||
    !minutes(input.endMinute)
  )
    return fail("Choose valid start and end times.");
  const window: AccessWindow = {
    id: String(input.id || crypto.randomUUID()),
    label: String(input.label || "Access window").slice(0, 60),
    enabled: input.enabled !== false,
    domains,
    days,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    mode: input.mode === "block" ? "block" : "allow",
  };
  return protectedUpdate(ctx, (s) => ({
    ...s,
    windows: [...s.windows.filter((w) => w.id !== window.id), window],
  }));
}
export const deleteWindow = (ctx: ActionContext, id: string) =>
  protectedUpdate(ctx, (s) => ({
    ...s,
    windows: s.windows.filter((w) => w.id !== id),
  }));
export const setFeeds = (ctx: ActionContext, input: FeedSettings) =>
  protectedUpdate(ctx, (s) => {
    const sites = structuredClone(feedDefaults.sites);
    for (const site of Object.keys(sites) as FeedSite[])
      for (const key of Object.keys(sites[site]))
        sites[site][key] = input?.sites?.[site]?.[key] === true;
    return {
      ...s,
      feedSettings: { globalEnabled: input?.globalEnabled === true, sites },
    };
  });
export const setPreferences = (
  ctx: ActionContext,
  input: { warningsEnabled?: boolean },
) =>
  protectedUpdate(ctx, (s) => ({
    ...s,
    warningsEnabled:
      typeof input.warningsEnabled === "boolean"
        ? input.warningsEnabled
        : s.warningsEnabled,
  }));
export const completeOnboarding = (ctx: ActionContext) =>
  protectedUpdate(ctx, (s) => ({ ...s, onboardingComplete: true }));
export async function recordProtection(
  ctx: ActionContext,
  input: { privateAccess?: PrivateAccessStatus; observedPrivateTab?: boolean },
): Promise<AppState> {
  return ctx.store.update((s) => {
    s.protection.lastCheckedAt = ctx.now();
    if (input.observedPrivateTab) {
      s.protection.lastObservedAt = ctx.now();
      if (s.protection.privateAccess !== "verified")
        s.protection.privateAccess = "observed";
    }
    if (input.privateAccess)
      s.protection.privateAccess =
        input.privateAccess === "unverified" &&
        s.protection.browser === "safari" &&
        s.protection.lastObservedAt
          ? "observed"
          : input.privateAccess;
    return s;
  });
}
export const resetAll = (ctx: ActionContext) =>
  protectedUpdate(ctx, (s) => ({
    ...createDefaultState(s.protection.browser),
    protection: s.protection,
  }));
export function exportData(state: AppState): Record<string, unknown> {
  const {
    settingsPassword: _password,
    passwordAttempts: _attempts,
    ...rest
  } = state;
  return {
    exportedAt: new Date().toISOString(),
    format: "screenfry-export-v3",
    ...rest,
  };
}
export const maintain = (ctx: ActionContext) =>
  ctx.store.update((s) => pruneUsage(s, ctx.now()));
