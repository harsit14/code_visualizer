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
   `/code_visualizer/`.
4. Runs the production smoke check.
5. Uploads and deploys `dist` to GitHub Pages.

The project Pages URL is:

```text
https://harsit14.github.io/code_visualizer/
```

## If The Page Is Blank

- Confirm **Settings -> Pages -> Source** is set to **GitHub Actions**.
- Open the repository **Actions** tab and check the latest **GitHub Pages** run.
- Hard-refresh the live page after the workflow succeeds.
- In the browser Network tab, asset URLs should start with
  `/code_visualizer/assets/`, not `/assets/`.
