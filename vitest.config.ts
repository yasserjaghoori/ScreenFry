import { defineConfig } from 'vitest/config';
import { alias } from './vite.shared.ts';

// A fixed zone with DST makes midnight/DST tests deterministic on every machine.
process.env.TZ = 'America/New_York';

export default defineConfig({
  resolve: { alias },
  test: { root: import.meta.dirname, include: ['tests/**/*.test.ts'] }
});
