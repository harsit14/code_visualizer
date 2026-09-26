import { expect, test } from '@playwright/test';
import { dataPanel, goToStep, openDashboard, runCode, waitForPythonReady } from './support';

const NESTED = `class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

groups = {"even": [0, 2, 4], "odd": [1, 3]}
root = TreeNode(2, TreeNode(1), TreeNode(3))
print(len(groups), root.val)
`;

test('renders a dict of lists and a binary tree in the Data panel', async ({ page }) => {
  await openDashboard(page, { code: NESTED });
  await waitForPythonReady(page);
  await runCode(page);
  await goToStep(page, 'final');

  const data = dataPanel(page);
  const groups = data.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'groups', exact: true }),
  });
  for (const text of ["'even'", '[0, 2, 4]', "'odd'", '[1, 3]']) {
    await expect(groups.getByRole('cell', { name: text, exact: true })).toBeVisible();
  }

  const tree = data.getByRole('img', { name: 'Binary tree' });
  await expect(tree).toBeVisible();
  for (const value of ['1', '2', '3']) {
    await expect(tree.getByText(value, { exact: true })).toHaveCount(1);
  }
});
