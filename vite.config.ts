import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, 'apps/extension');

export default defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'packages/shared-types/src'),
      '@core': resolve(import.meta.dirname, 'packages/core/src'),
      '@policy': resolve(import.meta.dirname, 'packages/policy-engine/src'),
      '@browser': resolve(import.meta.dirname, 'packages/browser-adapters/src'),
      '@feeds': resolve(import.meta.dirname, 'packages/feed-blockers/src')
    }
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/chrome'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: resolve(root, 'dashboard.html'),
        popup: resolve(root, 'popup.html'),
        onboarding: resolve(root, 'onboarding.html'),
        blocked: resolve(root, 'blocked.html'),
        background: resolve(root, 'src/background/index.ts'),
        content: resolve(root, 'src/content-scripts/index.ts')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
