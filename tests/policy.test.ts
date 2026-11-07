import { describe, expect, it } from "vitest";
import {
  evaluatePolicy,
  isScheduleActive,
  nextPolicyBoundary,
} from "@policy/index";
import type { AccessWindow } from "@shared/index";
import { at, MIN, rule, setUsage, stateWith } from "./helpers";
const url = "https://youtube.com/watch?v=normal";
const window = (patch: Partial<AccessWindow> = {}): AccessWindow => ({
  id: "lunch",
  label: "Lunch",
  enabled: true,
  domains: ["youtube.com"],
  days: [1, 2, 3, 4, 5],
  startMinute: 12 * 60,
  endMinute: 18 * 60,
  ...patch,
});
describe("daily website allowances", () => {
  it("allows a site until its allowance is exhausted, then blocks all its aliases", () => {
    const now = at(2026, 10, 3, 12),
      s = stateWith([rule()]);
    setUsage(s, 29 * MIN, "youtube", now);
    expect(evaluatePolicy(s, url, now).remainingMilliseconds).toBe(MIN);
    setUsage(s, 30 * MIN, "youtube", now);
    for (const host of [
      "youtube.com",
      "m.youtube.com",
      "youtu.be",
      "youtube-nocookie.com",
    ])
      expect(evaluatePolicy(s, `https://${host}/x`, now).status).toBe(
        "blocked",
      );
    expect(evaluatePolicy(s, "https://google.com", now).status).toBe("allowed");
  });
  it("resets at local midnight and supports 23/25-hour DST days", () => {
    for (const start of [at(2026, 2, 8, 0), at(2026, 10, 1, 0)]) {
      const s = setUsage(stateWith([rule()]), 30 * MIN, "youtube", start);
      const date = new Date(start),
        tomorrow = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate() + 1,
        ).getTime();
      expect(evaluatePolicy(s, url, start).nextAccessAt).toBe(tomorrow);
      expect(evaluatePolicy(s, url, tomorrow).status).toBe("allowed");
    }
  });
  it("treats zero minutes as blocked and no allowance as unlimited", () => {
    const now = at(2026, 10, 3, 12);
    expect(
      evaluatePolicy(
        stateWith([rule({ dailyAllowance: { defaultMinutes: 0 } })]),
        url,
        now,
      ).status,
    ).toBe("blocked");
    expect(
      evaluatePolicy(stateWith([rule({ dailyAllowance: undefined })]), url, now)
        .status,
    ).toBe("allowed");
  });
  it("keeps explicit full-site blocking independent from feed settings and windows", () => {
    const s = stateWith([rule({ blocked: true })], { windows: [window()] });
    expect(evaluatePolicy(s, url, at(2026, 10, 3, 13)).reasons).toContain(
      "site-blocked",
    );
  });
  it("honors weekday overrides retained from old storage", () => {
    const now = at(2026, 10, 3, 13),
      s = setUsage(
        stateWith([
          rule({ dailyAllowance: { defaultMinutes: 30, byWeekday: { 2: 5 } } }),
        ]),
        5 * MIN,
        "youtube",
        now,
      );
    expect(evaluatePolicy(s, url, now).status).toBe("blocked");
  });
});
describe("whitelisted allowed windows", () => {
  it("blocks before/after the window even when daily time remains", () => {
    const s = stateWith([rule()], { windows: [window()] });
    for (const hour of [8, 11, 18, 23])
      expect(evaluatePolicy(s, url, at(2026, 10, 3, hour)).reasons).toContain(
        "outside-window",
      );
    for (const hour of [12, 17])
      expect(evaluatePolicy(s, url, at(2026, 10, 3, hour)).status).toBe(
        "allowed",
      );
  });
  it("allows the union of multiple windows and never replenishes a daily allowance between them", () => {
    const s = stateWith([rule()], {
      windows: [
        window({ startMinute: 12 * 60, endMinute: 13 * 60 }),
        window({ id: "evening", startMinute: 18 * 60, endMinute: 20 * 60 }),
      ],
    });
    expect(evaluatePolicy(s, url, at(2026, 10, 3, 12)).status).toBe("allowed");
    expect(evaluatePolicy(s, url, at(2026, 10, 3, 15)).status).toBe("blocked");
    setUsage(s, 30 * MIN, "youtube", at(2026, 10, 3, 12));
    expect(evaluatePolicy(s, url, at(2026, 10, 3, 18)).reasons).toContain(
      "daily-limit",
    );
  });
  it("unlisted sites are unrestricted; domains can belong to a window without a daily rule", () => {
    const s = stateWith([], {
      windows: [window({ domains: ["example.com"] })],
    });
    expect(
      evaluatePolicy(s, "https://example.com", at(2026, 10, 3, 8)).status,
    ).toBe("blocked");
    expect(
      evaluatePolicy(s, "https://sub.example.com", at(2026, 10, 3, 12)).status,
    ).toBe("allowed");
    expect(
      evaluatePolicy(s, "https://reddit.com", at(2026, 10, 3, 8)).status,
    ).toBe("allowed");
  });
  it("uses weekday-specific and overnight windows with exclusive end times", () => {
    const w = window({ days: [1], startMinute: 22 * 60, endMinute: 2 * 60 });
    expect(isScheduleActive(w, new Date(at(2026, 10, 2, 22)))).toBe(true);
    expect(isScheduleActive(w, new Date(at(2026, 10, 3, 1, 59)))).toBe(true);
    expect(isScheduleActive(w, new Date(at(2026, 10, 3, 2)))).toBe(false);
    expect(isScheduleActive(w, new Date(at(2026, 10, 3, 22)))).toBe(false);
  });
  it("supports all-day and disabled windows", () => {
    const s = stateWith([], {
      windows: [window({ days: [1], startMinute: 0, endMinute: 0 })],
    });
    expect(evaluatePolicy(s, url, at(2026, 10, 2, 23)).status).toBe("allowed");
    expect(evaluatePolicy(s, url, at(2026, 10, 3, 12)).status).toBe("blocked");
    s.windows[0].enabled = false;
    expect(evaluatePolicy(s, url, at(2026, 10, 3, 12)).status).toBe("allowed");
  });
  it("finds access only when BOTH the window and daily allowance permit it", () => {
    const now = at(2026, 10, 3, 17),
      s = setUsage(
        stateWith([rule()], { windows: [window()] }),
        30 * MIN,
        "youtube",
        now,
      );
    expect(evaluatePolicy(s, url, now).nextAccessAt).toBe(at(2026, 10, 4, 12));
    expect(evaluatePolicy(s, url, at(2026, 10, 3, 8)).nextAccessAt).toBe(
      at(2026, 10, 4, 12),
    );
  });
  it("schedules the next start/end and midnight boundary", () => {
    const s = stateWith([], { windows: [window()] });
    expect(nextPolicyBoundary(s, at(2026, 10, 3, 9))).toBe(at(2026, 10, 3, 12));
    expect(nextPolicyBoundary(s, at(2026, 10, 3, 13))).toBe(
      at(2026, 10, 3, 18),
    );
  });
  it("handles both occurrences of a repeated DST hour", () => {
    const w = window({ days: [0], startMinute: 60, endMinute: 180 });
    const first = at(2026, 10, 1, 1, 30);
    expect(isScheduleActive(w, new Date(first))).toBe(true);
    expect(isScheduleActive(w, new Date(first + 60 * MIN))).toBe(true);
  });
});
describe("complete short-form blocking", () => {
  it("blocks Shorts direct/notification links and preserves normal videos; no override can apply", () => {
    const now = at(2026, 10, 3, 12),
      s = stateWith([rule()]);
    s.feedSettings.sites.youtube.shorts = true;
    for (const path of [
      "/shorts",
      "/shorts/abc?feature=notification",
      "/shorts/abc#x",
    ])
      expect(
        evaluatePolicy(s, `https://m.youtube.com${path}`, now).reasons,
      ).toContain("short-form");
    expect(evaluatePolicy(s, url, now).status).toBe("allowed");
    Object.assign(s, {
      overrides: { youtube: { startedAt: now, expiresAt: now + 10 * MIN } },
    });
    expect(
      evaluatePolicy(s, "https://youtube.com/shorts/abc", now).status,
    ).toBe("blocked");
  });
  it("blocks both individual Reels and the Reels feed only when enabled", () => {
    const now = at(2026, 10, 3, 12),
      s = stateWith([]);
    s.feedSettings.sites.instagram.reels = true;
    for (const path of ["/reel/abc", "/reels/", "/reels/abc"])
      expect(
        evaluatePolicy(s, `https://instagram.com${path}`, now).status,
      ).toBe("blocked");
    expect(
      evaluatePolicy(s, "https://instagram.com/direct/inbox", now).status,
    ).toBe("allowed");
    s.feedSettings.sites.instagram.reels = false;
    expect(
      evaluatePolicy(s, "https://instagram.com/reel/abc", now).status,
    ).toBe("allowed");
  });
});
