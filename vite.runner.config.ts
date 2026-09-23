import { defineConfig, loadEnv } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appOrigin } from './src/runner/protocol';
import { runnerHeaders } from './src/runner/securityHeaders';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const allowed = appOrigin(env.VITE_RUNNER_APP_ORIGIN ?? '');
  const pyodideDir = dirname(fileURLToPath(import.meta.resolve('pyodide')));
  return {
    base: '/',
    publicDir: false,
    define: { 'import.meta.env.VITE_RUNNER_APP_ORIGIN': JSON.stringify(allowed) },
    optimizeDeps: { exclude: ['pyodide'] },
    plugins: [
      viteStaticCopy({
        targets: [
          'pyodide.asm.js',
          'pyodide.asm.wasm',
          'pyodide-lock.json',
          'pyodide.mjs',
          'python_stdlib.zip',
        ].map((asset) => ({
          src: join(pyodideDir, asset),
          dest: 'assets/pyodide',
          rename: { stripBase: true },
        })),
      }),
      {
        name: 'runner-response-policy',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const path = req.url?.split('?')[0];
            for (const [name, value] of Object.entries(
              runnerHeaders(allowed, path === '/runner.html'),
            ))
              res.setHeader(name, value);
            if (path?.startsWith('/api/')) {
              res.statusCode = 404;
              res.end('Not found');
              return;
            }
            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const path = req.url?.split('?')[0];
            for (const [name, value] of Object.entries(
              runnerHeaders(allowed, path === '/runner.html'),
            ))
              res.setHeader(name, value);
            if (path !== '/runner.html' && !path?.startsWith('/assets/')) {
              res.statusCode = 404;
              res.end('Not found');
              return;
            }
            next();
          });
        },
      },
    ],
    server: { port: 5174, strictPort: true },
    preview: { port: 4174, strictPort: true },
    build: { outDir: 'dist-runner', sourcemap: false, rollupOptions: { input: 'runner.html' } },
    worker: { format: 'es' },
  };
});
