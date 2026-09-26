import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Rollup } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import type { ServiceWorkerBuild } from './cachePolicy';
import {
  BUILD_MARKER,
  isPrecached,
  offlineShell,
  readThemeColors,
  serviceWorkerBuild,
  webManifest,
} from './offlineShellPlugin';

const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const colors = readThemeColors(tokens);
const fixtures: string[] = [];

afterAll(() => fixtures.forEach((dir) => rmSync(dir, { force: true, recursive: true })));

function readBuild(workerCode: string): ServiceWorkerBuild {
  const start = workerCode.indexOf(BUILD_MARKER[0]) + BUILD_MARKER[0].length;
  return JSON.parse(workerCode.slice(start, workerCode.indexOf(BUILD_MARKER[1], start)));
}

async function buildFixture(base: string, enabled = true) {
  // Real path: macOS links the temp directory, which would put index.html outside root.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeviz-offline-')));
  fixtures.push(root);
  const files: Record<string, string> = {
    'index.html':
      '<!doctype html><html><head></head><body><script type="module" src="/main.js"></script></body></html>',
    'main.js': "import './style.css';\nimport('./lazy.js').then((m) => m.run());\n",
    'lazy.js': 'export const run = () => document.body.append("ready");\n',
    'style.css': 'body { color: red; }\n',
    'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'public/icons/icon-192.png': 'png',
    'public/icons/icon-512.png': 'png',
    'public/icons/icon-maskable-512.png': 'png',
    'public/icons/apple-touch-icon.png': 'png',
  };
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), contents);
  }
  const result = (await build({
    base,
    build: { sourcemap: true, write: false },
    configFile: false,
    logLevel: 'silent',
    plugins: [offlineShell({ enabled, pyodideVersion: '0.29.4', themeColors: colors })],
    root,
  })) as Rollup.RollupOutput;
  const output = new Map(result.output.map((file) => [file.fileName, file]));
  const text = (name: string) => {
    const file = output.get(name);
    if (!file) throw new Error(`missing ${name}`);
    return file.type === 'chunk' ? file.code : String(file.source);
  };
  return { output, text };
}

describe('offline shell build output', () => {
  it('writes a manifest under the base path and links it from index.html', async () => {
    const { text } = await buildFixture('/code_visualizer/');
    const manifest = JSON.parse(text('manifest.webmanifest'));
    expect(manifest).toMatchObject({
      start_url: '/code_visualizer/app',
      scope: '/code_visualizer/',
      display: 'standalone',
      theme_color: '#0e1117',
      background_color: '#0e1117',
    });
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toContain(
      '/code_visualizer/icons/icon-maskable-512.png',
    );
    expect(text('index.html')).toContain(
      '<link rel="manifest" href="/code_visualizer/manifest.webmanifest">',
    );
  }, 30_000);

  it('emits a self-contained sw.js with the precache list and version injected', async () => {
    const { output, text } = await buildFixture('/');
    const worker = text('sw.js');
    expect(worker).not.toContain('__CODEVIZ_SW_BUILD__');
    expect(worker).not.toMatch(/^\s*(import|export)\b/m);
    const injected = readBuild(worker);
    expect(injected.enabled).toBe(true);
    expect(injected.version).toMatch(/^[0-9a-f]{12}$/);
    expect(injected.pyodideVersion).toBe('0.29.4');
    const entry = [...output.values()].find(
      (file) => file.type === 'chunk' && file.isEntry && file.fileName !== 'sw.js',
    );
    expect(injected.shellEntry).toBe(entry?.fileName);
    expect(injected.precache).toEqual(
      expect.arrayContaining([
        './',
        'manifest.webmanifest',
        'favicon.svg',
        'icons/icon-192.png',
        injected.shellEntry,
      ]),
    );
    // The lazily imported chunk and the stylesheet are part of the shell.
    const assets = injected.precache.filter((path) => path.startsWith('assets/'));
    expect(assets.some((path) => path.startsWith('assets/lazy-'))).toBe(true);
    expect(assets.some((path) => path.endsWith('.css'))).toBe(true);
    expect(injected.precache.some((path) => path.endsWith('.map') || path === 'sw.js')).toBe(false);
  }, 30_000);

  it('serves cached files offline even when the host varies responses by Origin', async () => {
    const { text } = await buildFixture('/');
    const scope = 'https://example.test/';
    // Like the Cache API: an entry stored for a request without an Origin header
    // only matches an Origin-carrying request when Vary is ignored.
    const stored = new Map<string, { origin: string | null; body: string }>();
    const cache = {
      match: async (request: Request | string, options?: CacheQueryOptions) => {
        const url = typeof request === 'string' ? request : request.url;
        const origin = typeof request === 'string' ? null : request.headers.get('Origin');
        const entry = stored.get(url);
        if (!entry || (!options?.ignoreVary && entry.origin !== origin)) return undefined;
        return new Response(entry.body, { headers: { Vary: 'Origin' } });
      },
    };
    stored.set(`${scope}assets/app.js`, { origin: null, body: 'cached app' });
    const listeners = new Map<string, (event: unknown) => void>();
    runInNewContext(text('sw.js'), {
      self: {
        registration: { scope },
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
      },
      caches: { match: cache.match, open: async () => cache, keys: async () => [] },
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      Request,
      Response,
      URL,
    });
    let responded: Promise<Response> | undefined;
    listeners.get('fetch')!({
      request: new Request(`${scope}assets/app.js`, { headers: { Origin: scope.slice(0, -1) } }),
      respondWith: (response: Promise<Response>) => (responded = response),
      waitUntil: () => undefined,
    });
    expect(await (await responded!).text()).toBe('cached app');
  }, 30_000);

  it('builds a worker that only removes itself when disabled', async () => {
    const { text } = await buildFixture('/', false);
    const injected = readBuild(text('sw.js'));
    expect(injected).toMatchObject({ enabled: false, precache: [] });
    // The worker script evaluates without a module loader.
    const listeners: string[] = [];
    runInNewContext(text('sw.js'), {
      self: {
        registration: { scope: 'https://example.test/' },
        addEventListener: (type: string) => listeners.push(type),
      },
      URL,
    });
    expect(listeners).toEqual(['install', 'activate']);
  }, 30_000);
});

