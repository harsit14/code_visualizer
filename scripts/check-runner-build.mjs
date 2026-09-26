import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const build = spawnSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.runner.config.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, VITE_RUNNER_APP_ORIGIN: 'https://app.example.invalid' },
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const root = 'dist-runner';
for (const name of [
  'runner.html',
  'assets/pyodide/pyodide.asm.wasm',
  'assets/pyodide/python_stdlib.zip',
]) {
  if (!existsSync(join(root, name))) throw new Error(`Runner artifact missing ${name}`);
}
if (existsSync(join(root, 'index.html'))) throw new Error('Runner must not include the app shell.');
// The offline service worker belongs to the app origin only.
for (const name of ['sw.js', 'manifest.webmanifest'])
  if (existsSync(join(root, name))) throw new Error(`Runner must not ship ${name}.`);
const files = readdirSync(join(root, 'assets'));
for (const worker of ['pyodideWorker-', 'jsTraceWorker-'])
  if (!files.some((name) => name.startsWith(worker) && name.endsWith('.js')))
    throw new Error(`Missing ${worker}`);
for (const file of files.filter((name) => name.endsWith('.js'))) {
  const text = readFileSync(join(root, 'assets', file), 'utf8');
  for (const secretName of ['SUPABASE_SERVICE_ROLE_KEY', 'DEEPSEEK_API_KEY', 'PASSWORD_PEPPER']) {
    if (text.includes(secretName))
      throw new Error(`Account/server code leaked into runner bundle: ${secretName}`);
  }
  if (text.includes('serviceWorker.register') || text.includes('codeviz:skip-waiting'))
    throw new Error(`Runner bundle ${file} registers the app service worker.`);
}
console.log('Separate runner build and asset smoke check passed (test origin only).');
