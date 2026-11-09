import { defaultRules, launchSites } from "@core/sites";
import { hostMatchesDomain } from "@core/domains";
import { activeFreeTime, evaluatePolicy, usageFor } from "@policy/index";
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
  /** Set while a Fry Time window has paused this website's feed blocking. */
  fryTime?: {
    label: string;
    /** Minutes of Fry Time left today, when the window has a budget. */
    remainingMilliseconds?: number;
    /** When the window itself ends, as a minute of the day. */
    endMinute?: number;
    /** Earned by meeting an earn goal, rather than a Fry Time window. */
    earned?: boolean;
  };
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
  const fry = activeFreeTime(state, `https://${info.domain}/`, now);
  const fryWindow = fry && state.windows.find((w) => w.id === fry.windowId);
  const fryTime = fry && {
    label: fry.label,
    ...(fry.earned ? { earned: true } : {}),
    ...(fry.remainingMilliseconds === undefined
      ? {}
      : { remainingMilliseconds: fry.remainingMilliseconds }),
    ...(fryWindow && fryWindow.startMinute !== fryWindow.endMinute
      ? { endMinute: fryWindow.endMinute % 1440 }
      : {}),
  };
  return { usedMs, limitMinutes, blocked, progress, label, ...(fryTime ? { fryTime } : {}) };
}
