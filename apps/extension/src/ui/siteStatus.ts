import { defaultRules, launchSites } from "@core/sites";
import { hostMatchesDomain } from "@core/domains";
import { evaluatePolicy, usageFor } from "@policy/index";
import type { AppState, FeedSite } from "@shared/index";
import { formatDuration } from "./format";

export interface SiteStatus {
  usedMs: number;
  /** Daily allowance in minutes, or undefined for no limit. */
  limitMinutes?: number;
  blocked: boolean;
  /** 0–1 share of the allowance used; undefined when there is no limit. */
  progress?: number;
  label: string;
}

/** Read-only summary for display. Enforcement stays in the policy engine and background. */
export function siteStatus(state: AppState, site: FeedSite, now = Date.now()): SiteStatus {
  const info = launchSites.find((s) => s.id === site)!;
  const rule =
    state.rules.find((r) => r.domains.some((d) => hostMatchesDomain(info.domain, d))) ??
    defaultRules().find((r) => r.id === site)!;
  const usedMs = usageFor(state, rule.id, new Date(now));
  const limitMinutes = rule.enabled ? rule.dailyAllowance?.defaultMinutes : undefined;
  const blocked = evaluatePolicy(state, `https://${info.domain}/`, now).status === "blocked";
  const progress =
    limitMinutes === undefined
      ? undefined
      : limitMinutes === 0
        ? 1
        : Math.min(1, usedMs / (limitMinutes * 60_000));
  const used = formatDuration(usedMs);
  const label = blocked
    ? "Blocked now"
    : limitMinutes === undefined
      ? `${used} today`
      : `${used} of ${formatDuration(limitMinutes * 60_000)}`;
  return { usedMs, limitMinutes, blocked, progress, label };
}
