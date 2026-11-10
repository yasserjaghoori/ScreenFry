/**
 * Share codes (experimental): someone's website settings as one short line of text they can
 * paste to a friend. A code holds only what differs from a fresh install (restrictions,
 * windows, earn goals and feed blockers that are on), in a compact form, never usage
 * history, the password or browser details. Decoding expands it back into a settings file,
 * and importing goes through importSettings, so it is validated and password-protected like
 * any other change.
 */
import type { SettingsExport } from "./actions";
import type { AccessWindow, DayOfWeek, EarnGoal, FeedSettings, WebsiteRule } from "@shared/index";
import { siteDefinitions } from "@feeds/index";
import { expandDomainAliases, hostMatchesDomain } from "./domains";
import { defaultRules } from "./sites";
import { feedDefaults } from "./defaults";

/** Distinct website names for a domain list: "YouTube" for youtube.com and youtu.be. */
export const websiteNames = (domains: string[]) => [
  ...new Set(domains.map((d) => siteOfDomain(d)?.name ?? d)),
];
const siteOfDomain = (domain: string) =>
  siteDefinitions.find((site) =>
    expandDomainAliases(site.domains).some((sd) => hostMatchesDomain(domain, sd)),
  );

/** Current codes. Old "SCREENFRY-1-" codes (the whole settings file, compressed) still work. */
export const SHARE_PREFIX = "SF2-";
const V1_PREFIX = "SCREENFRY-1-";
const MAX_CODE_LENGTH = 200_000;
const MAX_JSON_BYTES = 1_000_000;
const NOT_A_CODE = "That doesn’t look like a ScreenFry share code. Copy the whole code and try again.";
const DAMAGED = "This share code is incomplete or damaged. Ask for it again.";

/**
 * The compact payload. Websites are written as their site id ("youtube" stands for every
 * YouTube domain) or, for other websites, their domain; lists are space-separated.
 * - r: rules that differ from the default, by website: [flags, minutes?, minutes by weekday?]
 *   (flags: 1 blocked, 2 on-page timer, 4 switched off)
 * - w: windows: [label, mode 0 allow / 1 block / 2 Fry Time, day bits, start, end, websites,
 *   Fry minutes (number, per-website object or 0 for the whole window), 1 if switched off]
 * - e: earn goals: [label, minutes, goal website, websites, 1 if switched off else 0, and
 *   for a Fry Time reward: times a day (0 = no limit), Fry minutes (number, per website, or a
 *   list for the 1st, 2nd… time)]
 * - f: feed blockers that are on, by site id: "home shorts"
 * - g: 0 when feed blocking is off everywhere; n: 0 when time-limit warnings are off
 */
interface Payload {
  r?: Record<string, [number, number?, Record<string, number>?]>;
  w?: [string, number, number, number, number, string, (number | Record<string, number>)?, 1?][];
  e?: [string, number, string, string, (0 | 1)?, number?, (number | number[] | Record<string, number>)?][];
  f?: Record<string, string>;
  g?: 0;
  n?: 0;
}
const MODES = ["allow", "block", "free"] as const;
/** What a code holds: a settings export or a loadout. */
type Shareable = Pick<SettingsExport, "rules" | "windows" | "earnGoals" | "feedSettings" | "warningsEnabled">;

/** "youtube.com youtu.be example.com" → "youtube example.com" */
function packSites(domains: string[]): string {
  return [...new Set(domains.map((d) => siteOfDomain(d)?.site ?? d))].join(" ");
}
function unpackSites(text: unknown): string[] {
  if (typeof text !== "string") throw new Error(DAMAGED);
  return expandDomainAliases(
    text
      .split(" ")
      .filter(Boolean)
      .flatMap((key) => siteDefinitions.find((s) => s.site === key)?.domains ?? [key]),
  );
}
const sameDomains = (a: string[], b: string[]) =>
  [...a].sort().join() === [...b].sort().join();

