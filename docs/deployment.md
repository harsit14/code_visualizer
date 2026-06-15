# Deployment

This app is designed for Cloudflare Pages as a Vite site with one Pages
Function for the AI explainer.

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

### AI Explainer Secret

The Explainer panel calls `/api/explain-step`, a Cloudflare Pages Function. That
Function reads your DeepSeek key from `context.env.DEEPSEEK_API_KEY`; the key is
never sent to the browser.

In Cloudflare:

1. Open Workers & Pages.
2. Select this Pages project.
3. Go to Settings -> Variables and Secrets -> Add.
4. Set the variable name to `DEEPSEEK_API_KEY`.
5. Paste your DeepSeek API key as the value.
6. Select Encrypt, then Save.
7. Redeploy the project so the Function can read the new secret.

Optional: add `DEEPSEEK_MODEL` if you want to override the default
`deepseek-v4-flash`.

For local testing through Cloudflare's runtime:

```bash
npm run build
printf 'DEEPSEEK_API_KEY="your_key_here"\n' > .dev.vars
npx wrangler pages dev dist
```

Do not commit `.dev.vars`; it is ignored by git.

To verify the Function route after deployment, open:

```text
https://your-site.pages.dev/api/explain-step
```

If the route is active, it returns JSON such as `{"error":"Method not allowed."}`.
If it loads the Code Visualizer app instead, Cloudflare is serving the static
SPA fallback and the Function is not active for `/api/*`. Check that the latest
commit deployed, the Cloudflare Pages root directory is the repository root, and
`dist/_routes.json` includes `/api/*`.

Before charging subscriptions publicly, add account/session verification in
`functions/api/explain-step.ts` before the DeepSeek request. A typical
Cloudflare setup is:

- Auth/session provider: Clerk, Auth.js, Supabase Auth, or Cloudflare Access for
  private beta.
- Billing: Stripe Checkout or Lemon Squeezy.
- Entitlements/rate limits: D1 or KV keyed by user ID.
- Function gate: verify the user token and subscription status before calling
  DeepSeek.

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
