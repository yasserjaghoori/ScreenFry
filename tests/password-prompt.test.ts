import { describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { migrateState } from "@core/defaults";

describe("first-change password prompt", () => {
  it("is remembered once shown, survives migration, and stays out of exports", async () => {
    const store = new MemoryStateStore();
    const ctx = { store, now: () => Date.now() };
    expect((await store.get()).passwordPromptSeen).toBeUndefined();
    const r = await actions.markPasswordPromptSeen(ctx);
    expect(r.ok && r.data.passwordPromptSeen).toBe(true);
    const saved = JSON.parse(JSON.stringify(await store.get()));
    expect(migrateState(saved).passwordPromptSeen).toBe(true);
    expect(migrateState({ ...saved, passwordPromptSeen: "yes" }).passwordPromptSeen).toBeUndefined();
    expect(JSON.stringify(actions.exportSettings(await store.get(), Date.now()))).not.toContain(
      "passwordPromptSeen",
    );
  });
});
