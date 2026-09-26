import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { Script } from 'node:vm';
import { gzipSync } from 'node:zlib';

const root = process.cwd();
const distDir = join(root, 'dist');
const requiredFiles = [
  'index.html',
  '_headers',
  '_routes.json',
  'assets/pyodide/pyodide.asm.js',
  'assets/pyodide/pyodide.asm.wasm',
  'assets/pyodide/pyodide-lock.json',
  'assets/pyodide/pyodide.mjs',
  'assets/pyodide/python_stdlib.zip',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];
const requiredHeaders = [
  'Content-Security-Policy:',
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Embedder-Policy: require-corp',
  'Cross-Origin-Resource-Policy: same-origin',
  'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  'X-Content-Type-Options: nosniff',
];
const failures = [];
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.txt']);

for (const file of requiredFiles) {
  if (!existsSync(join(distDir, file))) {
    failures.push(`missing dist/${file}`);
  }
}

const headersPath = join(distDir, '_headers');
const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
const routesPath = join(distDir, '_routes.json');
const routes = existsSync(routesPath) ? readFileSync(routesPath, 'utf8') : '';
const wranglerPath = join(root, 'wrangler.jsonc');
const wranglerConfig = existsSync(wranglerPath) ? readFileSync(wranglerPath, 'utf8') : '';
const indexPath = join(distDir, 'index.html');
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMetaContent(html, keyAttribute, keyValue) {
  const keyPattern = new RegExp(`${keyAttribute}=["']${escapeRegex(keyValue)}["']`, 'i');
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!keyPattern.test(tag)) {
      continue;
    }
    return tag.match(/\scontent=["']([^"']+)["']/i)?.[1] ?? null;
  }
  return null;
}

function collectTextFiles(directory, files = []) {
  if (!existsSync(directory)) {
    return files;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTextFiles(path, files);
    } else if (textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

for (const header of requiredHeaders) {
  if (!headers.includes(header)) {
    failures.push(`missing header: ${header}`);
  }
}

if (process.env.GITHUB_PAGES === 'true' && !indexHtml.includes('/code_visualizer/assets/')) {
  failures.push('GitHub Pages build does not use /code_visualizer/ as the Vite asset base');
}

for (const [label, keyAttribute, keyValue] of [
  ['og:image', 'property', 'og:image'],
  ['twitter:image', 'name', 'twitter:image'],
]) {
  const content = findMetaContent(indexHtml, keyAttribute, keyValue);
  if (!content) {
    failures.push(`missing ${label} meta tag`);
  } else if (!/^https?:\/\//i.test(content)) {
    failures.push(`${label} must use an absolute URL`);
  }
}

for (const file of collectTextFiles(distDir)) {
  const contents = readFileSync(file, 'utf8');
  if (/fonts\.(googleapis|gstatic)\.com/i.test(contents)) {
    failures.push(
      `${relative(root, file)} references Google Fonts; production CSP requires self-hosted fonts`,
    );
  }
}

if (!routes.includes('"/api/*"')) {
  failures.push('dist/_routes.json does not include /api/* for the Cloudflare explainer Function');
}

if (!wranglerConfig.includes('"run_worker_first"') || !wranglerConfig.includes('"/api/*"')) {
  failures.push('wrangler.jsonc does not run the Worker before static assets for /api/*');
}

if (existsSync(join(distDir, 'assets/pyodide/node_modules'))) {
  failures.push(
    'pyodide assets are nested under node_modules; expected direct assets/pyodide files',
  );
}

if (process.env.GITHUB_PAGES === 'true') {
  const fallback = join(distDir, '404.html');
  if (!existsSync(fallback) || readFileSync(fallback, 'utf8') !== indexHtml) {
    failures.push('GitHub Pages build needs dist/404.html equal to index.html for deep links');
  }
}

// Installable offline shell: manifest and service worker under the base path.
const base =
  process.env.VITE_BASE ?? (process.env.GITHUB_PAGES === 'true' ? '/code_visualizer/' : '/');
const distPath = (url) => join(distDir, url.startsWith(base) ? url.slice(base.length) : url);
const manifestPath = join(distDir, 'manifest.webmanifest');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.scope !== base || !manifest.start_url?.startsWith(base)) {
    failures.push(`manifest start_url and scope must be under ${base}`);
  }
  if (manifest.display !== 'standalone' || !manifest.theme_color || !manifest.background_color) {
    failures.push('manifest needs display standalone and theme and background colours');
  }
  const icons = manifest.icons ?? [];
  for (const size of ['192x192', '512x512']) {
    if (!icons.some((icon) => icon.sizes === size && icon.type === 'image/png')) {
      failures.push(`manifest has no ${size} PNG icon`);
    }
  }
  if (!icons.some((icon) => icon.purpose === 'maskable')) {
    failures.push('manifest has no maskable icon');
  }
  for (const icon of icons) {
    if (!icon.src.startsWith(base) || !existsSync(distPath(icon.src))) {
      failures.push(`manifest icon ${icon.src} is missing or outside ${base}`);
    }
  }
}
for (const [label, pattern] of [
  ['manifest link', `<link rel="manifest" href="${base}manifest.webmanifest">`],
  ['apple-touch-icon', `rel="apple-touch-icon" href="${base}icons/apple-touch-icon.png"`],
  ['theme-color', '<meta name="theme-color"'],
]) {
  if (!indexHtml.includes(pattern)) failures.push(`index.html is missing the ${label}`);
}

