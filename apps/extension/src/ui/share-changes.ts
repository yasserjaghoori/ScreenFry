import type { SettingsExport } from "@core/actions";
import { expandDomainAliases, hostMatchesDomain } from "@core/domains";
import { websiteNames } from "@core/share";
import { siteDefinitions } from "@feeds/index";
import type { AccessWindow, AppState, EarnGoal, WebsiteRule } from "@shared/index";
import { describeDays, formatMinuteOfDay, formatMinutes } from "./format";

/** One setting a share code would change: what it is now and what it becomes. */
export interface ShareChange {
  label: string;
  from: string;
  to: string;
}
/** A slide in the share-code preview: one website (or "Everywhere") and its changes. */
export interface ShareSlide {
  key: string;
  name: string;
  color?: string;
  symbol?: string;
  changes: ShareChange[];
}
type Settings = Pick<SettingsExport, "rules" | "windows" | "earnGoals" | "feedSettings" | "warningsEnabled">;

const NONE = "None";
const onOff = (on: boolean) => (on ? "On" : "Off");
const touches = (domains: string[], site: string[]) =>
  domains.some((d) => site.some((s) => hostMatchesDomain(d, s) || hostMatchesDomain(s, d)));

function ruleFor(settings: Settings, site: string[]): WebsiteRule | undefined {
  return settings.rules.find((r) => r.enabled && touches(r.domains, site));
}
function limitText(rule: WebsiteRule | undefined): string {
  const allowance = rule?.dailyAllowance;
  if (!allowance) return "No limit";
  const m = allowance.defaultMinutes;
  const base = m === 0 ? "No access" : `${m < 60 ? `${m} min` : formatMinutes(m)} a day`;
  return allowance.byWeekday && Object.keys(allowance.byWeekday).length
    ? `${base}, other days vary`
    : base;
}
const MODE_NAMES = { allow: "Allow window", block: "Block window", free: "Fry Time" } as const;
function windowText(w: AccessWindow): string {
  const time =
    w.startMinute === w.endMinute || (w.startMinute === 0 && w.endMinute === 1440)
      ? "all day"
      : `${formatMinuteOfDay(w.startMinute)}–${formatMinuteOfDay(w.endMinute)}`;
  const fry =
    w.mode !== "free"
      ? ""
      : w.freeMinutes
        ? `, ${w.freeMinutes} min`
        : w.freeMinutesBySite
          ? ", custom minutes"
          : "";
  return `${describeDays(w.days)}, ${time}${fry}${w.enabled ? "" : " (off)"}`;
}
const off = (g: EarnGoal) => (g.enabled ? "" : " (off)");
const goalLockText = (g: EarnGoal) =>
  g.reward === "fry"
    ? `Fry Time for ${g.minutes} min on ${websiteNames(g.goalDomains).join(", ")}${off(g)}`
    : `Locked until ${g.minutes} min on ${websiteNames(g.goalDomains).join(", ")}${off(g)}`;
const goalEarnText = (g: EarnGoal) =>
  `${g.minutes} min here ${g.reward === "fry" ? "earns Fry Time on" : "unlocks"} ${websiteNames(g.lockedDomains).join(", ")}${off(g)}`;

/**
 * Rows for things listed by name (windows, earn goals): added, removed or changed, matched
 * by their name.
 */
function namedChanges<T>(
  label: (item: T) => string,
  text: (item: T) => string,
  before: T[],
  after: T[],
): ShareChange[] {
  const names = [...new Set([...before, ...after].map(label))];
  return names.flatMap((name) => {
    const a = before.find((x) => label(x) === name),
      b = after.find((x) => label(x) === name);
    const from = a ? text(a) : NONE,
      to = b ? text(b) : NONE;
    return from === to ? [] : [{ label: name, from, to }];
  });
}

function websiteChanges(current: Settings, incoming: Settings, site: string[]): ShareChange[] {
  const changes: ShareChange[] = [];
  const add = (label: string, from: string, to: string) =>
    from !== to && changes.push({ label, from, to });
  const before = ruleFor(current, site),
    after = ruleFor(incoming, site);
  add("Block the whole website", onOff(Boolean(before?.blocked)), onOff(Boolean(after?.blocked)));
  add("Daily limit", limitText(before), limitText(after));
  add("On-page timer", onOff(Boolean(before?.showTimer)), onOff(Boolean(after?.showTimer)));
  const windowsOf = (s: Settings) => s.windows.filter((w) => touches(w.domains, site));
  changes.push(
    ...namedChanges(
      (w: AccessWindow) => `${MODE_NAMES[w.mode ?? "allow"]} “${w.label}”`,
      windowText,
      windowsOf(current),
      windowsOf(incoming),
    ),
  );
  const locking = (s: Settings) => (s.earnGoals ?? []).filter((g) => touches(g.lockedDomains, site));
  changes.push(
    ...namedChanges((g: EarnGoal) => `Earn goal “${g.label}”`, goalLockText, locking(current), locking(incoming)),
  );
  const earning = (s: Settings) => (s.earnGoals ?? []).filter((g) => touches(g.goalDomains, site));
  changes.push(
    ...namedChanges((g: EarnGoal) => `Earn goal “${g.label}”`, goalEarnText, earning(current), earning(incoming)),
  );
  return changes;
}

/**
 * What applying a share code would change, one slide per website it affects (supported
 * websites first, then others), then an "Everywhere" slide for global switches. Websites
 * that stay the same get no slide.
 */
export function shareSlides(current: AppState | Settings, incoming: Settings): ShareSlide[] {
  const slides: ShareSlide[] = [];
  for (const site of siteDefinitions) {
    const domains = expandDomainAliases(site.domains);
    const changes = websiteChanges(current, incoming, domains);
    for (const [key, element] of Object.entries(site.elements)) {
      const from = current.feedSettings.sites[site.site]?.[key] === true,
        to = incoming.feedSettings.sites[site.site]?.[key] === true;
      if (from !== to) changes.push({ label: element.label, from: onOff(from), to: onOff(to) });
    }
    if (changes.length)
      slides.push({ key: site.site, name: site.name, color: site.color, symbol: site.symbol, changes });
  }
  // Other websites named anywhere in either setup.
  const registry = siteDefinitions.flatMap((s) => expandDomainAliases(s.domains));
  const others = new Set<string>();
  for (const s of [current, incoming])
    for (const domain of [
      ...s.rules.flatMap((r) => r.domains),
      ...s.windows.flatMap((w) => w.domains),
      ...(s.earnGoals ?? []).flatMap((g) => [...g.goalDomains, ...g.lockedDomains]),
    ])
      if (!touches([domain], registry)) others.add(domain);
  for (const domain of [...others].sort()) {
    const changes = websiteChanges(current, incoming, [domain]);
    if (changes.length) slides.push({ key: domain, name: domain, changes });
  }
  const everywhere: ShareChange[] = [];
  if (current.warningsEnabled !== incoming.warningsEnabled)
    everywhere.push({
      label: "Time-limit warnings",
      from: onOff(current.warningsEnabled),
      to: onOff(incoming.warningsEnabled),
    });
  if (everywhere.length) slides.push({ key: "everywhere", name: "Everywhere", changes: everywhere });
  return slides;
}
