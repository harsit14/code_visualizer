import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

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

if (failures.length > 0) {
  console.error('Production smoke check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Production smoke check passed.');
