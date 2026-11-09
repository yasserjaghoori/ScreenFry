import React from "react";
import type { SiteStatus } from "./siteStatus";
import { formatDuration, formatMinuteOfDay } from "./format";

type Fry = NonNullable<SiteStatus["fryTime"]>;

/** "“Evening” is on until 9:00 PM, 12m left." */
export function fryTimeSummary(fry: Fry): string {
  if (fry.earned)
    return `Earned with “${fry.label}”${fry.remainingMilliseconds === undefined ? "" : `, ${formatDuration(fry.remainingMilliseconds)} left`}.`;
  const until = fry.endMinute === undefined ? "" : ` until ${formatMinuteOfDay(fry.endMinute)}`;
  const left =
    fry.remainingMilliseconds === undefined
      ? ""
      : `, ${formatDuration(fry.remainingMilliseconds)} left`;
  return `“${fry.label}” is on${until}${left}.`;
}

/** Why switches that are on aren't hiding anything: Fry Time has paused them. */
export function fryTimeDetail(fry: Fry, site: string): string {
  return `Fry Time: ${fryTimeSummary(fry)} ScreenFry’s feed and Shorts blocking for ${site} is paused, so the switches you turned on aren’t hiding anything right now. They come back on their own when Fry Time ends.`;
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
