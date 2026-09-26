/**
 * Build step for the installable offline shell. Writes manifest.webmanifest and
 * links it from index.html, then emits sw.js with this build's precache list
 * and cache version injected, so every deploy gets a fresh, versioned cache.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { SHELL_PATH, type ServiceWorkerBuild } from './cachePolicy';

export const SERVICE_WORKER_FILE = 'sw.js';
export const MANIFEST_FILE = 'manifest.webmanifest';
/** Wraps the injected JSON so the smoke check can read it back. */
export const BUILD_MARKER = ['/*codeviz-sw-build*/', '/*end-codeviz-sw-build*/'] as const;
const BUILD_PLACEHOLDER = '__CODEVIZ_SW_BUILD__';
const SERVICE_WORKER_SOURCE = fileURLToPath(new URL('./serviceWorker.ts', import.meta.url));

export const MANIFEST_ICONS = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];
const PUBLIC_SHELL_FILES = [
  'favicon.svg',
  'icons/apple-touch-icon.png',
  ...MANIFEST_ICONS.map((icon) => icon.src),
];

export type ThemeColors = { dark: string; light: string };
export type BuildFile = { fileName: string; contents: string | Uint8Array };

function tokenColor(css: string, selector: string, token: string) {
  const start = css.indexOf(selector);
  const block = start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  const color = block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{3,8})\\b`, 'i'))?.[1];
  if (!color) throw new Error(`tokens.css has no ${token} colour for ${selector}`);
  return color.toLowerCase();
}

/** Page background colours from src/styles/tokens.css, dark being the default theme. */
export function readThemeColors(tokensCss: string): ThemeColors {
  return {
    dark: tokenColor(tokensCss, ":root[data-theme='dark']", '--bg'),
    light: tokenColor(tokensCss, ":root[data-theme='light']", '--bg'),
  };
}

export function webManifest(base: string, colors: ThemeColors) {
  const startUrl = `${base}app`;
  return {
    id: startUrl,
    name: 'Code Visualizer',
    short_name: 'Code Visualizer',
    description:
      'See Python, JavaScript, and TypeScript run line by line with replayable traces and lessons.',
    start_url: startUrl,
    scope: base,
    display: 'standalone',
    background_color: colors.dark,
    theme_color: colors.dark,
    categories: ['education', 'developer'],
    icons: [
      ...MANIFEST_ICONS.map((icon) => ({ ...icon, src: `${base}${icon.src}` })),
      { src: `${base}favicon.svg`, sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}

/**
 * Build outputs installed with the shell: every script and stylesheet, so the
 * dashboard, workers and lessons load offline, plus Latin font subsets. Other
 * font subsets are cached the first time the browser asks for them; Pyodide is
 * cached on first use in its own cache.
 */
export function isPrecached(fileName: string) {
  if (fileName === SERVICE_WORKER_FILE || fileName.endsWith('.map')) return false;
  if (fileName.startsWith('assets/pyodide/')) return false;
  if (/\.(js|css)$/.test(fileName)) return true;
  return fileName.endsWith('.woff2') && /-latin(-ext)?-\d+-/.test(fileName);
}

export function serviceWorkerBuild(options: {
  enabled: boolean;
  files: readonly BuildFile[];
  pyodideVersion: string;
  shellEntry: string;
  workerSource: string;
}): ServiceWorkerBuild {
  const shellFiles = options.enabled
    ? options.files
        .filter(
          (file) =>
            file.fileName === 'index.html' ||
            file.fileName === MANIFEST_FILE ||
            PUBLIC_SHELL_FILES.includes(file.fileName) ||
            isPrecached(file.fileName),
        )
        .sort((a, b) => a.fileName.localeCompare(b.fileName))
    : [];
  const hash = createHash('sha256').update(options.workerSource);
  for (const file of shellFiles) hash.update(`\0${file.fileName}\0`).update(file.contents);
  hash.update(`\0${options.pyodideVersion}\0${options.enabled}`);
  return {
    enabled: options.enabled,
    version: hash.digest('hex').slice(0, 12),
    pyodideVersion: options.pyodideVersion,
    // index.html is stored under the scope URL, which is what hosts serve for it.
    precache: shellFiles.map((file) =>
      file.fileName === 'index.html' ? SHELL_PATH : file.fileName,
    ),
    shellEntry: options.shellEntry,
  };
}

export function injectBuild(workerCode: string, build: ServiceWorkerBuild) {
  if (!workerCode.includes(BUILD_PLACEHOLDER)) {
    throw new Error(`${SERVICE_WORKER_FILE} lost its ${BUILD_PLACEHOLDER} placeholder`);
  }
  return workerCode
    .split(BUILD_PLACEHOLDER)
    .join(`${BUILD_MARKER[0]}${JSON.stringify(build)}${BUILD_MARKER[1]}`);
}

export type OfflineShellOptions = {
  /** False emits a worker that unregisters itself and deletes its caches. */
  enabled: boolean;
  pyodideVersion: string;
  themeColors: ThemeColors;
};

export function offlineShell(options: OfflineShellOptions): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: SERVICE_WORKER_SOURCE, fileName: SERVICE_WORKER_FILE });
    },
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          attrs: { rel: 'manifest', href: `${config.base}${MANIFEST_FILE}` },
          injectTo: 'head',
        },
      ];
    },
    generateBundle: {
      order: 'post',
      handler(_output, bundle) {
        const worker = bundle[SERVICE_WORKER_FILE];
        if (worker?.type !== 'chunk') this.error(`${SERVICE_WORKER_FILE} was not built`);
        if (worker.imports.length > 0 || worker.dynamicImports.length > 0) {
          this.error(`${SERVICE_WORKER_FILE} must be self-contained; it imports shared chunks`);
        }
        const entry = Object.values(bundle).find(
          (file) => file.type === 'chunk' && file.isEntry && file.facadeModuleId?.endsWith('.html'),
        );
        if (!entry || !bundle['index.html']) {
          this.error('offline shell needs index.html and its entry script');
        }

        const files: BuildFile[] = Object.values(bundle).map((file) => ({
          fileName: file.fileName,
          contents: file.type === 'chunk' ? file.code : file.source,
        }));
        const manifest = `${JSON.stringify(webManifest(config.base, options.themeColors), null, 2)}\n`;
        this.emitFile({ type: 'asset', fileName: MANIFEST_FILE, source: manifest });
        files.push({ fileName: MANIFEST_FILE, contents: manifest });
        for (const fileName of PUBLIC_SHELL_FILES) {
          const path = join(config.publicDir, fileName);
          if (!existsSync(path)) this.error(`offline shell needs public/${fileName}`);
          files.push({ fileName, contents: readFileSync(path) });
        }
        const build = serviceWorkerBuild({
          enabled: options.enabled,
          files,
          pyodideVersion: options.pyodideVersion,
          shellEntry: entry.fileName,
          workerSource: worker.code,
        });
        worker.code = injectBuild(worker.code, build);
      },
    },
  };
}
