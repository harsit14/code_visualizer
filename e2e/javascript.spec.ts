import { expect, test } from '@playwright/test';
import {
  consolePanel,
  editor,
  goToStep,
  openDashboard,
  playbackControls,
  pressShortcut,
  runCode,
  stepInput,
  variableRow,
} from './support';

test('runs and steps through a JavaScript example', async ({ page }) => {
  await openDashboard(page);
  await page
    .getByRole('combobox', { name: 'Load example' })
    .first()
    .selectOption({ label: 'JavaScript loop accumulator' });
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('javascript');
  await expect(editor(page)).toContainText('let total = 0;');

  await runCode(page);
  await goToStep(page, 'first');

  const controls = playbackControls(page);
  await controls.getByRole('button', { name: 'Next step' }).click();
  await expect(stepInput(page)).toHaveValue('1');
  await pressShortcut(page, 'ArrowRight');
  await expect(stepInput(page)).toHaveValue('2');
  await controls.getByRole('button', { name: 'Previous step' }).click();
  await expect(stepInput(page)).toHaveValue('1');

  await goToStep(page, 'final');
  await expect(variableRow(page, 'total')).toContainText('10');
  await expect(consolePanel(page).locator('.console-stdout')).toHaveText('10');
});
