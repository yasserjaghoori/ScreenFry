import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultState } from "@core/defaults";
import { chromeStateStore, STATE_KEY } from "@browser/storage";

afterEach(() => vi.unstubAllGlobals());

/** Each storage write is broadcast to every content script, so unchanged state must not be written. */
function stubStorage(initial: unknown) {
  const data: Record<string, unknown> = { [STATE_KEY]: initial };
  const set = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(data, JSON.parse(JSON.stringify(items)));
  });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (p: string) => `chrome-extension://id/${p}` },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: data[key] })),
        set,
      },
    },
  });
  return { data, set };
}

describe("state store writes", () => {
  it("skips the write when a mutation leaves the stored state unchanged", async () => {
    const { set } = stubStorage(
      JSON.parse(JSON.stringify(createDefaultState())),
    );
    await chromeStateStore.update((s) => s);
    expect(set).not.toHaveBeenCalled();
  });

  it("writes real changes", async () => {
    const { set, data } = stubStorage(
      JSON.parse(JSON.stringify(createDefaultState())),
    );
    await chromeStateStore.update((s) => ({ ...s, usageAsOf: 123 }));
    expect(set).toHaveBeenCalledOnce();
    expect((data[STATE_KEY] as { usageAsOf: number }).usageAsOf).toBe(123);
  });

  it("still persists a schema migration even when the mutation changes nothing", async () => {
    const { set } = stubStorage({
      schemaVersion: 2,
      rules: [],
      pin: { verifier: "old" },
    });
    await chromeStateStore.update((s) => s);
    expect(set).toHaveBeenCalledOnce();
  });
});
