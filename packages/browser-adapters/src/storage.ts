import { createDefaultState } from '@core/defaults';
import type { AppState } from '@shared/index';

const STATE_KEY = 'screentimeState';

export interface StateStore {
  get(): Promise<AppState>;
  set(state: AppState): Promise<void>;
  update(mutator: (state: AppState) => AppState | Promise<AppState>): Promise<AppState>;
}

let updateQueue = Promise.resolve();

export const chromeStateStore: StateStore = {
  async get() {
    const result = await chrome.storage.local.get(STATE_KEY);
    return result[STATE_KEY] ? result[STATE_KEY] as AppState : createDefaultState('chrome');
  },
  async set(state) {
    await chrome.storage.local.set({ [STATE_KEY]: state });
  },
  async update(mutator) {
    let resolved!: AppState;
    updateQueue = updateQueue.then(async () => {
      const current = await chromeStateStore.get();
      resolved = await mutator(structuredClone(current));
      await chromeStateStore.set(resolved);
    });
    await updateQueue;
    return resolved;
  }
};

export class MemoryStateStore implements StateStore {
  constructor(private state: AppState = createDefaultState()) {}
  async get() { return structuredClone(this.state); }
  async set(state: AppState) { this.state = structuredClone(state); }
  async update(mutator: (state: AppState) => AppState | Promise<AppState>) {
    this.state = await mutator(structuredClone(this.state));
    return structuredClone(this.state);
  }
}
