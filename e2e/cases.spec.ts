import { expect, test } from '@playwright/test';
import { inputsPanel, openDashboard, RUNTIME_TIMEOUT, waitForPythonReady } from './support';

test('practice cases report a pass and explain a mismatch', async ({ page }) => {
  await openDashboard(page);
  const inputs = inputsPanel(page);
  await expect(inputs).toBeVisible({ timeout: RUNTIME_TIMEOUT });
  await inputs.getByRole('textbox', { name: /^nums/ }).fill('[2, 7, 11, 15]');
  await inputs.getByRole('textbox', { name: /^target/ }).fill('9');
  await waitForPythonReady(page);

  await inputs.locator('summary', { hasText: 'Cases' }).click();
  const addCurrent = inputs.getByRole('button', { name: 'Add current' });
  await addCurrent.click();
  await addCurrent.click();

  const cases = inputs.getByRole('article');
  await expect(cases).toHaveCount(2);
  const [passing, failing] = [cases.nth(0), cases.nth(1)];
  await passing.getByRole('textbox', { name: 'expected', exact: true }).fill('[0, 1]');
  await failing.getByRole('textbox', { name: 'expected', exact: true }).fill('[1, 0]');

  await inputs.getByRole('button', { name: 'Run cases' }).click();

  await expect(passing.locator('.test-case-status')).toHaveText('pass', {
    timeout: RUNTIME_TIMEOUT,
  });
  await expect(failing.locator('.test-case-status')).toHaveText('fail');
  await expect(failing.getByRole('list', { name: 'How the result differs' })).toContainText(
    'Same items in a different order',
  );
  await expect(passing.getByRole('list', { name: 'How the result differs' })).toHaveCount(0);
  await expect(inputs.locator('summary', { hasText: 'Cases' })).toContainText('1/2 pass');
});