describe('offline shell helpers', () => {
  it('reads the theme colours from the tokens that index.html also uses', () => {
    expect(colors).toEqual({ dark: '#0e1117', light: '#f3f5f8' });
    expect(indexHtml).toContain(
      `<meta name="theme-color" content="${colors.dark}" media="(prefers-color-scheme: dark)" />`,
    );
    expect(indexHtml).toContain(
      `<meta name="theme-color" content="${colors.light}" media="(prefers-color-scheme: light)" />`,
    );
    expect(indexHtml).toContain('rel="apple-touch-icon"');
  });

  it('keeps start_url, scope and icons on the root deployment', () => {
    const manifest = webManifest('/', colors);
    expect(manifest.start_url).toBe('/app');
    expect(manifest.scope).toBe('/');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(manifest.icons.some((icon) => 'purpose' in icon && icon.purpose === 'maskable')).toBe(
      true,
    );
  });

  it('precaches scripts, styles and Latin fonts but not Pyodide or source maps', () => {
    expect(isPrecached('assets/codemirror-DyDyK6ae.js')).toBe(true);
    expect(isPrecached('assets/pyodideWorker-M52flDbU.js')).toBe(true);
    expect(isPrecached('assets/index-A6GHsXOQ.css')).toBe(true);
    expect(isPrecached('assets/inter-latin-400-normal-C38fXH4l.woff2')).toBe(true);
    expect(isPrecached('assets/inter-latin-ext-400-normal-C1nco2VV.woff2')).toBe(true);
    expect(isPrecached('assets/inter-cyrillic-400-normal-abc.woff2')).toBe(false);
    expect(isPrecached('assets/inter-latin-400-normal-C38fXH4l.woff')).toBe(false);
    expect(isPrecached('assets/pyodide/pyodide.asm.js')).toBe(false);
    expect(isPrecached('assets/pyodide/pyodide.asm.wasm')).toBe(false);
    expect(isPrecached('assets/App-C1A6QBAy.js.map')).toBe(false);
    expect(isPrecached('sw.js')).toBe(false);
  });

  it('changes the cache version whenever a precached file changes', () => {
    const options = {
      enabled: true,
      pyodideVersion: '0.29.4',
      shellEntry: 'assets/index-A.js',
      workerSource: 'worker',
    };
    const files = [
      { fileName: 'index.html', contents: '<script src="/assets/index-A.js"></script>' },
      { fileName: 'assets/index-A.js', contents: 'one' },
      { fileName: 'assets/pyodide/pyodide.asm.wasm', contents: 'wasm' },
    ];
    const first = serviceWorkerBuild({ ...options, files });
    expect(first.precache).toEqual(['assets/index-A.js', './']);
    expect(serviceWorkerBuild({ ...options, files }).version).toBe(first.version);
    const edited = files.map((file) =>
      file.fileName === 'index.html' ? { ...file, contents: `${file.contents}\n` } : file,
    );
    expect(serviceWorkerBuild({ ...options, files: edited }).version).not.toBe(first.version);
    // The Pyodide runtime has its own cache, so it does not version the shell.
    const newRuntime = files.map((file) =>
      file.fileName.endsWith('.wasm') ? { ...file, contents: 'new wasm' } : file,
    );
    expect(serviceWorkerBuild({ ...options, files: newRuntime }).version).toBe(first.version);
  });
});
