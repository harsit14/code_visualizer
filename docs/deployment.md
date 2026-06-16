# Deployment

This app is designed for Cloudflare Workers with Static Assets. The Worker
serves the built Vite app from `dist` and handles `/api/explain-step` before the
SPA fallback.

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

## Cloudflare Workers

Use these settings for the Git-connected Worker:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Version command: `npx wrangler versions upload`
- Root directory: `/`
- Production branch: `main`
- Node.js version: `22`

The checked-in `wrangler.jsonc` configures:

- `main`: `src/worker.ts`
- Static assets directory: `dist`
- Assets binding: `ASSETS`
- SPA fallback: `not_found_handling = "single-page-application"`
- API routing: `run_worker_first = ["/api/*"]`

`run_worker_first` is required. Without it, `/api/explain-step` can be served by
the static SPA fallback and open the dashboard instead of calling the API.

## Accounts And Daily Limits

Public accounts use the Cloudflare Worker, a D1 database, HttpOnly session
cookies, and daily usage counters. Subscription billing code is parked in
`src/server/billing.ts`, but it is not wired to the public UI or API routes.

Create the D1 database:

```bash
npx wrangler d1 create code-visualizer-prod
```

Add the returned binding to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "code-visualizer-prod",
    "database_id": "paste-the-database-id-here"
  }
]
```

Run the migration:

```bash
npx wrangler d1 migrations apply code-visualizer-prod --remote
```

The migration creates:

- `users`: email/password account records.
- `sessions`: hashed HttpOnly session tokens.
- `subscriptions`: reserved for future Stripe subscription entitlement state.
- `usage_daily`: daily AI explainer counters.
- `billing_events`: reserved for future Stripe webhook idempotency records.
- `code_history`: saved rerunnable code sessions for signed-in users.

Set these Worker variables and secrets:

| Name                       | Type     | Purpose                                         |
| -------------------------- | -------- | ----------------------------------------------- |
| `ANON_USAGE_SALT`          | Secret   | Hashes anonymous usage subjects.                |
| `ANON_DAILY_EXPLAIN_LIMIT` | Variable | Optional, default `3`.                          |
| `FREE_DAILY_EXPLAIN_LIMIT` | Variable | Optional, default `5`.                          |
| `ADMIN_EMAILS`             | Variable | Optional comma/space-separated admin allowlist. |

The landing page lives at `/`. The dashboard lives at `/app`. Shared trace links
with `#cv=` and iframe embeds still open the dashboard directly.

### Parked Subscription Code

Stripe Checkout, billing portal, and webhook helpers are kept in
`src/server/billing.ts` for a future paid launch. They are intentionally not
mounted from `src/server/accountApi.ts`, and the account menu does not expose an
upgrade action.

When subscriptions are ready to ship:

1. Reconnect the billing routes in `src/server/accountApi.ts`.
2. Reintroduce the checkout or pricing UI.
3. Create a Stripe Product and recurring Price.
4. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`.
5. Add the webhook endpoint:
   `https://your-domain.com/api/stripe/webhook`.
6. Subscribe the webhook to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

## AI Explainer Secret

The Explainer panel calls `/api/explain-step`. The Worker reads your DeepSeek key
from `env.DEEPSEEK_API_KEY`; the key is never sent to the browser.

In Cloudflare:

1. Open Workers & Pages.
2. Select the `code-visualizer` Worker.
3. Go to Settings -> Variables and Secrets -> Add.
4. Set the variable name to `DEEPSEEK_API_KEY`.
5. Paste your DeepSeek API key as the value.
6. Select Encrypt, then Save.
7. Redeploy the Worker so the latest version can read the new secret.

Optional: add `DEEPSEEK_MODEL` if you want to override the default
`deepseek-v4-flash`.

The explainer route is gated before the DeepSeek request. Anonymous visitors get
the anonymous daily limit, signed-in users get the free account daily limit, and
emails listed in `ADMIN_EMAILS` get an unlimited admin quota. Admin matching is
case-insensitive and exact after trimming whitespace; no client-side flag can
promote an account.

For local testing through Cloudflare's runtime:

```bash
npm run build
printf 'DEEPSEEK_API_KEY="your_key_here"\n' > .dev.vars
npx wrangler dev
```

Do not commit `.dev.vars`; it is ignored by git.

To verify the API route after deployment, open:

```text
https://your-worker.workers.dev/api/explain-step
```

If the Worker route is active, it returns JSON such as
`{"error":"Method not allowed."}` and includes:

```text
X-Code-Visualizer-Function: explain-step
```

If it loads the Code Visualizer app instead, `/api/*` is not running through the
Worker first. Check that the latest commit deployed and that `wrangler.jsonc`
includes `assets.run_worker_first = ["/api/*"]`.

## Cloudflare Pages Alternative

The repo still includes a Pages Function at `functions/api/explain-step.ts`. If
you create a Cloudflare Pages project instead of a Worker, use:

- Framework preset: Vite
- Root directory: project root
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

For Pages, `/functions` must be at the project root. Do not use dashboard Direct
Upload for Pages Functions.

## Required Headers

`public/_headers` is copied into `dist/_headers` during build. It enables
cross-origin isolation so Pyodide can use `SharedArrayBuffer` interrupts:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
```

Do not remove these headers unless the timeout strategy is changed to worker
termination only.

## Production Smoke Test

After `npm run build`, run:

```bash
npm run smoke
```

The smoke check verifies:

- `dist/index.html` exists.
- `dist/_headers` contains the required cross-origin isolation headers.
- `dist/_routes.json` includes `/api/*` for the Pages deployment path.
- Pyodide runtime assets are directly available under `dist/assets/pyodide/`.
- Pyodide assets are not accidentally nested under `node_modules`.

## Manual Smoke Test

After deployment:

1. Open the Cloudflare Workers URL.
2. Open `/api/explain-step`; confirm it returns JSON, not the app shell.
3. Run `Loop accumulator`; confirm stdout shows `10` at the final step.
4. Run `Two Sum (no entry point)`; confirm inputs are generated and the return
   value shows two indices.
5. Run `Reverse Linked List`; confirm chains render with pointer markers.
6. Click `Share`; reload the copied link and confirm the code is restored.
7. Click `Export`; confirm a JSON trace downloads, then `Import` it back.
8. Run `while True: pass`; confirm the run truncates with a step-limit note.
