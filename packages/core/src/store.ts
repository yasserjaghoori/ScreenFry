import { createDefaultState, migrateState } from './defaults';
import type { AppState } from '@shared/index';

export interface StateStore {
  get(): Promise<AppState>;
  update(mutator: (state: AppState) => AppState | Promise<AppState>): Promise<AppState>;
}

/** In-memory store used by tests. It serializes through JSON to mimic extension storage. */
export class MemoryStateStore implements StateStore {
  private raw: string;
  constructor(state: AppState = createDefaultState()) { this.raw = JSON.stringify(state); }
  async get() { return migrateState(JSON.parse(this.raw)); }
  async update(mutator: (state: AppState) => AppState | Promise<AppState>) {
    const next = await mutator(await this.get());
    this.raw = JSON.stringify(next);
    return this.get();
  }
  /** Simulates a browser restart: a fresh store reading the same persisted bytes. */
  reopen(): MemoryStateStore {
    const copy = new MemoryStateStore();
    copy.raw = this.raw;
    return copy;
  }
}
