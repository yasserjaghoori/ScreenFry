import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { alias, extensionRoot as root, outDir } from './vite.shared.ts';

// Pages and the service worker (ES modules). The content script is built separately
// by vite.content.config.ts because manifest content scripts cannot use `import`.
export default defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  plugins: [react()],
  resolve: { alias },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        dashboard: resolve(root, 'dashboard.html'),
        popup: resolve(root, 'popup.html'),
        onboarding: resolve(root, 'onboarding.html'),
        blocked: resolve(root, 'blocked.html'),
        background: resolve(root, 'src/background/index.ts')
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
