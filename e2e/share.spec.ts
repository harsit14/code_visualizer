import { expect, test } from '@playwright/test';
import {
  consolePanel,
  editor,
  goToStep,
  openDashboard,
  replaceCode,
  runCode,
  stepInput,
  variablesPanel,
  waitForPythonReady,
} from './support';

const SHARED_CODE = 'greeting = "shared from e2e"\nprint(greeting)\n';

test('a share link restores the code after a reload and waits for a click to run', async ({
  browser,
  page,
}) => {
  await openDashboard(page);
  await replaceCode(page, SHARED_CODE);
  await page.getByRole('button', { name: 'Copy runnable link' }).click();
  await expect(page).toHaveURL(/#cv=/);
  const url = page.url();
  const shared = JSON.parse(
    Buffer.from(new URL(url).hash.slice('#cv='.length), 'base64url').toString('utf8'),
  ) as { code: string; language: string };
  expect(shared).toMatchObject({ code: SHARED_CODE, language: 'python' });

  // A fresh context has no saved draft, so only the link can supply the code.
  const context = await browser.newContext();
  try {
    const reloaded = await context.newPage();
    await reloaded.goto(url);
    await expect(editor(reloaded)).toContainText('greeting = "shared from e2e"');
    await waitForPythonReady(reloaded);

    await expect(stepInput(reloaded)).toHaveCount(0);
    await expect(variablesPanel(reloaded)).toContainText('Run code to inspect variables.');

    await runCode(reloaded);
    await goToStep(reloaded, 'final');
    await expect(consolePanel(reloaded).locator('.console-stdout')).toHaveText('shared from e2e');
  } finally {
    await context.close();
  }
});
