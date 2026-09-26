import { expect, test, type Page } from '@playwright/test';
import {
  consolePanel,
  goToStep,
  openDashboard,
  playbackControls,
  replaceCode,
  runButton,
  runCode,
  RUNTIME_TIMEOUT,
  statusPill,
  stepInput,
  waitForPythonReady,
} from './support';

// sum() loops in C, so the tracer's step and time limits never see a line event.
const RUNAWAY = 'total = sum(iter(int, 1))\n';
const VALID = 'total = sum(range(5))\nprint(total)\n';

async function expectValidRunSucceeds(page: Page) {
  await replaceCode(page, VALID);
  await runCode(page);
  await goToStep(page, 'final');
  await expect(consolePanel(page).locator('.console-stdout')).toHaveText('10');
}

test('Stop ends a runaway run and the next run succeeds', async ({ page }) => {
  await openDashboard(page, { code: RUNAWAY });
  await waitForPythonReady(page);

  await runButton(page).click();
  await expect(statusPill(page)).toHaveText(/Instrumenting code|Generating trace/);
  await playbackControls(page).getByRole('button', { name: 'Stop' }).click();

  await expect(statusPill(page)).toHaveText(/^Stopped\./);
  await expect(stepInput(page)).toHaveCount(0);
  await expectValidRunSucceeds(page);
});

test('the run timeout ends a runaway run and the next run succeeds', async ({ page }) => {
  // The run timeout is 15 seconds, followed by a restart of the runtime.
  test.slow();
  await openDashboard(page, { code: RUNAWAY });
  await waitForPythonReady(page);

  await runButton(page).click();

  await expect(consolePanel(page).getByRole('alert')).toContainText(
    'ExecutionTimeout: Python execution exceeded 15000ms and was stopped.',
    { timeout: 45_000 },
  );
  await expect(statusPill(page)).toHaveText('Execution timed out. Run again to restart Python.');
  await expectValidRunSucceeds(page);
});

test.describe('runtime download', () => {
  // The offline service worker claims the page once active, and routes do not
  // see requests it answers, so it could serve Pyodide past the block.
  test.use({ serviceWorkers: 'block' });

  test('a failed runtime download shows the error and recovers on Retry', async ({ page }) => {
    const pyodideAssets = '**/assets/pyodide/**';
    // Context routes also cover requests made by the runtime's web worker.
    await page.context().route(pyodideAssets, (route) => route.abort());
    await openDashboard(page, { code: VALID });

    const retry = playbackControls(page).getByRole('button', { name: 'Retry runtime' });
    await expect(retry).toBeVisible({ timeout: RUNTIME_TIMEOUT });
    await expect(statusPill(page)).toHaveClass(/status-error/);
    await expect(statusPill(page)).not.toHaveText('');

    await page.context().unroute(pyodideAssets);
    await retry.click();
    await waitForPythonReady(page);
    await runCode(page);
    await goToStep(page, 'final');
    await expect(consolePanel(page).locator('.console-stdout')).toHaveText('10');
  });
});
