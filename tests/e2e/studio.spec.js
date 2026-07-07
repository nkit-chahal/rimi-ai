import { test, expect } from '@playwright/test';

test.describe('Studio happy path skeleton', () => {
  test('login page renders and studio route redirects unauthenticated users', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page.getByText('RIMI AI')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('studio requires authentication', async ({ page }) => {
    await page.goto('/#/studio/pattern');
    await expect(page).toHaveURL(/#\/login/);
  });
});