const workerPath = join(distDir, 'sw.js');
if (existsSync(workerPath)) {
  const worker = readFileSync(workerPath, 'utf8');
  try {
    // Registered as a classic script, so it must not use import or export.
    new Script(worker);
  } catch (error) {
    failures.push(`sw.js is not a classic script: ${error.message}`);
  }
  // offlineShellPlugin injects the build between these markers.
  const [open, close] = ['/*codeviz-sw-build*/', '/*end-codeviz-sw-build*/'];
  const start = worker.indexOf(open) + open.length;
  const end = worker.indexOf(close, start);
  const build = start >= open.length && end > start ? JSON.parse(worker.slice(start, end)) : null;
  if (!build || worker.includes('__CODEVIZ_SW_BUILD__')) {
    failures.push('sw.js has no injected precache manifest');
  } else if (build.enabled) {
    if (!indexHtml.includes(`${base}${build.shellEntry}`) || !build.precache.includes('./')) {
      failures.push('sw.js does not precache the shell and its entry script');
    }
    for (const path of build.precache) {
      const file = path === './' ? 'index.html' : path;
      if (!existsSync(join(distDir, file))) failures.push(`sw.js precaches missing ${path}`);
      if (/^assets\/pyodide\/|\.map$|^api\//.test(file)) {
        failures.push(`sw.js must not precache ${path}`);
      }
    }
  }
}

// The landing page must stay light: the dashboard (editor, panels, runtimes) loads
// only when opened. Budget covers the entry script and everything it preloads.
const LANDING_BUDGET_GZIP_BYTES = 120 * 1024;
const entryAssets = [
  ...indexHtml.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g),
  ...indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
].map((match) => match[1].replace(/^.*\/assets\//, 'assets/'));
let landingBytes = 0;
for (const asset of entryAssets) {
  const path = join(distDir, asset);
  if (!existsSync(path)) {
    failures.push(`index.html references missing ${asset}`);
    continue;
  }
  landingBytes += gzipSync(readFileSync(path)).length;
  if (/\/codemirror-/.test(`/${asset}`)) {
    failures.push(`landing page preloads the editor bundle (${asset}); keep the dashboard lazy`);
  }
}
if (landingBytes > LANDING_BUDGET_GZIP_BYTES) {
  failures.push(
    `landing JavaScript is ${Math.round(landingBytes / 1024)} KB gzip; budget is ${LANDING_BUDGET_GZIP_BYTES / 1024} KB`,
  );
}

if (failures.length > 0) {
  console.error('Production smoke check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Production smoke check passed. Landing JavaScript: ${Math.round(landingBytes / 1024)} KB gzip.`,
);
