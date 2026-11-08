import { describe, expect, it } from "vitest";
import { createDefaultState } from "@core/defaults";
import { MINUTE, floorToMinute } from "@core/date";
import {
  evaluatePolicy,
  isScheduleActive,
  nextPolicyBoundary,
} from "@policy/index";
import type { AppState, DayOfWeek } from "@shared/index";
import { rule } from "./helpers";

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** The original minute-by-minute scans, kept as the reference the fast version must match. */
function referenceNextAccess(state: AppState, url: string, now: number) {
  for (
    let at = floorToMinute(now) + MINUTE;
    at <= now + 8 * 86_400_000;
    at += MINUTE
  )
    if (evaluatePolicy(state, url, at).status === "allowed") return at;
  return undefined;
}
function referenceBoundary(state: AppState, now: number) {
  const d = new Date(now);
  let next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  for (const w of state.windows.filter((w) => w.enabled)) {
    const active = isScheduleActive(w, new Date(now));
    for (let at = floorToMinute(now) + MINUTE; at < next; at += MINUTE)
      if (isScheduleActive(w, new Date(at)) !== active) {
        next = at;
        break;
      }
  }
  return next;
}

describe("policy forecasts", () => {
  it("match the minute-by-minute reference for random windows and limits", () => {
    const random = rng(7);
    const url = "https://www.youtube.com/";
    for (let trial = 0; trial < 40; trial++) {
      const state = createDefaultState();
      const limit = random() < 0.5 ? 0 : undefined;
      state.rules = [
        rule({
          domains: ["youtube.com"],
          dailyAllowance:
            limit === undefined ? undefined : { defaultMinutes: limit },
        }),
      ];
      state.windows = Array.from(
        { length: 1 + Math.floor(random() * 2) },
        (_, i) => ({
          id: `w${i}`,
          label: `w${i}`,
          enabled: true,
          domains: ["youtube.com"],
          days: [0, 1, 2, 3, 4, 5, 6].filter(
            () => random() < 0.4,
          ) as DayOfWeek[],
          startMinute: Math.floor(random() * 1440),
          endMinute: Math.floor(random() * 1440),
        }),
      );
      const now = new Date(
        2026,
        10,
        1 + Math.floor(random() * 14),
        0,
        Math.floor(random() * 1440),
        17,
      ).getTime();
      const decision = evaluatePolicy(state, url, now);
      // Only the forecast's own scan is replaced; a 0-minute limit stays blocked until a
      // future day, which the reference evaluates with today's usage, so compare windows only.
      if (decision.status === "blocked" && limit === undefined)
        expect(decision.nextAccessAt, `trial ${trial}`).toBe(
          referenceNextAccess(state, url, now),
        );
      expect(nextPolicyBoundary(state, now), `trial ${trial}`).toBe(
        referenceBoundary(state, now),
      );
    }
  });

  it("finds a window six days away quickly", () => {
    const state = createDefaultState();
    state.rules = [rule({ domains: ["youtube.com"] })];
    state.windows = [
      {
        id: "w",
        label: "Mondays",
        enabled: true,
        domains: ["youtube.com"],
        days: [1],
        startMinute: 720,
        endMinute: 780,
      },
    ];
    const now = new Date(2026, 10, 10, 15, 0).getTime(); // a Tuesday
    const started = performance.now();
    const decision = evaluatePolicy(state, "https://youtube.com/", now);
    expect(performance.now() - started).toBeLessThan(15);
    expect(decision.nextAccessAt).toBe(new Date(2026, 10, 16, 12, 0).getTime());
  });
});
