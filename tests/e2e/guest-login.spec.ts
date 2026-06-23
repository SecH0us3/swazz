import { test, expect } from '@playwright/test';

test.describe('Guest Login E2E Test', () => {
  test('should allow entering as guest, show guest badge, and log out to sign up', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Click "Continue as Guest"
    const guestBtn = page.getByRole('button', { name: 'Continue as Guest' });
    await expect(guestBtn).toBeVisible();
    await guestBtn.click();

    // 3. Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 4. Verify guest badge is shown in the header
    const guestBadge = page.locator('.guest-badge');
    await expect(guestBadge).toBeVisible();
    await expect(guestBadge).toContainText('Guest Mode');

    // 5. Click "Sign Up" button in the header to return to signup/login screen
    const signUpBtn = page.locator('.sign-up-btn');
    await expect(signUpBtn).toBeVisible();
    await signUpBtn.click();

    // 6. Verify we are back on the login screen (Continue as Guest button is visible again)
    await expect(guestBtn).toBeVisible();
  });
});
