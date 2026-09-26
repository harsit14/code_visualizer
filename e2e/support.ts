import { expect, type Locator, type Page } from '@playwright/test';

type Language = 'python' | 'javascript' | 'typescript';

/** Loading Pyodide compiles a large WebAssembly module; slow CI machines need the headroom. */
export const RUNTIME_TIMEOUT = 90_000;

/** The `#cv=` fragment a share link carries (see src/app/shareState.ts). */
export function shareHash(code: string, language: Language = 'python') {
  return `#cv=${Buffer.from(JSON.stringify({ code, language })).toString('base64url')}`;
}

/** Opens the dashboard, optionally with code supplied the way a share link supplies it. */
export async function openDashboard(page: Page, source?: { code: string; language?: Language }) {
  await page.goto(source ? `/app${shareHash(source.code, source.language)}` : '/app');
  await expect(page.getByRole('heading', { level: 1, name: 'Code Visualizer' })).toBeVisible();
}

export function statusPill(page: Page) {
  return page.locator('.status-pill');
}

export async function waitForPythonReady(page: Page) {
  await expect(statusPill(page)).toHaveText('Python ready', { timeout: RUNTIME_TIMEOUT });
}

export function playbackControls(page: Page) {
  return page.getByLabel('Playback controls');
}

/** Before the first run the button also shows the Cmd/Ctrl Enter hint. */
export function runButton(page: Page) {
  return playbackControls(page).getByRole('button', { name: /^Run(\s*(Cmd|Ctrl) Enter)?$/ });
}

export function stepInput(page: Page) {
  return page.getByRole('spinbutton', { name: 'Jump to step' });
}

export function editor(page: Page) {
  return page.locator('.cm-content');
}

export function variablesPanel(page: Page) {
  // Exact, so the Watch variables panel does not match too.
  return page.getByRole('region', { name: 'Variables', exact: true });
}

export function consolePanel(page: Page) {
  return page.getByRole('region', { name: 'Output console' });
}

export function dataPanel(page: Page) {
  return page.getByRole('region', { name: 'Data structures' });
}

export function inputsPanel(page: Page) {
  return page.getByRole('region', { name: 'Generated test inputs' });
}

/** The Variables row for `name`, matched on its name cell. */
export function variableRow(page: Page, name: string): Locator {
  return variablesPanel(page)
    .getByRole('row')
    .filter({ has: page.getByText(name, { exact: true }) });
}

/**
 * Replaces the editor contents in one input event, so no auto-indent or bracket
 * closing applies. WebKit's fill() on CodeMirror inserts without replacing, so
 * select everything first.
 */
export async function replaceCode(page: Page, code: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(code);
  await expect(editor(page)).toHaveText(code.replace(/\n$/, '').split('\n').join(''));
}

/** Clicks Run (the runtime must be idle, or the button reads Stop) and waits for a trace. */
export async function runCode(page: Page) {
  await runButton(page).click({ timeout: RUNTIME_TIMEOUT });
  await expect(stepInput(page)).toBeVisible({ timeout: RUNTIME_TIMEOUT });
}

/**
 * Presses a transport shortcut with focus on the page body. Shortcuts are
 * ignored inside the editor and inputs, and Space would also press a focused button.
 */
export async function pressShortcut(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
}

/** Successful runs start playing; jumping to a step pauses playback. */
export async function goToStep(page: Page, target: 'first' | 'final') {
  await pressShortcut(page, target === 'first' ? 'Home' : 'End');
  const lastStep = (await stepInput(page).getAttribute('max')) ?? '0';
  await expect(stepInput(page)).toHaveValue(target === 'first' ? '0' : lastStep);
  await expect(
    playbackControls(page).getByRole('button', { name: /^(Play trace|Pause trace playback)$/ }),
  ).toHaveAttribute('aria-pressed', 'false');
}
