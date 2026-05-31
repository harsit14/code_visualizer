import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const distDir = join(root, 'dist');
const requiredFiles = [
  'index.html',
  '_headers',
  'assets/pyodide/pyodide.asm.js',
  'assets/pyodide/pyodide.asm.wasm',
  'assets/pyodide/pyodide-lock.json',
  'assets/pyodide/pyodide.mjs',
  'assets/pyodide/python_stdlib.zip',
];
const requiredHeaders = [
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Embedder-Policy: require-corp',
  'Cross-Origin-Resource-Policy: same-origin',
  'X-Content-Type-Options: nosniff',
];
const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(distDir, file))) {
    failures.push(`missing dist/${file}`);
  }
}

const headersPath = join(distDir, '_headers');
const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
const indexPath = join(distDir, 'index.html');
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';

for (const header of requiredHeaders) {
  if (!headers.includes(header)) {
    failures.push(`missing header: ${header}`);
  }
}

if (process.env.GITHUB_PAGES === 'true' && !indexHtml.includes('/code_visualizer/assets/')) {
  failures.push('GitHub Pages build does not use /code_visualizer/ as the Vite asset base');
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
