import { describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { createDefaultState, migrateState } from "@core/defaults";
import { MemoryStateStore } from "@core/store";
import { blockedCopy, formatCountdown } from "../apps/extension/src/ui/blocked-copy";

describe("block screen countdown", () => {
  it("shows hours, minutes and seconds, and days once it's that far", () => {
    expect(formatCountdown(0)).toBe("0h 00m 00s");
    expect(formatCountdown((2 * 3600 + 5 * 60 + 9) * 1000)).toBe("2h 05m 09s");
    expect(formatCountdown(1500)).toBe("0h 00m 02s"); // never shows 0 while time remains
    expect(formatCountdown((26 * 3600 + 61) * 1000)).toBe("1d 2h 01m 01s");
    expect(formatCountdown(-5000)).toBe("0h 00m 00s");
  });
  it("counts down to the moment the website is back", () => {
    const copy = blockedCopy(
      { status: "blocked", reasons: ["block-window"], nextAccessAt: 5_000_000 },
      "YouTube",
      1_000_000,
    );
    expect(copy.nextAt).toBe(5_000_000);
    expect(blockedCopy({ status: "blocked", reasons: ["site-blocked"] }, "YouTube").nextAt).toBeUndefined();
  });
});

describe("saved state keeps its browser", () => {
  it("doesn't relabel Safari's state as Chrome's when no browser is given", () => {
    const safari = createDefaultState("safari");
    expect(migrateState(JSON.parse(JSON.stringify(safari))).protection.browser).toBe("safari");
    expect(migrateState(safari, "chrome").protection.browser).toBe("chrome");
    expect(migrateState(undefined).protection.browser).toBe("chrome");
  });
});

describe("restore defaults", () => {
  it("erases presets, usage and the password, and asks for the password first", async () => {
    const store = new MemoryStateStore();
    const ctx = { store, now: () => Date.now() };
    await actions.saveWindow(ctx, {
      id: "w", label: "Lunch", enabled: true, domains: ["youtube.com"],
      days: [1], startMinute: 720, endMinute: 780, mode: "allow",
    });
    await actions.setSettingsPassword(ctx, "a test password");
    expect((await actions.resetAll(ctx)).ok).toBe(false); // no password given (e.g. from the app)
    const r = await actions.resetAll({ ...ctx, password: "a test password" });
    expect(r.ok).toBe(true);
    const state = await store.get();
    expect(state.windows).toEqual([]);
    expect(state.settingsPassword).toBeUndefined();
    expect(state.usage).toEqual({});
  });
});

describe("no feed blocking master switch", () => {
  it("turns an old 'off' into every control off, and keeps the switch on from then on", async () => {
    const old = createDefaultState();
    old.feedSettings.sites.youtube.home = true;
    old.feedSettings.globalEnabled = false;
    const migrated = migrateState(JSON.parse(JSON.stringify(old)));
    expect(migrated.feedSettings.globalEnabled).toBe(true);
    expect(migrated.feedSettings.sites.youtube.home).toBe(false);
    const store = new MemoryStateStore();
    const ctx = { store, now: () => Date.now() };
    const r = await actions.setFeeds(ctx, { ...old.feedSettings });
    expect(r.ok && r.data.feedSettings).toMatchObject({ globalEnabled: true });
    expect(r.ok && r.data.feedSettings.sites.youtube.home).toBe(false);
  });
});
