import { describe, expect, it } from "vitest";
import { localDateKey } from "@core/date";
import {
  creditUsage,
  MAX_CREDIT_MS,
  nextTrackingBoundary,
  pickTrackedTabs,
  shouldCount,
  creditSessions,
} from "@core/tracking";
import { MIN, at, rule, setUsage, stateWith } from "./helpers";

describe("what counts as usage", () => {
  it("counts the focused tab even without recent input, but not an inactive silent tab", () => {
    expect(shouldCount({ windowFocused: true, idleState: "idle" })).toBe(true);
    expect(shouldCount({ windowFocused: false, idleState: "active" })).toBe(
      false,
    );
    expect(shouldCount({ windowFocused: true, idleState: "locked" })).toBe(
      false,
    );
  });
  it("counts actual background audio and muted video playback", () => {
    expect(
      shouldCount({ windowFocused: false, idleState: "idle", audible: true }),
    ).toBe(true);
    expect(
      shouldCount({
        windowFocused: false,
        idleState: "active",
        mediaPlaying: true,
      }),
    ).toBe(true);
    expect(
      shouldCount({
        windowFocused: false,
        idleState: "active",
        mediaPlaying: false,
      }),
    ).toBe(false);
  });
  it("selects foreground and playing background tabs, excluding merely open tabs", () => {
    const tabs = [
      { id: 1, windowId: 1, active: true, url: "https://reddit.com" },
      {
        id: 2,
        windowId: 1,
        active: false,
        url: "https://youtube.com",
        audible: true,
      },
      {
        id: 3,
        windowId: 2,
        active: false,
        url: "https://instagram.com",
        mediaPlaying: true,
      },
      { id: 4, windowId: 2, active: true, url: "https://substack.com" },
      { id: 5, windowId: 1, active: false, url: "https://x.com" },
    ];
    expect(pickTrackedTabs(tabs, 1).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(pickTrackedTabs(tabs, undefined).map((t) => t.id)).toEqual([2, 3]);
  });
});

describe("crediting usage", () => {
  it("credits the matching rule and host, never two tabs at once", () => {
    const now = at(2026, 10, 3, 12);
    const state = stateWith([rule()]);
    creditUsage(state, "https://www.youtube.com/watch?v=1", now, now + 30_000);
    creditUsage(state, "https://youtu.be/2", now + 30_000, now + 60_000);
    const day = state.usage[localDateKey(new Date(now))];
    expect(day.millisecondsByRule.youtube).toBe(60_000);
    expect(day.millisecondsByHost["youtube.com"]).toBe(30_000);
    expect(day.millisecondsByHost["youtu.be"]).toBe(30_000);
  });

  it("caps a single gap so sleep or a suspended worker is not counted", () => {
    const now = at(2026, 10, 3, 12);
    const state = stateWith([rule()]);
    const { credited } = creditUsage(
      state,
      "https://youtube.com",
      now,
      now + 3 * 60 * MIN,
    );
    expect(credited).toBe(MAX_CREDIT_MS);
  });

  it("splits a session that crosses local midnight", () => {
    const start = at(2026, 10, 3, 23, 59, 30);
    const state = stateWith([rule()]);
    creditUsage(state, "https://youtube.com", start, start + 60_000);
    expect(state.usage["2026-11-03"].millisecondsByRule.youtube).toBe(30_000);
    expect(state.usage["2026-11-04"].millisecondsByRule.youtube).toBe(30_000);
  });

  it("does not double-count the same website across simultaneous tabs", () => {
    const now = at(2026, 10, 3, 12),
      state = stateWith([rule()]);
    creditSessions(
      state,
      [
        { tabId: 1, windowId: 1, url: "https://youtube.com", startedAt: now },
        {
          tabId: 2,
          windowId: 1,
          url: "https://youtu.be/a",
          startedAt: now + 10_000,
        },
      ],
      now + 60_000,
    );
    expect(state.usage["2026-11-03"].millisecondsByRule.youtube).toBe(60_000);
  });
  it("credits different sites simultaneously, without counting unplayed background tabs", () => {
    const now = at(2026, 10, 3, 12),
      state = stateWith([
        rule(),
        rule({ id: "reddit", domains: ["reddit.com"] }),
      ]);
    creditSessions(
      state,
      [
        { tabId: 1, windowId: 1, url: "https://youtube.com", startedAt: now },
        { tabId: 2, windowId: 1, url: "https://reddit.com", startedAt: now },
      ],
      now + 60_000,
    );
    expect(state.usage["2026-11-03"].millisecondsByRule).toEqual({
      youtube: 60_000,
      reddit: 60_000,
    });
  });
  it("stops crediting when an allowed window closes, even if a checkpoint is late", () => {
    const now = at(2026, 10, 3, 17, 59, 30),
      state = stateWith([rule()], {
        windows: [
          {
            id: "w",
            label: "Afternoon",
            enabled: true,
            domains: ["youtube.com"],
            days: [2],
            startMinute: 720,
            endMinute: 1080,
          },
        ],
      });
    creditUsage(state, "https://youtube.com", now, now + 60_000);
    expect(state.usage["2026-11-03"].millisecondsByRule.youtube).toBe(30_000);
  });
  it("caps credited time at the remaining allowance", () => {
    const now = at(2026, 10, 3, 12),
      state = setUsage(stateWith([rule()]), 29.5 * MIN, "youtube", now);
    creditUsage(state, "https://youtube.com", now, now + 60_000);
    expect(state.usage["2026-11-03"].millisecondsByRule.youtube).toBe(30 * MIN);
  });

  it("always measures restricted sites even with general history off", () => {
    const now = at(2026, 10, 3, 12);
    const state = stateWith([rule()], { trackingEnabled: false });
    creditUsage(state, "https://youtube.com", now, now + 60_000);
    creditUsage(state, "https://example.com", now + 60_000, now + 90_000);
    const day = state.usage[localDateKey(new Date(now))];
    expect(day.millisecondsByRule.youtube).toBe(60_000);
    expect(day.millisecondsByHost).toEqual({});
  });

  it("raises the 5- and 1-minute warnings once each", () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 24.5 * MIN, "youtube", now);
    expect(
      creditUsage(state, "https://youtube.com", now, now + 60_000).warnings,
    ).toEqual([{ ruleId: "youtube", label: "YouTube", minutesRemaining: 5 }]);
    expect(
      creditUsage(state, "https://youtube.com", now + 60_000, now + 120_000)
        .warnings,
    ).toEqual([]);
    setUsage(state, 28.5 * MIN, "youtube", now);
    expect(
      creditUsage(state, "https://youtube.com", now, now + 60_000).warnings.map(
        (w) => w.minutesRemaining,
      ),
    ).toEqual([1]);
  });

  it("suppresses warnings when disabled", () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(
      stateWith([rule()], { warningsEnabled: false }),
      24.5 * MIN,
      "youtube",
      now,
    );
    expect(
      creditUsage(state, "https://youtube.com", now, now + 60_000).warnings,
    ).toEqual([]);
  });

  it("schedules a precise check for the next warning or the limit", () => {
    const now = at(2026, 10, 3, 12);
    const state = setUsage(stateWith([rule()]), 20 * MIN, "youtube", now);
    expect(nextTrackingBoundary(state, "https://youtube.com", now)).toBe(
      now + 5 * MIN,
    );
    setUsage(state, 29 * MIN, "youtube", now);
    expect(nextTrackingBoundary(state, "https://youtube.com", now)).toBe(
      now + MIN,
    );
  });
});
