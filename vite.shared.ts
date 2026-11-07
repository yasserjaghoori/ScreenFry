import { resolve } from 'node:path';

export const alias = {
  '@shared': resolve(import.meta.dirname, 'packages/shared-types/src'),
  '@core': resolve(import.meta.dirname, 'packages/core/src'),
  '@policy': resolve(import.meta.dirname, 'packages/policy-engine/src'),
  '@browser': resolve(import.meta.dirname, 'packages/browser-adapters/src'),
  '@feeds': resolve(import.meta.dirname, 'packages/feed-blockers/src')
};
export const outDir = resolve(import.meta.dirname, 'dist/chrome');
export const extensionRoot = resolve(import.meta.dirname, 'apps/extension');