function pack(settings: Shareable): Payload {
  const p: Payload = {};
  const defaults = defaultRules();
  for (const rule of settings.rules) {
    const fresh = defaults.find((d) => sameDomains(d.domains, rule.domains));
    const flags = (rule.blocked ? 1 : 0) | (rule.showTimer ? 2 : 0) | (rule.enabled ? 0 : 4);
    const allowance = rule.dailyAllowance;
    if (fresh && !flags && !allowance) continue;
    const entry: [number, number?, Record<string, number>?] = [flags];
    if (allowance) {
      entry.push(allowance.defaultMinutes);
      if (allowance.byWeekday && Object.keys(allowance.byWeekday).length)
        entry.push(allowance.byWeekday as Record<string, number>);
    }
    (p.r ??= {})[fresh ? fresh.id : packSites(rule.domains)] = entry;
  }
  for (const w of settings.windows) {
    const days = w.days.reduce<number>((bits, d) => bits | (1 << d), 0);
    const fry =
      w.mode !== "free" ? undefined : (w.freeMinutesBySite ?? w.freeMinutes ?? 0);
    const entry: NonNullable<Payload["w"]>[number] = [
      w.label,
      MODES.indexOf(w.mode ?? "allow"),
      days,
      w.startMinute,
      w.endMinute,
      packSites(w.domains),
    ];
    if (fry !== undefined || !w.enabled) entry.push(fry ?? 0);
    if (!w.enabled) entry.push(1);
    (p.w ??= []).push(entry);
  }
  for (const g of settings.earnGoals ?? []) {
    const entry: NonNullable<Payload["e"]>[number] = [
      g.label,
      g.minutes,
      packSites(g.goalDomains),
      packSites(g.lockedDomains),
    ];
    if (g.reward === "fry")
      entry.push(
        g.enabled ? 0 : 1,
        g.repeats ?? 1,
        g.fryMinutesBySite ?? g.fryMinutesSchedule ?? g.fryMinutes ?? 0,
      );
    else if (!g.enabled) entry.push(1);
    (p.e ??= []).push(entry);
  }
  for (const [site, elements] of Object.entries(settings.feedSettings.sites)) {
    const on = Object.keys(elements).filter((k) => elements[k] === true);
    if (on.length) (p.f ??= {})[site] = on.join(" ");
  }
  if (settings.feedSettings.globalEnabled === false) p.g = 0;
  if (settings.warningsEnabled === false) p.n = 0;
  return p;
}

function unpack(p: Payload): SettingsExport {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error(DAMAGED);
  const rules: WebsiteRule[] = defaultRules();
  for (const [key, entry] of Object.entries(p.r ?? {})) {
    if (!Array.isArray(entry)) throw new Error(DAMAGED);
    const [flags, minutes, byWeekday] = entry;
    const domains = unpackSites(key);
    let rule = rules.find((r) => sameDomains(r.domains, domains));
    if (!rule) {
      rule = { ...defaultRules()[0], id: "", label: domains[0], domains };
      rules.push(rule);
    }
    rule.blocked = (flags & 1) === 1;
    rule.showTimer = (flags & 2) === 2;
    rule.enabled = (flags & 4) === 0;
    if (typeof minutes === "number")
      rule.dailyAllowance = {
        defaultMinutes: minutes,
        ...(byWeekday ? { byWeekday: byWeekday as Partial<Record<DayOfWeek, number>> } : {}),
      };
  }
  const windows: AccessWindow[] = (p.w ?? []).map((entry) => {
    if (!Array.isArray(entry)) throw new Error(DAMAGED);
    const [label, mode, days, startMinute, endMinute, sites, fry, off] = entry;
    const w: AccessWindow = {
      id: "",
      label,
      mode: MODES[mode] ?? "allow",
      enabled: off !== 1,
      days: ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).filter((d) => (days >> d) & 1),
      startMinute,
      endMinute,
      domains: unpackSites(sites),
    };
    if (w.mode === "free" && typeof fry === "number" && fry > 0) w.freeMinutes = fry;
    if (w.mode === "free" && fry && typeof fry === "object") w.freeMinutesBySite = fry;
    return w;
  });
  const earnGoals: EarnGoal[] = (p.e ?? []).map((entry) => {
    if (!Array.isArray(entry)) throw new Error(DAMAGED);
    const [label, minutes, goal, locked, off, repeats, fry] = entry;
    const g: EarnGoal = {
      id: "",
      label,
      minutes,
      goalDomains: unpackSites(goal),
      lockedDomains: unpackSites(locked),
      enabled: off !== 1,
    };
    if (repeats !== undefined) {
      g.reward = "fry";
      g.repeats = repeats;
      if (typeof fry === "number") g.fryMinutes = fry;
      else if (Array.isArray(fry)) {
        g.fryMinutesSchedule = fry;
        g.fryMinutes = fry[0];
      } else if (fry && typeof fry === "object") g.fryMinutesBySite = fry;
    }
    return g;
  });
  const feedSettings: FeedSettings = structuredClone(feedDefaults);
  feedSettings.globalEnabled = p.g !== 0;
  for (const [site, keys] of Object.entries(p.f ?? {}))
    for (const key of String(keys).split(" "))
      if (feedSettings.sites[site as keyof FeedSettings["sites"]]?.[key] === false)
        feedSettings.sites[site as keyof FeedSettings["sites"]][key] = true;
  return {
    format: "screenfry-settings-v1",
    exportedAt: new Date(0).toISOString(),
    rules,
    windows,
    earnGoals,
    feedSettings,
    warningsEnabled: p.n !== 0,
  };
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error(NOT_A_CODE);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * "SF2-" then "z" and the compressed payload, or "j" and the plain payload when compressing
 * wouldn't make it shorter (small setups).
 */
