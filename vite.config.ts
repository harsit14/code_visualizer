import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { runnerUrl } from './src/runner/protocol';
import { offlineShell, readThemeColors } from './src/offline/offlineShellPlugin';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { dirname, join, resolve } from 'node:path';
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
// GitHub Pages serves files only: no account, history or AI API.
const staticHost =
  process.env.VITE_STATIC_HOST ?? (process.env.GITHUB_PAGES === 'true' ? 'true' : 'false');

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

const pyodideDir = dirname(fileURLToPath(import.meta.resolve('pyodide')));

function copyPyodideAssets() {
  return viteStaticCopy({
    targets: PYODIDE_ASSETS.map((asset) => ({
      src: join(pyodideDir, asset).replace(/\\/g, '/'),
      dest: 'assets/pyodide',
      rename: { stripBase: true },
    })),
  });
}

let buildOutDir = 'dist';

export default defineConfig(({ mode }) => {
  const configured = process.env.VITE_RUNNER_URL ?? loadEnv(mode, process.cwd()).VITE_RUNNER_URL;
  const runnerOrigin = configured ? runnerUrl(configured).origin : null;
  // VITE_SERVICE_WORKER=false ships a worker that removes itself; see docs/deployment.md.
  const serviceWorker =
    (process.env.VITE_SERVICE_WORKER ?? loadEnv(mode, process.cwd()).VITE_SERVICE_WORKER) !==
    'false';
  return {
    base: appBase,
    define: {
      'import.meta.env.VITE_STATIC_HOST': JSON.stringify(staticHost),
      'import.meta.env.VITE_SERVICE_WORKER': JSON.stringify(String(serviceWorker)),
    },
    optimizeDeps: {
      exclude: ['pyodide'],
      // Force the CodeMirror core into a single pre-bundle so addons (lint,
      // lang-python, …) share one @codemirror/state instance in dev. Without
      // this, a separately-optimized addon inlines its own copy and breaks
      // instanceof checks ("Unrecognized extension value in extension set").
      include: ['@codemirror/state', '@codemirror/view'],
    },
    plugins: [
      react(),
      copyPyodideAssets(),
      offlineShell({
        enabled: serviceWorker,
        pyodideVersion: JSON.parse(readFileSync(join(pyodideDir, 'package.json'), 'utf8')).version,
        themeColors: readThemeColors(readFileSync('src/styles/tokens.css', 'utf8')),
      }),
      {
        // Static hosts answer unknown paths with 404.html; serving the app there
        // makes deep links such as /code_visualizer/app survive a reload.
        name: 'spa-fallback',
        configResolved(config) {
          buildOutDir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
          if (appBase === '/') return;
          writeFileSync(
            join(buildOutDir, '404.html'),
            readFileSync(join(buildOutDir, 'index.html')),
          );
        },
      },
      {
        name: 'runner-frame-policy',
        closeBundle() {
          if (!runnerOrigin) return;
          const path = join(process.cwd(), 'dist/_headers');
          const text = readFileSync(path, 'utf8').replace(
            /(Content-Security-Policy:[^\n]+)/,
            `$1; frame-src ${runnerOrigin}`,
          );
          writeFileSync(path, text);
        },
      },
    ],
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
            // The JavaScript/TypeScript grammar loads on demand for JS/TS sessions.
            if (id.includes('@codemirror/lang-javascript') || id.includes('@lezer/javascript')) {
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
  };
});
