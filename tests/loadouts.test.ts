import { describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { migrateState } from "@core/defaults";
import { MemoryStateStore } from "@core/store";
import { encodeShareCode } from "@core/share";

const ctxFor = () => {
  const store = new MemoryStateStore();
  return { store, ctx: { store, now: () => Date.now() } };
};
const youtube = (blocked: boolean) => ({
  id: "youtube", label: "YouTube", domains: ["youtube.com"], enabled: true, blocked, showTimer: false, createdAt: 0, updatedAt: 0,
});

describe("loadouts", () => {
  it("start with only the one in use; switching saves it and applies the other", async () => {
    const { store, ctx } = ctxFor();
    const state = await store.get();
    expect(actions.loadoutSettings(state, 0, 1)).not.toBeNull();
    expect(actions.loadoutSettings(state, 1, 1)).toBeNull();
    expect((await actions.switchLoadout(ctx, 1)).ok).toBe(false); // empty

    await actions.saveRule(ctx, youtube(true));
    const strict = actions.exportSettings(await store.get(), 1);
    // Loadout 2 gets a relaxed setup from a code, without switching.
    const relaxed = { ...strict, rules: strict.rules.map((r) => (r.id === "youtube" ? { ...r, blocked: false } : r)) };
    const r = await actions.setLoadoutFromCode(ctx, 1, await encodeShareCode(relaxed));
    expect(r.ok).toBe(true);
    let s = await store.get();
    expect(s.rules.find((r) => r.id === "youtube")?.blocked).toBe(true); // still loadout 1

    expect((await actions.switchLoadout(ctx, 1)).ok).toBe(true);
    s = await store.get();
    expect(s.activeLoadout).toBe(1);
    expect(s.rules.find((r) => r.id === "youtube")?.blocked).toBe(false);
    expect(s.loadouts?.[1]).toBeNull();
    expect(s.loadouts?.[0]?.rules.find((r) => r.id === "youtube")?.blocked).toBe(true);

    // Back again, through a migration round trip.
    await store.update((x) => migrateState(JSON.parse(JSON.stringify(x))));
    expect((await actions.switchLoadout(ctx, 0)).ok).toBe(true);
    expect((await store.get()).rules.find((r) => r.id === "youtube")?.blocked).toBe(true);
  });
  it("can't empty the one in use; copy, clear and reset work and follow the password", async () => {
    const { store, ctx } = ctxFor();
    expect((await actions.clearLoadout(ctx, 0)).ok).toBe(false);
    expect((await actions.copyToLoadout(ctx, 3)).ok).toBe(true);
    expect((await store.get()).loadouts?.[3]).toBeTruthy();
    expect((await actions.clearLoadout(ctx, 3)).ok).toBe(true);
    expect((await store.get()).loadouts?.[3] ?? null).toBeNull();
    await actions.copyToLoadout(ctx, 2);
    await actions.setSettingsPassword(ctx, "a test password");
    expect((await actions.switchLoadout(ctx, 2)).ok).toBe(false);
    expect((await actions.copyToLoadout(ctx, 4)).ok).toBe(false);
    const reset = await actions.resetAll({ ...ctx, password: "a test password" });
    expect(reset.ok && reset.data.loadouts).toBeUndefined();
    expect(reset.ok && reset.data.activeLoadout).toBeUndefined();
  });
});