export async function encodeShareCode(settings: Shareable): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(pack(settings)));
  const zipped = await pipe(json, new CompressionStream("deflate-raw"));
  return zipped.length < json.length
    ? `${SHARE_PREFIX}z${toBase64Url(zipped)}`
    : `${SHARE_PREFIX}j${toBase64Url(json)}`;
}

/** The settings inside a share code (or a pasted settings file), not yet validated. */
export async function decodeShareCode(code: string): Promise<unknown> {
  const text = String(code ?? "").trim();
  if (!text || text.length > MAX_CODE_LENGTH) throw new Error(NOT_A_CODE);
  // A settings file pasted as text works too.
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(NOT_A_CODE);
    }
  }
  const body = text.replace(/\s+/g, "");
  const upper = body.toUpperCase();
  const prefix = upper.startsWith(SHARE_PREFIX) ? SHARE_PREFIX : upper.startsWith(V1_PREFIX) ? V1_PREFIX : "";
  const data = body.slice(prefix.length);
  if (!prefix || !/^[A-Za-z0-9_-]+$/.test(data)) throw new Error(NOT_A_CODE);
  try {
    if (prefix === V1_PREFIX)
      return JSON.parse(new TextDecoder().decode(await inflate(data)));
    const bytes = data[0] === "z" ? await inflate(data.slice(1)) : data[0] === "j" ? fromBase64Url(data.slice(1)) : undefined;
    if (!bytes || bytes.length > MAX_JSON_BYTES) throw new Error(DAMAGED);
    return unpack(JSON.parse(new TextDecoder().decode(bytes)) as Payload);
  } catch {
    throw new Error(DAMAGED);
  }
}
const inflate = (data: string) =>
  pipe(fromBase64Url(data), new DecompressionStream("deflate-raw"), MAX_JSON_BYTES);

export interface SharedSummary {
  blocked: string[];
  limits: string[];
  windows: string[];
  earnGoals: string[];
  /** Feed and button blockers switched on, across websites. */
  feedBlockers: number;
  feedBlockingOn: boolean;
}
/** What a loadout or code sets, as a short summary. Tolerates bad input. */
export function summarizeShared(data: unknown): SharedSummary {
  const d = (data ?? {}) as Partial<SettingsExport>;
  const rules = Array.isArray(d.rules) ? d.rules.filter((r) => r && r.enabled !== false) : [];
  return {
    blocked: rules.filter((r) => r.blocked).map((r) => String(r.label)),
    limits: rules
      .filter((r) => !r.blocked && typeof r.dailyAllowance?.defaultMinutes === "number")
      .map((r) => `${r.label}: ${r.dailyAllowance!.defaultMinutes} min a day`),
    windows: Array.isArray(d.windows)
      ? d.windows.filter((w) => w && w.enabled !== false).map((w) => String(w.label))
      : [],
    earnGoals: Array.isArray(d.earnGoals)
      ? d.earnGoals
          .filter((g) => g && g.enabled !== false)
          .map((g) =>
            g.reward === "fry"
              ? `${g.minutes} min on ${websiteNames(g.goalDomains ?? []).join(", ")} earns Fry Time on ${websiteNames(g.lockedDomains ?? []).join(", ")}`
              : `${g.minutes} min on ${websiteNames(g.goalDomains ?? []).join(", ")} unlocks ${websiteNames(g.lockedDomains ?? []).join(", ")}`,
          )
      : [],
    feedBlockers: Object.values(d.feedSettings?.sites ?? {}).reduce(
      (n, site) => n + Object.values(site ?? {}).filter((on) => on === true).length,
      0,
    ),
    feedBlockingOn: d.feedSettings?.globalEnabled !== false,
  };
}
