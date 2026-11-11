/** Every user mutation is authorized here, independently of disabled UI controls. */
import { createDefaultState, feedDefaults } from "./defaults";
import {
  expandDomainAliases,
  hostMatchesDomain,
  isValidDomain,
  normalizeDomain,
} from "./domains";
import { decodeShareCode } from "./share";
import { localDateKey } from "./date";
import {
  createPasswordVerifier,
  failedPasswordAttempt,
  validPassword,
  verifyPassword,
} from "./password";
import { pruneUsage } from "./tracking";
import { fryKeyForDomain } from "@policy/index";
import type { StateStore } from "./store";
import { LOADOUT_COUNT } from "@shared/index";
import type {
  AccessWindow,
  AppState,
  DayOfWeek,
  EarnGoal,
  LoadoutSettings,
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
export function sanitizeWindow(input: AccessWindow): {
  window?: AccessWindow;
  error?: string;
} {
  if (
    !input ||
    !Array.isArray(input.domains) ||
    !input.domains.every((d) => typeof d === "string") ||
    !Array.isArray(input.days)
  )
    return { error: "Choose websites and days for this window." };
  const domains = cleanDomains(input.domains),
    days = [...new Set(input.days)];
  if (!domains.length || !domains.every(isValidDomain))
    return { error: "Whitelist at least one valid website." };
  if (
    !days.length ||
    !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  )
    return { error: "Choose at least one valid day." };
  if (
    !minutes(input.startMinute) ||
    input.startMinute === 1440 ||
    !minutes(input.endMinute)
  )
    return { error: "Choose valid start and end times." };
  const mode =
    input.mode === "block" || input.mode === "free" ? input.mode : "allow";
  const budget = mode === "free" ? input.freeMinutes : undefined;
  if (budget !== undefined && (!minutes(budget) || budget === 0))
    return { error: "Fry Time must be between 1 and 1440 minutes." };
  // Custom minutes per website: only for websites in this window, each 1–1440.
  let bySite: Record<string, number> | undefined;
  if (mode === "free" && input.freeMinutesBySite && typeof input.freeMinutesBySite === "object") {
    const keys = new Set(domains.map(fryKeyForDomain));
    bySite = {};
    for (const [key, value] of Object.entries(input.freeMinutesBySite)) {
      if (!keys.has(key) || value === undefined || value === null) continue;
      if (!minutes(value) || value === 0)
        return { error: "Each website’s Fry Time must be between 1 and 1440 minutes." };
      bySite[key] = value;
    }
  }
  return {
    window: {
      id: String(input.id || crypto.randomUUID()),
      label: String(input.label || "Access window").slice(0, 60),
      enabled: input.enabled !== false,
      domains,
      days,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      mode,
      ...(bySite
        ? { freeMinutesBySite: bySite }
        : budget !== undefined
          ? { freeMinutes: budget }
          : {}),
    },
  };
}
export async function saveWindow(
  ctx: ActionContext,
  input: AccessWindow,
): Promise<ActionResult<AppState>> {
  const { window, error } = sanitizeWindow(input);
  if (!window) return fail(error!);
  // A window that contradicts another is saved anyway, so either one can be edited to fix
  // it; the policy engine pauses both until then (see suspendedWindowIds).
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
const overlaps = (a: string[], b: string[]) =>
  a.some((d) => b.some((e) => hostMatchesDomain(d, e) || hostMatchesDomain(e, d)));
export function sanitizeEarnGoal(input: EarnGoal): { goal?: EarnGoal; error?: string } {
  const list = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((d) => typeof d === "string");
  if (!input || !list(input.goalDomains) || !list(input.lockedDomains))
    return { error: "Choose a goal website and the websites to lock." };
  const goalDomains = cleanDomains(input.goalDomains),
    lockedDomains = cleanDomains(input.lockedDomains);
  if (!goalDomains.length || !goalDomains.every(isValidDomain))
    return { error: "Enter a valid goal website, like duolingo.com." };
  if (!lockedDomains.length || !lockedDomains.every(isValidDomain))
    return { error: "Choose at least one valid website to lock." };
  if (overlaps(goalDomains, lockedDomains))
    return { error: "The goal website can’t also be one of the locked websites." };
  if (!minutes(input.minutes) || input.minutes === 0)
    return { error: "The goal must be between 1 and 1440 minutes a day." };
  const base = {
    id: String(input.id || crypto.randomUUID()),
    label: String(input.label || `Earn it on ${goalDomains[0]}`).slice(0, 60),
    enabled: input.enabled !== false,
    goalDomains,
    minutes: input.minutes,
    lockedDomains,
    ...(input.strict === true ? { strict: true } : {}),
  };
  if (input.reward !== "fry") return { goal: base };
  // Fry Time reward: one shared amount each time, or a different amount each time.
  const repeats = input.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 0 || repeats > 48)
    return { error: "Choose how many times a day, from 1 to 48, or no limit." };
  // Codes and saves from 0.6.9–0.7.2 may still give minutes per website: take the smallest.
  const legacy = (input as { fryMinutesBySite?: Record<string, unknown> }).fryMinutesBySite;
  const legacyMinutes =
    legacy && typeof legacy === "object"
      ? Math.min(...Object.values(legacy).filter((v): v is number => typeof v === "number" && minutes(v) && v > 0))
      : Infinity;
  const fryMinutes = input.fryMinutes ?? (Number.isFinite(legacyMinutes) ? legacyMinutes : undefined);
  if (fryMinutes !== undefined && (!minutes(fryMinutes) || fryMinutes === 0))
    return { error: "Fry Time earned must be between 1 and 1440 minutes." };
  let schedule: number[] | undefined;
  // "Different each time" needs a last time: with no limit it's the same every time.
  if (repeats !== 0 && Array.isArray(input.fryMinutesSchedule) && input.fryMinutesSchedule.length) {
    schedule = input.fryMinutesSchedule.slice(0, repeats || 48);
    if (schedule.some((m) => !minutes(m) || m === 0))
      return { error: "Fry Time earned each time must be between 1 and 1440 minutes." };
    if (schedule.every((m) => m === schedule![0])) schedule = undefined;
  }
  const first = schedule?.[0] ?? fryMinutes;
  if (first === undefined) return { error: "Choose how much Fry Time it earns." };
  return {
    goal: {
      ...base,
      reward: "fry",
      repeats,
      fryMinutes: first,
      ...(schedule ? { fryMinutesSchedule: schedule } : {}),
    },
  };
}
/**
 * A goal website that another goal locks could never be earned, and two goals locking each
 * other's goal website would stay locked for good, so a goal website is never locked.
 */
function earnGoalClash(goals: EarnGoal[]): string | undefined {
  const enabled = goals.filter((g) => g.enabled);
  for (const goal of enabled)
    for (const other of enabled)
      // Only "unlock" goals lock websites; Fry Time goals never block anything.
      if (other.id !== goal.id && other.reward !== "fry" && overlaps(goal.goalDomains, other.lockedDomains))
        return `“${other.label}” locks ${goal.goalDomains[0]}, the goal website of “${goal.label}”, so it could never be earned. Change one of them.`;
  return undefined;
}
export async function saveEarnGoal(
  ctx: ActionContext,
  input: EarnGoal,
): Promise<ActionResult<AppState>> {
  const { goal, error } = sanitizeEarnGoal(input);
  if (!goal) return fail(error!);
  const goals = [
    ...((await ctx.store.get()).earnGoals ?? []).filter((g) => g.id !== goal.id),
    goal,
  ];
  const clash = earnGoalClash(goals);
  if (clash) return fail(clash);
  return protectedUpdate(ctx, (s) => ({
    ...s,
    earnGoals: [...(s.earnGoals ?? []).filter((g) => g.id !== goal.id), goal],
  }));
}
export const deleteEarnGoal = (ctx: ActionContext, id: string) =>
  protectedUpdate(ctx, (s) => ({
    ...s,
    earnGoals: (s.earnGoals ?? []).filter((g) => g.id !== id),
  }));
/**
 * There's no longer a master switch for feed blocking: `globalEnabled` is always true, and
 * settings saved with it off (older exports and share codes) arrive with every control off,
 * which is what that meant.
 */
function sanitizeFeeds(input: FeedSettings): FeedSettings {
  const sites = structuredClone(feedDefaults.sites);
  const off = input?.globalEnabled === false;
  for (const site of Object.keys(sites) as FeedSite[])
    for (const key of Object.keys(sites[site]))
      sites[site][key] = !off && input?.sites?.[site]?.[key] === true;
  return { globalEnabled: true, sites };
}
export const setFeeds = (ctx: ActionContext, input: FeedSettings) =>
  protectedUpdate(ctx, (s) => ({ ...s, feedSettings: sanitizeFeeds(input) }));
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
/** Marks the welcome page as seen. Not a settings change, so it never needs the password. */
export const completeOnboarding = async (ctx: ActionContext): Promise<ActionResult<AppState>> => ({
  ok: true,
  data: await ctx.store.update((s) => ({ ...s, onboardingComplete: true })),
});
/** Remembers that the first-change password prompt was shown, so it appears only once. */
export const markPasswordPromptSeen = (ctx: ActionContext) =>
  protectedUpdate(ctx, (s) => ({ ...s, passwordPromptSeen: true }));
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
/**
 * Website settings only (rules, windows, earn goals, feed blocking, warnings): no usage
 * history and no password, so the file is safe to move between browsers, Macs and people.
 */
export const SETTINGS_FORMAT = "screenfry-settings-v1";
export interface SettingsExport {
  format: typeof SETTINGS_FORMAT;
  exportedAt: string;
  rules: WebsiteRule[];
  windows: AccessWindow[];
  earnGoals?: EarnGoal[];
  feedSettings: FeedSettings;
  warningsEnabled: boolean;
}
export function exportSettings(state: AppState, now: number): SettingsExport {
  return {
    format: SETTINGS_FORMAT,
    exportedAt: new Date(now).toISOString(),
    rules: state.rules,
    windows: state.windows,
    earnGoals: state.earnGoals ?? [],
    feedSettings: state.feedSettings,
    warningsEnabled: state.warningsEnabled,
  };
}
export interface CheckedSettings {
  rules: WebsiteRule[];
  windows: AccessWindow[];
  /** Undefined for settings from before earn goals, which leave the current goals alone. */
  earnGoals?: EarnGoal[];
  feedSettings: FeedSettings;
  warningsEnabled?: boolean;
}
/** Validates settings from a share code or a loadout, like individual edits. */
export function checkSettings(input: unknown, now: number): { settings?: CheckedSettings; error?: string } {
  const data = input as Partial<SettingsExport> | null;
  if (!data || typeof data !== "object") return { error: "This isn’t a ScreenFry settings file." };
  if (!Array.isArray(data.rules) || !Array.isArray(data.windows))
    return { error: "The settings file is missing websites or windows." };
  const rules: WebsiteRule[] = [],
    windows: AccessWindow[] = [];
  for (const input of data.rules) {
    const { rule, error } = sanitizeRule(input, now);
    if (!rule) return { error: `Website settings: ${error}` };
    if (rules.some((r) => r.domains.some((d) => rule.domains.includes(d))))
      return { error: `${rule.label} appears more than once.` };
    rules.push(rule);
  }
  for (const input of data.windows) {
    const { window, error } = sanitizeWindow(input);
    if (!window) return { error: `Windows: ${error}` };
    windows.push(window);
  }
  let earnGoals: EarnGoal[] | undefined;
  if (Array.isArray(data.earnGoals)) {
    earnGoals = [];
    for (const input of data.earnGoals) {
      const { goal, error } = sanitizeEarnGoal(input);
      if (!goal) return { error: `Earn your website time: ${error}` };
      earnGoals.push(goal);
    }
    const clash = earnGoalClash(earnGoals);
    if (clash) return { error: `Earn your website time: ${clash}` };
  }
  return {
    settings: {
      rules,
      windows,
      ...(earnGoals ? { earnGoals } : {}),
      feedSettings: sanitizeFeeds(data.feedSettings as FeedSettings),
      ...(typeof data.warningsEnabled === "boolean" ? { warningsEnabled: data.warningsEnabled } : {}),
    },
  };
}
/** Puts checked settings into the live state, keeping this browser's rule ids for its websites. */
function applySettings(s: AppState, settings: CheckedSettings): AppState {
  const rules = structuredClone(settings.rules);
  for (const rule of rules) {
    // Settings from elsewhere (another browser, a loadout, someone's shared code) carry their
    // own ids; keep this browser's id for the same website so today's usage still counts.
    const existing =
      s.rules.find((r) => r.id === rule.id) ??
      s.rules.find((r) => overlaps(r.domains, rule.domains));
    if (existing) {
      rule.createdAt = existing.createdAt;
      if (!rules.some((r) => r !== rule && r.id === existing.id)) rule.id = existing.id;
    }
  }
  // Windows and earn goals keep this browser's id when one with the same name (and mode)
  // exists and the incoming one is new here, so today's Fry Time and earn progress carry on
  // instead of resetting through a share code or a loadout switch.
  const windows = structuredClone(settings.windows);
  for (const w of windows) {
    if (s.windows.some((x) => x.id === w.id)) continue;
    const same = s.windows.find(
      (x) => x.label === w.label && (x.mode ?? "allow") === (w.mode ?? "allow") && !windows.some((y) => y.id === x.id),
    );
    if (same) w.id = same.id;
  }
  const earnGoals = settings.earnGoals && structuredClone(settings.earnGoals);
  for (const g of earnGoals ?? []) {
    if ((s.earnGoals ?? []).some((x) => x.id === g.id)) continue;
    const same = (s.earnGoals ?? []).find(
      (x) => x.label === g.label && !earnGoals!.some((y) => y.id === x.id),
    );
    if (same) g.id = same.id;
  }
  return {
    ...s,
    rules,
    windows,
    ...(earnGoals ? { earnGoals } : {}),
    feedSettings: structuredClone(settings.feedSettings),
    warningsEnabled: settings.warningsEnabled ?? s.warningsEnabled,
  };
}
/** Validated like individual edits; a settings password must already be entered to import. */
export async function importSettings(
  ctx: ActionContext,
  input: unknown,
): Promise<ActionResult<AppState>> {
  const data = input as Partial<SettingsExport> | null;
  if (
    !data ||
    typeof data !== "object" ||
    (data.format !== SETTINGS_FORMAT && data.format !== "screenfry-export-v3")
  )
    return fail("This isn’t a ScreenFry settings file.");
  const { settings, error } = checkSettings(data, ctx.now());
  if (!settings) return fail(error!);
  return protectedUpdate(ctx, (s) => applySettings(s, settings));
}

/** Applies a pasted share code (or settings JSON) to the live settings. */
export async function importShareCode(
  ctx: ActionContext,
  code: string,
): Promise<ActionResult<AppState>> {
  let data: unknown;
  try {
    data = await decodeShareCode(code);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That share code didn’t work.");
  }
  return importSettings(ctx, data);
}
/** Puts a pasted share code into a loadout (see setLoadout). */
export async function setLoadoutFromCode(
  ctx: ActionContext,
  index: number,
  code: string,
): Promise<ActionResult<AppState>> {
  let data: unknown;
  try {
    data = await decodeShareCode(code);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That share code didn’t work.");
  }
  return setLoadout(ctx, index, data);
}

// Loadouts: five slots; the one in use is the live settings, the others saved copies.
const slot = (index: number) => Number.isInteger(index) && index >= 0 && index < LOADOUT_COUNT;
/** The live settings as a loadout. */
export function currentLoadout(state: AppState, now: number): LoadoutSettings {
  return {
    savedAt: now,
    rules: structuredClone(state.rules),
    windows: structuredClone(state.windows),
    earnGoals: structuredClone(state.earnGoals ?? []),
    feedSettings: structuredClone(state.feedSettings),
    warningsEnabled: state.warningsEnabled,
  };
}
const slots = (s: AppState) =>
  Array.from({ length: LOADOUT_COUNT }, (_, i) => s.loadouts?.[i] ?? null);
/** A loadout's settings: the live ones for the loadout in use, else the saved copy (or null). */
export function loadoutSettings(state: AppState, index: number, now: number): LoadoutSettings | null {
  if (index === (state.activeLoadout ?? 0)) return currentLoadout(state, now);
  return slots(state)[index] ?? null;
}
/** Starts using another saved loadout; the current setup is saved into its own slot. */
export async function switchLoadout(ctx: ActionContext, index: number): Promise<ActionResult<AppState>> {
  if (!slot(index)) return fail("Choose a loadout from 1 to 5.");
  const state = await ctx.store.get();
  const active = state.activeLoadout ?? 0;
  if (index === active) return { ok: true, data: state };
  const target = slots(state)[index];
  if (!target) return fail(`Loadout ${index + 1} is empty. Paste a code into it, or save a setup there first.`);
  const { settings, error } = checkSettings(target, ctx.now());
  if (!settings) return fail(error!);
  return protectedUpdate(ctx, (s) => {
    const next = slots(s);
    next[s.activeLoadout ?? 0] = currentLoadout(s, ctx.now());
    next[index] = null;
    return { ...applySettings(s, settings), loadouts: next, activeLoadout: index };
  });
}
/**
 * Fills a loadout from settings (a pasted share code). For the loadout in use, that replaces
 * the live settings; for another, it saves them there without switching.
 */
export async function setLoadout(
  ctx: ActionContext,
  index: number,
  input: unknown,
): Promise<ActionResult<AppState>> {
  if (!slot(index)) return fail("Choose a loadout from 1 to 5.");
  const { settings, error } = checkSettings(input, ctx.now());
  if (!settings) return fail(error!);
  return protectedUpdate(ctx, (s) => {
    if (index === (s.activeLoadout ?? 0)) return applySettings(s, settings);
    const next = slots(s);
    next[index] = {
      savedAt: ctx.now(),
      ...settings,
      earnGoals: settings.earnGoals ?? [],
      warningsEnabled: settings.warningsEnabled ?? s.warningsEnabled,
    };
    return { ...s, loadouts: next };
  });
}
/** Saves the current setup into another loadout too. */
export const copyToLoadout = (ctx: ActionContext, index: number) =>
  !slot(index)
    ? Promise.resolve(fail("Choose a loadout from 1 to 5."))
    : protectedUpdate(ctx, (s) => {
        if (index === (s.activeLoadout ?? 0)) return s;
        const next = slots(s);
        next[index] = currentLoadout(s, ctx.now());
        return { ...s, loadouts: next };
      });
/** Empties a saved loadout. The one in use can't be emptied (switch away first). */
export async function clearLoadout(ctx: ActionContext, index: number): Promise<ActionResult<AppState>> {
  if (!slot(index)) return fail("Choose a loadout from 1 to 5.");
  if (index === ((await ctx.store.get()).activeLoadout ?? 0))
    return fail("That loadout is in use. Switch to another one first.");
  return protectedUpdate(ctx, (s) => {
    const next = slots(s);
    next[index] = null;
    return { ...s, loadouts: next };
  });
}
export const maintain = (ctx: ActionContext) =>
  ctx.store.update((s) => pruneUsage(s, ctx.now()));
