import type { PolicyDecision } from "@shared/index";
import { formatWhen } from "./format";

/**
 * The words on a block screen, so each reason reads differently: out of time today, outside
 * an allowed window, inside a block window, or short-form off because free time is spent
 * versus not started yet.
 */
export function blockedCopy(
  decision: PolicyDecision,
  label: string,
  now = Date.now(),
): { title: string; details: string[]; next?: string; nextAt?: number } {
  const has = (reason: PolicyDecision["reasons"][number]) =>
    decision.reasons.includes(reason);
  const free = has("short-form") ? decision.freeTimeOff : undefined;
  const details: string[] = [];
  if (has("site-blocked")) details.push("You’ve turned on full website blocking.");
  if (has("block-window")) details.push("One of your block windows is on right now.");
  if (has("outside-window"))
    details.push(`${label} is outside its allowed windows. It opens when one starts.`);
  if (has("daily-limit"))
    details.push(
      `You’ve used your daily allowance for ${label}. Your timer resets at midnight, every day, in your local time zone.`,
    );
  if (free?.state === "used-up")
    details.push(
      `You’ve used today’s free time in ${free.label}, so feeds and short-form videos are hidden again.`,
    );
  else if (free)
    details.push(
      `Short-form videos are off outside your free time. ${free.label} isn’t on right now.`,
    );
  else if (has("short-form"))
    details.push(
      "Short-form playback is turned off for this website. Direct links and notifications follow the same setting.",
    );
  const nextAt = decision.nextAccessAt ?? free?.nextAt;
  const next = decision.nextAccessAt
    ? `Back ${formatWhen(decision.nextAccessAt, now)}`
    : free?.nextAt
      ? `${free.state === "used-up" ? "Free time is back" : "Free time starts"} ${formatWhen(free.nextAt, now)}`
      : undefined;
  return {
    title: has("daily-limit")
      ? "Time is up!"
      : free?.state === "used-up"
        ? "Free time is up!"
        : `${label} is off for now.`,
    details,
    next,
    ...(nextAt === undefined ? {} : { nextAt }),
  };
}

/** A live countdown for block screens: "2h 05m 09s", with days once it's a day or more away. */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(total / 86400),
    hours = Math.floor((total % 86400) / 3600),
    minutes = Math.floor((total % 3600) / 60),
    seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days ? `${days}d ` : ""}${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
}
