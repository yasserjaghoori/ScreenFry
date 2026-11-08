import { describe, expect, it } from "vitest";
import { createDefaultState, migrateState } from "@core/defaults";
import { MemoryStateStore } from "@core/store";
import { evaluatePolicy } from "@policy/index";
import { at, rule } from "./helpers";
describe("storage and schema migration", () => {
  it("round-trips the new windows and per-site settings", async () => {
    const store = new MemoryStateStore();
    await store.update((s) => ({
      ...s,
      rules: [rule({ blocked: true })],
      windows: [
        {
          id: "w",
          label: "Lunch",
          enabled: true,
          domains: ["youtube.com"],
          days: [1],
          startMinute: 720,
          endMinute: 780,
        },
      ],
    }));
    const reopened = await store.reopen().get();
    expect(reopened.rules[0].blocked).toBe(true);
    expect(reopened.windows[0].label).toBe("Lunch");
  });
  it("adds a default rule for registry websites missing from saved state", () => {
    const saved = createDefaultState();
    saved.rules = saved.rules.filter((r) => r.id !== "substack");
    saved.rules[0].dailyAllowance = { defaultMinutes: 10 };
    const state = migrateState(JSON.parse(JSON.stringify(saved)));
    expect(state.rules.map((r) => r.id)).toContain("substack");
    expect(
      state.rules.find((r) => r.id === "substack")?.dailyAllowance,
    ).toBeUndefined();
    expect(state.rules[0].dailyAllowance).toEqual({ defaultMinutes: 10 });
  });
  it("deletes previously recorded history of other websites on upgrade", () => {
    const state = migrateState({
      schemaVersion: 3,
      trackingEnabled: true,
      usage: {
        "2026-11-03": {
          millisecondsByRule: { youtube: 60_000 },
          millisecondsByHost: { "example.com": 90_000, "youtube.com": 60_000 },
          warningsSent: {},
        },
      },
    });
    expect(JSON.stringify(state)).not.toContain("example.com");
    expect(state).not.toHaveProperty("trackingEnabled");
    expect(state.usage["2026-11-03"].millisecondsByRule.youtube).toBe(60_000);
  });
  it("drops old mandatory PINs, overrides, pending changes and commitments while retaining usage", () => {
    const state = migrateState({
      schemaVersion: 2,
      pin: { verifier: "old" },
      rules: [
        {
          ...rule(),
          commitmentEndsAt: 999,
          pendingChange: { patch: { remove: true } },
          schedules: [],
        },
      ],
      overrides: { youtube: { startedAt: 1, expiresAt: 999 } },
      usage: { "2026-11-03": { millisecondsByRule: { youtube: 123 } } },
      feedSettings: {
        globalEnabled: true,
        sites: { youtube: { shorts: true } },
      },
    });
    expect(state.schemaVersion).toBe(3);
    expect(state.settingsPassword).toBeUndefined();
    for (const key of ["pin", "overrides", "overrideHistory"])
      expect(state).not.toHaveProperty(key);
    expect(state.rules[0]).not.toHaveProperty("commitmentEndsAt");
    expect(state.rules[0]).not.toHaveProperty("pendingChange");
    expect(state.usage["2026-11-03"].millisecondsByRule.youtube).toBe(123);
    expect(state.feedSettings.sites.youtube.shorts).toBe(true);
  });
  it("converts blocked schedules to the complementary allowed windows, not the same times", () => {
    const state = migrateState({
      schemaVersion: 2,
      rules: [
        {
          ...rule(),
          schedules: [
            {
              id: "old",
              days: [1, 2, 3, 4, 5],
              startMinute: 540,
              endMinute: 1020,
            },
          ],
        },
      ],
    });
    expect(
      evaluatePolicy(state, "https://youtube.com", at(2026, 10, 3, 10)).status,
    ).toBe("blocked");
    expect(
      evaluatePolicy(state, "https://youtube.com", at(2026, 10, 3, 18)).status,
    ).toBe("allowed");
    expect(
      evaluatePolicy(state, "https://youtube.com", at(2026, 10, 7, 10)).status,
    ).toBe("allowed");
  });
  it("preserves a legacy all-week full block", () => {
    const state = migrateState({
      schemaVersion: 2,
      rules: [
        {
          ...rule(),
          schedules: [
            {
              id: "old",
              days: [0, 1, 2, 3, 4, 5, 6],
              startMinute: 0,
              endMinute: 0,
            },
          ],
        },
      ],
    });
    expect(state.rules[0].blocked).toBe(true);
    expect(state.windows).toEqual([]);
  });
  it("uses the launch sites and no restrictions for a fresh install", () => {
    const state = createDefaultState();
    expect(state.rules.map((r) => r.id)).toEqual([
      "youtube",
      "instagram",
      "x",
      "reddit",
      "substack",
      "tiktok",
    ]);
    expect(state.settingsPassword).toBeUndefined();
    expect(state.windows).toEqual([]);
    expect(
      Object.values(state.feedSettings.sites)
        .flatMap(Object.values)
        .some(Boolean),
    ).toBe(false);
  });
  it("falls back for missing or corrupt storage and recovers after a failed write", async () => {
    expect(migrateState(undefined)).toEqual(createDefaultState());
    expect(migrateState("bad")).toEqual(createDefaultState());
    const store = new MemoryStateStore();
    await expect(
      store.update(() => {
        throw Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(
      (await store.update((s) => ({ ...s, warningsEnabled: false })))
        .warningsEnabled,
    ).toBe(false);
  });
});
