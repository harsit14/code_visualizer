import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  editor,
  goToStep,
  openDashboard,
  playbackControls,
  runCode,
  stepInput,
  variableRow,
  waitForPythonReady,
} from './support';

test('exports a trace and replays it in a fresh page without running code', async ({
  browser,
  page,
}, testInfo) => {
  await openDashboard(page);
  await waitForPythonReady(page);
  await runCode(page);
  await goToStep(page, 'final');
  const lastStep = await stepInput(page).inputValue();

  await page.getByLabel('Open workspace menu').click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^code-visualizer-trace-\d+\.json$/);
  const tracePath = testInfo.outputPath('trace.json');
  await download.saveAs(tracePath);
  const exported = JSON.parse(await readFile(tracePath, 'utf8'));
  expect(exported).toMatchObject({ version: 2, language: 'python', step: Number(lastStep) });
  expect(exported.result.run.steps).toHaveLength(Number(lastStep) + 1);

  // With the Python runtime blocked, the replay can only come from the file. Routes
  // do not see requests the offline service worker answers, so keep it out.
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: 'block',
  });
  try {
    await context.route('**/assets/pyodide/**', (route) => route.abort());
    const fresh = await context.newPage();
    await openDashboard(fresh);

    await fresh.getByLabel('Open workspace menu').click();
    const chooserEvent = fresh.waitForEvent('filechooser');
    await fresh.getByRole('button', { name: 'Import', exact: true }).click();
    await (await chooserEvent).setFiles(tracePath);

    await expect(stepInput(fresh)).toHaveValue(lastStep);
    await expect(editor(fresh)).toContainText('def twoSum(self, nums, target):');
    await expect(variableRow(fresh, 'lookup')).toBeVisible();

    await goToStep(fresh, 'first');
    await expect(variableRow(fresh, 'lookup')).toHaveCount(0);
    await playbackControls(fresh).getByRole('button', { name: 'Next step' }).click();
    await expect(stepInput(fresh)).toHaveValue('1');
  } finally {
    await context.close();
  }
});
