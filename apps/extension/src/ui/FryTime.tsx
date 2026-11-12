import React from "react";
import type { SiteStatus } from "./siteStatus";
import { formatMinuteOfDay } from "./format";

type Fry = NonNullable<SiteStatus["fryTime"]>;

/** "“Evening” is on until 9:00 PM, 12m left." */
export function fryTimeSummary(fry: Fry): string {
  if (fry.earned)
    return `Earned with “${fry.label}”${fry.remainingMilliseconds === undefined ? "" : `, ${fryClock(fry.remainingMilliseconds)} left`}.`;
  const until = fry.endMinute === undefined ? "" : ` until ${formatMinuteOfDay(fry.endMinute)}`;
  const left =
    fry.remainingMilliseconds === undefined
      ? ""
      : `, ${fryClock(fry.remainingMilliseconds)} left`;
  return `“${fry.label}” is on${until}${left}.`;
}

/** Why switches that are on aren't hiding anything: Fry Time has paused them. */
export function fryTimeDetail(fry: Fry, site: string): string {
  return `Fry Time: ${fryTimeSummary(fry)} ScreenFry’s feed and Shorts blocking for ${site} is paused, so the switches you turned on aren’t hiding anything right now. They come back on their own when Fry Time ends.`;
}

/**
 * Fry Time left as a clock: "4:32" under ten minutes, then whole minutes ("12m"), or "On"
 * when the window has no budget.
 */
export function fryClock(ms: number | undefined): string {
  if (ms === undefined) return "On";
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec >= 600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** ScreenFry's dripping logo, small, for Fry Time chips. */
export function FryMark() {
  return (
    <svg className="fry-mark-mini" viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <mask id="fry-mark-face">
          <rect width="36" height="36" fill="white" />
          <circle cx="18" cy="15" r="7.2" fill="black" />
          <path d="M18 15 V10.2 M18 15 H21.6" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
        </mask>
      </defs>
      <g mask="url(#fry-mark-face)" fill="currentColor">
        <rect x="2.5" y="3.5" width="31" height="22.5" rx="5.5" />
        <path d="M22.5 24 h4 v5.2 a2 2 0 0 1 -4 0 z" />
        <path d="M28.6 24 h3 v2.8 a1.5 1.5 0 0 1 -3 0 z" />
      </g>
      <rect x="13.5" y="25" width="6" height="5" fill="currentColor" />
      <rect x="9.5" y="29.5" width="12" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** A small orange chip: the dripping logo and the Fry Time left ("4:32"), details on hover. */
export function FryChip({ fry, site }: { fry: Fry; site: string }) {
  const detail = fryTimeDetail(fry, site);
  return (
    <span className="fry-chip" title={detail} role="note" aria-label={`Fry Time on ${site}: ${fryClock(fry.remainingMilliseconds)} left`}>
      <FryMark />
      <strong>{fryClock(fry.remainingMilliseconds)}</strong>
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </span>
  );
}

/** An orange bar with dripping grease. Compact: just "Fry Time" (details on hover). */
export function FryTimeBar({ fry, site, compact = false }: { fry: Fry; site: string; compact?: boolean }) {
  const detail = fryTimeDetail(fry, site);
  return (
    <span className={`fry-bar ${compact ? "compact" : ""}`} title={detail} role="note" aria-label={detail}>
      <span className="fry-bar-strip">
        <strong>Fry Time</strong>
        {!compact && <span>{fryTimeSummary(fry)}</span>}
        <i aria-hidden="true" />
        <i aria-hidden="true" />
        <i aria-hidden="true" />
      </span>
      {!compact && (
        <span className="fry-bar-detail">
          Feed and Shorts blocking for {site} is paused, so the switches you
          turned on below aren’t hiding anything right now. They come back on
          their own when Fry Time ends.
        </span>
      )}
    </span>
  );
}
