import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PYODIDE_ASSETS = [
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'pyodide-lock.json',
  'pyodide.mjs',
  'python_stdlib.zip',
];

const appBase =
  process.env.VITE_BASE ?? (process.env.GITHUB_PAGES === 'true' ? '/code_visualizer/' : '/');

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function copyPyodideAssets() {
  const pyodideDir = dirname(fileURLToPath(import.meta.resolve('pyodide')));

  return viteStaticCopy({
    targets: PYODIDE_ASSETS.map((asset) => ({
      src: join(pyodideDir, asset).replace(/\\/g, '/'),
      dest: 'assets/pyodide',
      rename: { stripBase: true },
    })),
  });
}

export default defineConfig({
  base: appBase,
  optimizeDeps: {
    exclude: ['pyodide'],
    // Force the CodeMirror core into a single pre-bundle so addons (lint,
    // lang-python, …) share one @codemirror/state instance in dev. Without
    // this, a separately-optimized addon inlines its own copy and breaks
    // instanceof checks ("Unrecognized extension value in extension set").
    include: ['@codemirror/state', '@codemirror/view'],
  },
  plugins: [react(), copyPyodideAssets()],
  server: {
    headers: crossOriginIsolationHeaders,
    port: 5173,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
    port: 4173,
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the big vendors out of the app chunk so the editor and
        // framework code cache independently and the size warning clears.
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (id.includes('@codemirror') || id.includes('@lezer') || id.includes('@uiw')) {
            return 'codemirror';
          }
          if (
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/scheduler/')
          ) {
            return 'react';
          }
          if (id.includes('lucide-react')) {
            return 'icons';
          }
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
