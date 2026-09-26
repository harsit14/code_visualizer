import { expect, test } from '@playwright/test';

test('the landing page opens the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'See your code run, line by line.' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Start visualizing' }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Code Visualizer' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'python source editor' })).toBeVisible();
});
