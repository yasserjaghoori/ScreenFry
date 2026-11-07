import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { alias, extensionRoot as root, outDir } from './vite.shared.ts';

// Single self-contained classic script for the manifest content_scripts entry.
export default defineConfig({
  root,
  publicDir: false,
  resolve: { alias },
  build: {
    outDir,
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: resolve(root, 'src/content-scripts/index.ts'),
      formats: ['iife'],
      name: 'ScreentimeContent',
      fileName: () => 'assets/content.js'
    }
  }
});
