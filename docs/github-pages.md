# GitHub Pages

This project is a Vite app, so GitHub Pages needs to publish the built `dist`
directory, not the repository root.

## One-Time Repository Setting

In the GitHub repository, go to **Settings -> Pages** and set **Source** to
**GitHub Actions**.

Do not use **Deploy from a branch** for the repository root. That publishes the
source files directly and usually shows a blank screen for Vite apps.

## Deployment Flow

The `.github/workflows/pages.yml` workflow runs on every push to `main`:

1. Installs dependencies.
2. Runs typecheck, lint, and tests.
3. Builds with `GITHUB_PAGES=true`, which sets Vite's base path to
   `/code_visualizer/`, marks the build as a static host (`VITE_STATIC_HOST`) and
   writes `404.html` as a copy of `index.html`.
4. Runs the production smoke check, including the 404 fallback and the landing
   JavaScript budget.
5. Uploads and deploys `dist` to GitHub Pages.

The project Pages URL is:

```text
https://harsit14.github.io/code_visualizer/
```

## Routing

Client routes follow the base path: the landing page is `/code_visualizer/` and
the dashboard is `/code_visualizer/app`. GitHub Pages answers unknown paths with
`404.html`, which is the app itself, so reloading the dashboard or opening a share
link (`/code_visualizer/app#cv=…`) works. Share links are built from the current
URL and keep the base path.

## Backend Limitations

GitHub Pages is static-only, so it cannot run `/api/explain-step`, create
accounts, save code history, or keep a DeepSeek key secret. Pages builds are
marked as a static host: the account menu and history menu are hidden, the
history toggle is replaced by a local-only note, and the AI explainer explains
that it is unavailable. Everything that runs in the browser (tracing, cases,
lessons, workspaces and backups) works normally. Use the Cloudflare Worker
deployment for the AI explainer, accounts, and saved history; there the UI asks
`/api/capabilities` which features are configured.

## If The Page Is Blank

- Confirm **Settings -> Pages -> Source** is set to **GitHub Actions**.
- Open the repository **Actions** tab and check the latest **GitHub Pages** run.
- Hard-refresh the live page after the workflow succeeds.
- In the browser Network tab, asset URLs should start with
  `/code_visualizer/assets/`, not `/assets/`.
