import { beforeEach, describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { createDefaultState } from "@core/defaults";
import { localDateKey } from "@core/date";
import { verifyPassword } from "@core/password";
import { Clock, MIN, at, rule, setUsage } from "./helpers";
import type { AccessWindow } from "@shared/index";
let clock: Clock, store: MemoryStateStore, ctx: actions.ActionContext;
const secret = "a test password";
const window = (): AccessWindow => ({
  id: "lunch",
  label: "Lunch",
  enabled: true,
  domains: ["youtube.com"],
  days: [1, 2, 3],
  startMinute: 720,
  endMinute: 780,
});
beforeEach(() => {
  clock = new Clock(at(2026, 10, 3, 12));
  store = new MemoryStateStore();
  ctx = { store, now: clock.now };
});
describe("no mandatory PIN or commitment", () => {
  it("completes onboarding and saves restrictions without any password", async () => {
    expect((await actions.completeOnboarding(ctx)).ok).toBe(true);
    expect((await actions.saveRule(ctx, rule())).ok).toBe(true);
    expect((await store.get()).settingsPassword).toBeUndefined();
  });
  it("applies changes immediately, never queues them behind old commitments", async () => {
    await actions.saveRule(ctx, rule());
    expect(
      (
        await actions.saveRule(
          ctx,
          rule({ dailyAllowance: { defaultMinutes: 90 } }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await store.get()).rules.find((r) => r.id === "youtube")?.dailyAllowance
        ?.defaultMinutes,
    ).toBe(90);
    expect((await actions.deleteRule(ctx, "youtube")).ok).toBe(true);
    // A launch site always has a rule; removing its limits leaves it unrestricted.
    const youtube = (await store.get()).rules.find((r) => r.id === "youtube");
    expect(youtube?.dailyAllowance).toBeUndefined();
    expect(youtube?.blocked).toBe(false);
  });
});
describe("optional settings password", () => {
  beforeEach(async () => {
    expect((await actions.setSettingsPassword(ctx, secret)).ok).toBe(true);
  });
  it("stores a salted verifier and excludes it from exported data", async () => {
    const s = await store.get();
    expect(JSON.stringify(s)).not.toContain(secret);
    expect(s.settingsPassword?.algorithm).toBe("PBKDF2-SHA-256");
    expect(await verifyPassword(secret, s.settingsPassword!)).toBe(true);
    expect(actions.exportData(s)).not.toHaveProperty("settingsPassword");
  });
  it.each([
    "rule",
    "delete-rule",
    "window",
    "delete-window",
    "feeds",
    "preferences",
    "reset",
    "password",
  ] as const)(
    "protects %s mutations in the core, independently of the UI",
    async (kind) => {
      const before = await store.get();
      const calls = {
        rule: () => actions.saveRule(ctx, rule()),
        "delete-rule": () => actions.deleteRule(ctx, "youtube"),
        window: () => actions.saveWindow(ctx, window()),
        "delete-window": () => actions.deleteWindow(ctx, "lunch"),
        feeds: () =>
          actions.setFeeds(ctx, {
            ...before.feedSettings,
            globalEnabled: false,
          }),
        preferences: () =>
          actions.setPreferences(ctx, { warningsEnabled: false }),
        reset: () => actions.resetAll(ctx),
        password: () => actions.setSettingsPassword(ctx, "replacement"),
      };
      expect((await calls[kind]()).ok).toBe(false);
      expect(await store.get()).toEqual(before);
      expect(
        (await actions.unlockSettings({ ...ctx, password: secret })).ok,
      ).toBe(true);
    },
  );
  it("allows changes with the right password and cannot be overwritten with a wrong one", async () => {
    expect(
      (
        await actions.setSettingsPassword(
          { ...ctx, password: "wrong" },
          "replacement",
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await actions.saveRule(
          { ...ctx, password: secret },
          rule({ blocked: true }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await actions.setSettingsPassword(
          { ...ctx, password: secret },
          "replacement",
        )
      ).ok,
    ).toBe(true);
    expect(
      (await actions.unlockSettings({ ...ctx, password: secret })).ok,
    ).toBe(false);
    expect(
      (await actions.unlockSettings({ ...ctx, password: "replacement" })).ok,
    ).toBe(true);
  });
  it("can be removed after authentication, restoring freely editable settings", async () => {
    expect(
      (await actions.setSettingsPassword({ ...ctx, password: secret }, "")).ok,
    ).toBe(true);
    expect((await store.get()).settingsPassword).toBeUndefined();
    expect((await actions.saveWindow(ctx, window())).ok).toBe(true);
  });
  it("keeps protection after a restart, and rate-limits wrong passwords", async () => {
    ctx = { store: store.reopen(), now: clock.now, password: "wrong" };
    for (let i = 0; i < 3; i++)
      expect((await actions.unlockSettings(ctx)).ok).toBe(false);
    expect(
      (await actions.unlockSettings({ ...ctx, password: secret })).ok,
    ).toBe(false);
    clock.advance(30_000);
    expect(
      (await actions.unlockSettings({ ...ctx, password: secret })).ok,
    ).toBe(true);
    expect((await ctx.store.get()).passwordAttempts.failedAttempts).toBe(0);
  });
});
describe("validation and persistence", () => {
  it("rejects invalid password lengths", async () => {
    expect((await actions.setSettingsPassword(ctx, "abc")).ok).toBe(false);
    expect((await actions.setSettingsPassword(ctx, "x".repeat(129))).ok).toBe(
      false,
    );
  });
  it("validates domains, minutes and weekday allowances", async () => {
    for (const bad of [
      rule({ domains: ["not a host"] }),
      rule({ dailyAllowance: { defaultMinutes: -1 } }),
      rule({ dailyAllowance: { defaultMinutes: 1.5 } }),
    ])
      expect((await actions.saveRule(ctx, bad)).ok).toBe(false);
    expect(
      (
        await actions.saveRule(
          ctx,
          rule({ domains: ["https://www.youtube.com/watch?v=x"] }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await store.get()).rules.find((r) => r.id === "youtube")?.domains,
    ).toContain("youtu.be");
  });
  it("validates window days, website whitelist and clock times", async () => {
    for (const patch of [
      { domains: [] },
      { days: [] },
      { days: [7] },
      { startMinute: -1 },
      { startMinute: 1440 },
      { endMinute: 1441 },
    ])
      expect(
        (
          await actions.saveWindow(ctx, {
            ...window(),
            ...patch,
          } as AccessWindow)
        ).ok,
      ).toBe(false);
    expect(
      (
        await actions.saveWindow(ctx, {
          ...window(),
          startMinute: 0,
          endMinute: 1440,
        })
      ).ok,
    ).toBe(true);
    expect((await store.reopen().get()).windows[0].domains).toContain(
      "youtu.be",
    );
  });
  it("retains counted time after allowance edits", async () => {
    await actions.saveRule(ctx, rule());
    await store.update((s) => setUsage(s, 12 * MIN, "youtube", clock.value));
    await actions.saveRule(
      ctx,
      rule({ dailyAllowance: { defaultMinutes: 15 } }),
    );
    expect(
      (await store.get()).usage[localDateKey(new Date(clock.value))]
        .millisecondsByRule.youtube,
    ).toBe(12 * MIN);
  });
  it("resets without a password when optional protection is off", async () => {
    await actions.saveWindow(ctx, window());
    expect((await actions.resetAll(ctx)).ok).toBe(true);
    expect((await store.get()).windows).toEqual(createDefaultState().windows);
  });
});
