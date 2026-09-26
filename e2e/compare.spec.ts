import { expect, test } from '@playwright/test';
import {
  consolePanel,
  openDashboard,
  replaceCode,
  runCode,
  stepInput,
  waitForPythonReady,
} from './support';

const code = (factor: number) =>
  `total = 0\nfor n in range(3):\n    total += n * ${factor}\nprint(total)\n`;

test('Compare runs shows where an edited run first differs from the baseline', async ({ page }) => {
  await openDashboard(page, { code: code(2) });
  await waitForPythonReady(page);
  await runCode(page);

  await consolePanel(page).getByRole('button', { name: 'Keep as baseline' }).click();
  const compare = page.getByRole('region', { name: 'Compare runs' });
  await expect(compare).toContainText('This run is the baseline.');

  await replaceCode(page, code(3));
  await expect(stepInput(page)).toHaveCount(0);
  await runCode(page);

  await expect(compare.getByRole('status')).toContainText('The runs differ');
  const difference = compare.getByRole('region', { name: 'First difference' });
  await expect(difference).toBeVisible();
  await expect(difference.getByLabel(/^Baseline line 3$/)).toContainText('total += n * 2');
  await expect(difference.getByLabel(/^Current line 3$/)).toContainText('total += n * 3');

  await difference.getByRole('button', { name: /^Show step \d+ in the replay$/ }).click();
  await expect(
    difference.getByRole('button', { name: /^Show step \d+ in the replay$/ }),
  ).toHaveAttribute('aria-current', 'step');
});
