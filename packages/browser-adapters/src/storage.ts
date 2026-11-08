import { migrateState } from "@core/defaults";
import type { StateStore } from "@core/store";
import type { AppState } from "@shared/index";
import { detectBrowser } from "./platform";

export const STATE_KEY = "screentimeState";

let updateQueue: Promise<unknown> = Promise.resolve();

export async function readState(): Promise<AppState> {
  const result = await chrome.storage.local.get(STATE_KEY);
  return migrateState(result[STATE_KEY], detectBrowser());
}

/**
 * chrome.storage.local-backed store. Updates are serialized inside this context so concurrent
 * messages cannot overwrite each other, and a failed mutation never poisons later updates.
 */
export const chromeStateStore: StateStore = {
  get: readState,
  update(mutator) {
    const run = updateQueue.then(async () => {
      const raw = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
      // Compare with what is stored (not the migrated copy) so migrations still persist.
      const before = JSON.stringify(raw);
      const next = await mutator(migrateState(raw, detectBrowser()));
      // Every write is broadcast to every content script in every tab, so skip no-op writes.
      if (JSON.stringify(next) !== before)
        await chrome.storage.local.set({ [STATE_KEY]: next });
      return next;
    });
    updateQueue = run.catch(() => undefined);
    return run;
  },
};
