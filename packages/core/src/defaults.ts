import type {
  AccessWindow,
  AppState,
  BrowserKind,
  DayOfWeek,
  EarnGoal,
  FeedSettings,
  FeedSite,
  UsageDay,
  WebsiteRule,
  WeeklySchedule,
} from "@shared/index";
import { defaultRules } from "./sites";
import { siteDefinitions } from "@feeds/index";
export const USAGE_RETENTION_DAYS = 120;
export const feedDefaults: FeedSettings = {
  globalEnabled: true,
  sites: Object.fromEntries(
    siteDefinitions.map((site) => [
      site.site,
      Object.fromEntries(Object.keys(site.elements).map((key) => [key, false])),
    ]),
  ) as FeedSettings["sites"],
};
export function createDefaultState(browser: BrowserKind = "chrome"): AppState {
  return {
    schemaVersion: 3,
    onboardingComplete: false,
    passwordAttempts: { failedAttempts: 0 },
    rules: defaultRules(),
    windows: [],
    usage: {},
    feedSettings: structuredClone(feedDefaults),
    protection: { browser, privateAccess: "unverified" },
    warningsEnabled: true,
  };
}
export function emptyUsageDay(dateKey: string): UsageDay {
  return {
    dateKey,
    millisecondsByRule: {},
    warningsSent: {},
    millisecondsByWindow: {},
    millisecondsByGoal: {},
  };
}
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
/** Convert the old per-site blocked schedules to the complement (allowed windows), never invert their meaning. */
function convertSchedules(
  rule: WebsiteRule,
  schedules: WeeklySchedule[],
): AccessWindow[] {
  const result: AccessWindow[] = [];
  for (let day = 0; day < 7; day++) {
    const blocked = (minute: number) =>
      schedules.some((s) => {
        if (s.startMinute === s.endMinute)
          return s.days.includes(day as DayOfWeek);
        if (s.startMinute < s.endMinute)
          return (
            s.days.includes(day as DayOfWeek) &&
            minute >= s.startMinute &&
            minute < s.endMinute
          );
        return (
          (s.days.includes(day as DayOfWeek) && minute >= s.startMinute) ||
          (s.days.includes(((day + 6) % 7) as DayOfWeek) &&
            minute < s.endMinute)
        );
      });
    let start: number | undefined;
    for (let minute = 0; minute <= 1440; minute++) {
      const allowed = minute < 1440 && !blocked(minute);
      if (allowed && start === undefined) start = minute;
      if (!allowed && start !== undefined) {
        result.push({
          id: `migrated-${rule.id}-${day}-${start}`,
          label: `${rule.label} access`,
          enabled: true,
          domains: rule.domains,
          days: [day as DayOfWeek],
          startMinute: start,
          endMinute: minute,
        });
        start = undefined;
      }
    }
  }
  return result;
}
export function migrateState(
  raw: unknown,
  /** Defaults to the browser the state was saved in, so a page that doesn't pass one can't relabel it. */
  requested?: BrowserKind,
): AppState {
  const saved =
    object(raw) && object(raw.protection) ? raw.protection.browser : undefined;
  const browser: BrowserKind =
    requested ?? (saved === "safari" || saved === "chrome" ? saved : "chrome");
  const state = createDefaultState(browser);
  if (!object(raw)) return state;
  const legacy = raw.schemaVersion !== 3;
  state.onboardingComplete = raw.onboardingComplete === true;
  state.warningsEnabled = raw.warningsEnabled !== false;
  if (raw.passwordPromptSeen === true) state.passwordPromptSeen = true;
  if (typeof raw.usageAsOf === "number") state.usageAsOf = raw.usageAsOf;
  state.windows =
    !legacy && Array.isArray(raw.windows)
      ? (raw.windows as AccessWindow[]).map((w) => {
          const mode =
            w.mode === "block" || w.mode === "free" ? w.mode : "allow";
          const { freeMinutes, freeMinutesBySite, ...rest } = w;
          const bySite =
            mode === "free" && object(freeMinutesBySite)
              ? Object.fromEntries(
                  Object.entries(freeMinutesBySite).filter(
                    ([, v]) => typeof v === "number",
                  ),
                )
              : undefined;
          return {
            ...rest,
            mode,
            ...(bySite
              ? { freeMinutesBySite: bySite as Record<string, number> }
              : mode === "free" && typeof freeMinutes === "number"
                ? { freeMinutes }
                : {}),
          };
        })
      : [];
  const strings = (x: unknown): x is string[] =>
    Array.isArray(x) && x.length > 0 && x.every((d) => typeof d === "string");
  const goals = Array.isArray(raw.earnGoals)
    ? (raw.earnGoals as unknown[]).filter(object).flatMap((g): EarnGoal[] =>
        typeof g.id === "string" &&
        strings(g.goalDomains) &&
        strings(g.lockedDomains) &&
        typeof g.minutes === "number" &&
        g.minutes > 0
          ? [
              {
                id: g.id,
                label: String(g.label ?? "Earn your time"),
                enabled: g.enabled !== false,
                goalDomains: g.goalDomains,
                minutes: g.minutes,
                lockedDomains: g.lockedDomains,
              },
            ]
          : [],
      )
    : [];
  if (goals.length) state.earnGoals = goals;
  state.rules = Array.isArray(raw.rules)
    ? (raw.rules as Record<string, unknown>[]).filter(object).map(
        (r): WebsiteRule => ({
          id: String(r.id),
          label: String(r.label ?? "Website"),
          domains: Array.isArray(r.domains) ? (r.domains as string[]) : [],
          enabled: r.enabled !== false,
          blocked: r.blocked === true,
          dailyAllowance: object(r.dailyAllowance)
            ? (r.dailyAllowance as unknown as WebsiteRule["dailyAllowance"])
            : undefined,
          showTimer: r.showTimer === true,
          createdAt: Number(r.createdAt) || 0,
          updatedAt: Number(r.updatedAt) || 0,
        }),
      )
    : defaultRules();
  if (legacy && Array.isArray(raw.rules)) {
    (raw.rules as Record<string, unknown>[]).forEach((r, i) => {
      if (!Array.isArray(r.schedules) || !r.schedules.length) return;
      const windows = convertSchedules(
        state.rules[i],
        r.schedules as WeeklySchedule[],
      );
      if (windows.length) state.windows.push(...windows);
      else state.rules[i].blocked = true;
    });
    state.migrationNotice =
      "Mandatory PINs, temporary visits and commitments have been removed. Existing blocked schedules were converted into allowed windows; please review Windows.";
  } else if (typeof raw.migrationNotice === "string")
    state.migrationNotice = raw.migrationNotice;
  // Websites added to the registry after this install get their default (unrestricted) rule.
  for (const fresh of defaultRules())
    if (
      !state.rules.some(
        (r) =>
          r.id === fresh.id || r.domains.some((d) => fresh.domains.includes(d)),
      )
    )
      state.rules.push(fresh);
  // A legacy mandatory PIN is intentionally NOT turned into an optional settings password.
  if (!legacy && object(raw.settingsPassword))
    state.settingsPassword =
      raw.settingsPassword as unknown as AppState["settingsPassword"];
  if (!legacy && object(raw.passwordAttempts))
    state.passwordAttempts =
      raw.passwordAttempts as unknown as AppState["passwordAttempts"];
  if (object(raw.usage))
    for (const [key, value] of Object.entries(raw.usage)) {
      if (!object(value)) continue;
      state.usage[key] = {
        dateKey: key,
        millisecondsByRule: object(value.millisecondsByRule)
          ? (value.millisecondsByRule as Record<string, number>)
          : {},
        warningsSent: object(value.warningsSent)
          ? (value.warningsSent as Record<string, number[]>)
          : {},
        millisecondsByWindow: object(value.millisecondsByWindow)
          ? (value.millisecondsByWindow as Record<string, number>)
          : {},
        millisecondsByGoal: object(value.millisecondsByGoal)
          ? (value.millisecondsByGoal as Record<string, number>)
          : {},
      };
    }
  const feeds = object(raw.feedSettings)
    ? (raw.feedSettings as unknown as FeedSettings)
    : undefined;
  state.feedSettings.globalEnabled = feeds?.globalEnabled !== false;
  // Retire the redundant TikTok video blocker without silently removing an active block.
  // The old key is dropped below, making this a one-time migration when saved.
  if (feeds?.globalEnabled !== false && feeds?.sites?.tiktok?.videos === true) {
    const rule = state.rules.find((r) => r.domains.includes("tiktok.com"));
    if (rule) {
      rule.blocked = true;
      rule.enabled = true;
    }
    state.migrationNotice =
      "TikTok’s old Block videos control is now Block TikTok in Essentials. You can change it there.";
  }
  for (const site of Object.keys(feedDefaults.sites) as FeedSite[]) {
    for (const key of Object.keys(feedDefaults.sites[site]))
      state.feedSettings.sites[site][key] =
        feeds?.sites?.[site]?.[key] === true;
  }
  if (object(raw.protection)) {
    const p = raw.protection;
    state.protection = {
      browser,
      privateAccess:
        p.privateAccess === "verified" || p.privateAccess === "observed"
          ? p.privateAccess
          : "unverified",
      lastCheckedAt: p.lastCheckedAt as number | undefined,
      lastObservedAt: p.lastObservedAt as number | undefined,
    };
  }
  return state;
}
