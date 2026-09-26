import { expect, test, type Page } from '@playwright/test';
import {
  dataPanel,
  goToStep,
  inputsPanel,
  openDashboard,
  playbackControls,
  RUNTIME_TIMEOUT,
  runCode,
  variablesPanel,
  waitForPythonReady,
} from './support';

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test('the workspace tabs switch panels without horizontal overflow', async ({ page }) => {
  await openDashboard(page);
  expect(page.viewportSize()?.width).toBe(390);
  const tabs = page.getByRole('tablist', { name: 'Workspace view' });
  const panels = {
    Code: page.getByRole('region', { name: 'python source editor' }),
    Visualize: dataPanel(page),
    // Two Sum is a function, so its inputs appear once the runtime has analyzed it.
    Inputs: inputsPanel(page),
    Inspect: variablesPanel(page),
  };

  for (const [name, panel] of Object.entries(panels)) {
    const tab = tabs.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toBeVisible({ timeout: RUNTIME_TIMEOUT });
    for (const [otherName, other] of Object.entries(panels)) {
      if (otherName !== name) await expect(other).toBeHidden();
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  }

  await tabs.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  const visualize = tabs.getByRole('tab', { name: 'Visualize', exact: true });
  await expect(visualize).toBeFocused();
  await expect(visualize).toHaveAttribute('aria-selected', 'true');
  await expect(panels.Visualize).toBeVisible();
});

test('transport controls fit the screen and show keyboard focus', async ({ browserName, page }) => {
  await openDashboard(page);
  await waitForPythonReady(page);
  await runCode(page);
  await goToStep(page, 'first');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  const controls = playbackControls(page);
  const next = controls.getByRole('button', { name: 'Next step' });
  await controls.getByRole('button', { name: 'Play trace' }).focus();
  // WebKit on macOS follows the system default where Tab skips buttons; Option+Tab reaches them.
  const macWebKit = browserName === 'webkit' && process.platform === 'darwin';
  await page.keyboard.press(macWebKit ? 'Alt+Tab' : 'Tab');

  await expect(next).toBeFocused();
  const focus = await next.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
    };
  });
  expect(focus.visible).toBe(true);
  expect(focus.outlineStyle).not.toBe('none');
  expect(focus.outlineWidth).toBeGreaterThan(0);
});
