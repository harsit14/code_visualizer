import { expect, test } from '@playwright/test';
import {
  openDashboard,
  playbackControls,
  pressShortcut,
  runButton,
  runCode,
  variablesPanel,
  waitForPythonReady,
} from './support';

test('P enters presentation and Esc restores the workspace', async ({ page }) => {
  await openDashboard(page);
  await waitForPythonReady(page);
  await runCode(page);

  const title = page.getByRole('heading', { level: 1, name: 'Code Visualizer' });
  const presentation = page.getByRole('region', { name: 'Presentation' });
  const callStack = page.getByRole('region', { name: 'Call stack' });
  await expect(callStack).toBeVisible();

  await pressShortcut(page, 'p');

  await expect(presentation).toBeVisible();
  await expect(title).toBeHidden();
  await expect(runButton(page)).toHaveCount(0);
  await expect(callStack).toHaveCount(0);
  await expect(variablesPanel(page)).toBeVisible();
  await expect(playbackControls(page).getByRole('button', { name: 'Next step' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(presentation).toHaveCount(0);
  await expect(title).toBeVisible();
  await expect(runButton(page)).toBeVisible();
  await expect(callStack).toBeVisible();
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeFocused();
});
