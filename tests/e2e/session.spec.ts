import { test, expect } from '@playwright/test';

test.describe('Session Expiration and Authentication Flow E2E Test', () => {
  test('should redirect to login screen when session token becomes invalid or expired (401)', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Sign up' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Programmatically corrupt/expire the session token in localStorage
    await page.evaluate(() => {
      localStorage.setItem('swazz_token', 'invalid-expired-session-token');
    });

    // 4. Reload page to trigger profile check with the expired token
    await page.reload();

    // 5. Verify that the user is logged out and redirected back to the login screen
    const loginHeader = page.locator('h2:has-text("Welcome to Swazz")');
    await expect(loginHeader).toBeVisible({ timeout: 15000 });

    // 6. Assert that localStorage token is cleaned up
    const token = await page.evaluate(() => localStorage.getItem('swazz_token'));
    expect(token).toBeNull();
  });
});
