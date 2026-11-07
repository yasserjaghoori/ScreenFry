import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'packages/shared-types/src'),
      '@core': resolve(import.meta.dirname, 'packages/core/src'),
      '@policy': resolve(import.meta.dirname, 'packages/policy-engine/src'),
      '@browser': resolve(import.meta.dirname, 'packages/browser-adapters/src'),
      '@feeds': resolve(import.meta.dirname, 'packages/feed-blockers/src')
    }
  },
  test: { root: import.meta.dirname }
});
