import { expect, test } from '@playwright/test';
import {
  consolePanel,
  editor,
  goToStep,
  inputsPanel,
  openDashboard,
  playbackControls,
  pressShortcut,
  RUNTIME_TIMEOUT,
  runCode,
  stepInput,
  variableRow,
  waitForPythonReady,
} from './support';

test('runs Two Sum and steps with the buttons and the keyboard', async ({ page }) => {
  await openDashboard(page);
  await waitForPythonReady(page);
  await runCode(page);
  await goToStep(page, 'first');

  const controls = playbackControls(page);
  // The editor marks the line of the current step.
  const execLine = editor(page).locator('.cv-exec-line');
  await expect(execLine).toHaveCount(1);
  await expect(execLine).not.toContainText('return');
  await expect(variableRow(page, 'lookup')).toHaveCount(0);

  await controls.getByRole('button', { name: 'Next step' }).click();
  await expect(stepInput(page)).toHaveValue('1');
  await controls.getByRole('button', { name: 'Previous step' }).click();
  await expect(stepInput(page)).toHaveValue('0');

  await pressShortcut(page, 'ArrowRight');
  await expect(stepInput(page)).toHaveValue('1');
  await pressShortcut(page, 'ArrowRight');
  await expect(stepInput(page)).toHaveValue('2');
  await pressShortcut(page, 'ArrowLeft');
  await expect(stepInput(page)).toHaveValue('1');

  await goToStep(page, 'final');
  await expect(execLine).toContainText('return');
  await expect(variableRow(page, 'lookup')).toBeVisible();
  await expect(variableRow(page, 'nums')).toBeVisible();

  await goToStep(page, 'first');
  await expect(execLine).not.toContainText('return');
  await expect(variableRow(page, 'lookup')).toHaveCount(0);

  const play = controls.getByRole('button', { name: /^(Play trace|Pause trace playback)$/ });
  await pressShortcut(page, 'Space');
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await pressShortcut(page, 'Space');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
});

test('runs LeetCode-style names such as defaultdict without imports', async ({ page }) => {
  await openDashboard(page, {
    code: [
      'class Solution:',
      '    def topKFrequent(self, nums: List[int], k: int) -> List[int]:',
      '        counts = defaultdict(int)',
      '        for n in nums:',
      '            counts[n] += 1',
      '        return heapq.nlargest(k, counts, key=counts.get)',
      '',
    ].join('\n'),
  });
  const inputs = inputsPanel(page);
  await expect(inputs).toBeVisible({ timeout: RUNTIME_TIMEOUT });
  await inputs.getByRole('textbox', { name: /^nums/ }).fill('[1, 1, 1, 2, 2, 3]');
  await inputs.getByRole('textbox', { name: /^k/ }).fill('2');
  await waitForPythonReady(page);

  await runCode(page);
  await goToStep(page, 'final');

  await expect(consolePanel(page)).toContainText('returned [1, 2]');
  await expect(consolePanel(page).getByRole('alert')).toHaveCount(0);
  await expect(variableRow(page, 'counts')).toBeVisible();
});

test('suggests the intended name for a misspelled defaultdict', async ({ page }) => {
  await openDashboard(page, { code: 'counts = defauldict(int)\ncounts["a"] += 1\n' });
  await waitForPythonReady(page);

  await runCode(page);

  await expect(consolePanel(page).getByRole('alert')).toContainText(
    "NameError: name 'defauldict' is not defined. Did you mean 'defaultdict'?",
  );
});

test('shows operators as typed, without ligatures', async ({ page }) => {
  await openDashboard(page, { code: 'def check(a: int) -> bool:\n    return a <= 3 == True\n' });

  const content = editor(page);
  await expect(content).toContainText('def check(a: int) -> bool:');
  await expect(content).toContainText('return a <= 3 == True');
  expect(await content.evaluate((element) => getComputedStyle(element).fontVariantLigatures)).toBe(
    'none',
  );
});
