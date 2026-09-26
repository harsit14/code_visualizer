# Release Checklist

Use this before publishing a new public version.

## Local Verification

```bash
npm run ci
```

## Browser Tests

Playwright specs in `e2e/` drive the production build served by `vite preview`
(with the same COOP/COEP headers as the Worker, but no `/api`). They cover the
landing page, Python and JavaScript runs and stepping, LeetCode-style prelude
names, practice cases, share links, trace export and import, nested structures,
Stop, the run timeout, a failed runtime download, Compare runs, presentation
mode, the mobile workspace and ligature-free code. CI runs them on every pull
request in the `e2e` job, one matrix entry per browser.

```bash
npx playwright install chromium firefox webkit   # once per Playwright version
npm run test:e2e                                  # builds, then runs every project
E2E_SKIP_BUILD=1 npm run test:e2e -- --project=chromium   # reuse dist, one browser
npm run test:e2e -- e2e/recovery.spec.ts --headed         # one file, visible browser
npm run test:e2e:ui                               # pick, watch and time-travel tests
npx playwright show-report                        # HTML report of the last run
```

The server listens on port 4178 and is reused when already running locally, so
stop an old preview after rebuilding. Desktop projects skip `mobile.spec.ts`;
the 390px phone projects run only the mobile and landing specs. A cold Pyodide
start takes several seconds, so tests allow 120 seconds and runtime waits 90.
Specs that block Pyodide with `route` also block the offline service worker,
because routes do not see requests it answers. In CI a failing test is retried
once with a trace; download the `playwright-<browser>` artifact and open a trace
with `npx playwright show-trace test-results/<test>/trace.zip`.

On macOS 27, Playwright 1.63's Firefox exits at launch with "Could not find
profile folder"; run the other projects locally and rely on CI for Firefox.

## Browser Verification

- Run all built-in examples.
- Scrub the timeline forward and backward.
- Click a variable that references an object.
- Check `0.5x`, `1x`, `2x`, and `4x` playback.
- Export a JSON trace.
- Create and reload a share link.
- Confirm stdout appears only at the final recorded step.
- Confirm timeout still interrupts runaway code.

## Cloudflare Verification

- Production deploy succeeds from `main`.
- Preview deploy succeeds from a pull request branch.
- Response headers include COOP and COEP.
- Pyodide loads from `/assets/pyodide/`.
- The app works at desktop widths.
