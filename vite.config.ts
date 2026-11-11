import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { alias, extensionRoot as root, outDir } from './vite.shared.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Pages and the service worker (ES modules). The content script is built separately
// by vite.content.config.ts because manifest content scripts cannot use `import`.
export default defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  plugins: [react()],
  resolve: { alias },
  // The version this code was built as, so the background can tell when Chrome runs older
  // code than its manifest says (it kept a stale service worker after an update).
  define: { __CODE_VERSION__: JSON.stringify(version) },
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
