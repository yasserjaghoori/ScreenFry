/**
 * Share codes (experimental): someone's website settings as one line of text they can paste
 * to a friend. A code holds exactly what a settings file holds (no usage history, password
 * or browser details), compressed and base64url-encoded. Importing a code goes through
 * importSettings, so it is validated and password-protected like any other change.
 */
import type { SettingsExport } from "./actions";
import { siteDefinitions } from "@feeds/index";
import { expandDomainAliases, hostMatchesDomain } from "./domains";

/** Distinct website names for a domain list: "YouTube" for youtube.com and youtu.be. */
export const websiteNames = (domains: string[]) => [
  ...new Set(
    domains.map(
      (d) =>
        siteDefinitions.find((site) =>
          expandDomainAliases(site.domains).some((sd) => hostMatchesDomain(d, sd)),
        )?.name ?? d,
    ),
  ),
];

export const SHARE_PREFIX = "SCREENFRY-1-";
const MAX_CODE_LENGTH = 200_000;
const MAX_JSON_BYTES = 1_000_000;
const NOT_A_CODE = "That doesn’t look like a ScreenFry share code. Copy the whole code and try again.";

/** The parts of a settings export worth sharing, without per-browser timestamps. */
function shareable(settings: SettingsExport): SettingsExport {
  return {
    ...settings,
    rules: settings.rules.map(({ createdAt: _c, updatedAt: _u, ...rule }) => rule) as SettingsExport["rules"],
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

export async function encodeShareCode(settings: SettingsExport): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(shareable(settings)));
  return SHARE_PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
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
  if (!body.toUpperCase().startsWith(SHARE_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(body.slice(SHARE_PREFIX.length)))
    throw new Error(NOT_A_CODE);
  try {
    const bytes = await pipe(
      fromBase64Url(body.slice(SHARE_PREFIX.length)),
      new DecompressionStream("deflate-raw"),
      MAX_JSON_BYTES,
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("This share code is incomplete or damaged. Ask for it again.");
  }
}

export interface SharedSummary {
  blocked: string[];
  limits: string[];
  windows: string[];
  earnGoals: string[];
  /** Feed and button blockers switched on, across websites. */
  feedBlockers: number;
  feedBlockingOn: boolean;
}
/** What a share code would set, for a preview before applying it. Tolerates bad input. */
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
          .map(
            (g) =>
              `${g.minutes} min on ${websiteNames(g.goalDomains ?? []).join(", ")} unlocks ${websiteNames(g.lockedDomains ?? []).join(", ")}`,
          )
      : [],
    feedBlockers: Object.values(d.feedSettings?.sites ?? {}).reduce(
      (n, site) => n + Object.values(site ?? {}).filter((on) => on === true).length,
      0,
    ),
    feedBlockingOn: d.feedSettings?.globalEnabled !== false,
  };
}
