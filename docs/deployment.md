# Deployment

This app is designed for Cloudflare Pages as a static Vite site.

## GitHub

1. Create a GitHub repository.
2. Push this project to the `main` branch.
3. Confirm the GitHub Actions CI workflow passes.

CI runs:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run smoke
```

## Cloudflare Pages

Use these settings:

- Framework preset: Vite
- Root directory: project root
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`
- Node.js version: `22`

Cloudflare should deploy every push to `main` and create preview deployments for pull requests.

## Required Headers

`public/_headers` is copied into `dist/_headers` during build. It enables cross-origin isolation so Pyodide can use `SharedArrayBuffer` interrupts:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
```

Do not remove these headers unless the timeout strategy is changed to worker termination only.

## Production Smoke Test

After `npm run build`, run:

```bash
npm run smoke
```

The smoke check verifies:

- `dist/index.html` exists.
- `dist/_headers` contains the required cross-origin isolation headers.
- Pyodide runtime assets are directly available under `dist/assets/pyodide/`.
- Pyodide assets are not accidentally nested under `node_modules`.

## Manual Smoke Test

After deployment:

1. Open the Cloudflare Pages URL.
2. Run `Loop accumulator`; confirm stdout shows `10` at the final step.
3. Run `Two Sum (no entry point)`; confirm inputs are generated and the
   return value shows two indices.
4. Run `Reverse Linked List`; confirm chains render with pointer markers.
5. Click `Share`; reload the copied link and confirm the code is restored.
6. Click `Export`; confirm a JSON trace downloads, then `Import` it back.
7. Run `while True: pass`; confirm the run truncates with a step-limit note.
