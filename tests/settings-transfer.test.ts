import { beforeEach, describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { Clock, at, rule } from "./helpers";
import type { AccessWindow } from "@shared/index";
let clock: Clock, store: MemoryStateStore, ctx: actions.ActionContext;
const lunch: AccessWindow = {
  id: "lunch",
  label: "Lunch",
  enabled: true,
  domains: ["youtube.com"],
  days: [1, 2, 3],
  startMinute: 720,
  endMinute: 780,
  mode: "allow",
};
beforeEach(() => {
  clock = new Clock(at(2026, 10, 3, 12));
  store = new MemoryStateStore();
  ctx = { store, now: clock.now };
});
describe("settings export and import", () => {
  it("exports website settings without usage or the password", async () => {
    await actions.saveRule(ctx, rule({ dailyAllowance: { defaultMinutes: 45 } }));
    await actions.setSettingsPassword(ctx, "a test password");
    const exported = actions.exportSettings(await store.get(), clock.now());
    expect(exported.format).toBe("screenfry-settings-v1");
    expect(Object.keys(exported).sort()).toEqual(
      ["exportedAt", "feedSettings", "format", "rules", "warningsEnabled", "windows"],
    );
    expect(JSON.stringify(exported)).not.toContain("PBKDF2");
  });
  it("round-trips settings into another browser's state", async () => {
    await actions.saveRule(ctx, rule({ dailyAllowance: { defaultMinutes: 45 } }));
    await actions.saveWindow(ctx, lunch);
    await actions.setPreferences(ctx, { warningsEnabled: false });
    const file = JSON.parse(
      JSON.stringify(actions.exportSettings(await store.get(), clock.now())),
    );
    const other = new MemoryStateStore();
    const result = await actions.importSettings({ store: other, now: clock.now }, file);
    expect(result.ok).toBe(true);
    const s = await other.get();
    expect(s.rules.find((r) => r.id === "youtube")?.dailyAllowance?.defaultMinutes).toBe(45);
    expect(s.windows).toEqual(file.windows);
    expect(s.windows.map((w) => w.id)).toEqual(["lunch"]);
    expect(s.warningsEnabled).toBe(false);
  });
  it("rejects files that aren't ScreenFry settings or contain invalid entries", async () => {
    expect((await actions.importSettings(ctx, { hello: 1 })).ok).toBe(false);
    const bad = actions.exportSettings(await store.get(), clock.now());
    const r = await actions.importSettings(ctx, {
      ...bad,
      rules: [rule({ domains: ["not a domain"] })],
    });
    expect(r.ok).toBe(false);
    const dup = await actions.importSettings(ctx, {
      ...bad,
      rules: [rule(), rule({ id: "other" })],
    });
    expect(dup.ok).toBe(false);
  });
  it("refuses an import while a settings password is set and not entered", async () => {
    const file = actions.exportSettings(await store.get(), clock.now());
    await actions.setSettingsPassword(ctx, "a test password");
    expect((await actions.importSettings(ctx, { ...file, rules: [] })).ok).toBe(false);
    expect(
      (
        await actions.importSettings(
          { ...ctx, password: "a test password" },
          { ...file, warningsEnabled: false },
        )
      ).ok,
    ).toBe(true);
  });
});
