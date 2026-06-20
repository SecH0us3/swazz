import { test, expect } from '@playwright/test';

test.describe('Keyboard Shortcuts and Modals Dismissals E2E Tests', () => {
  // Common login/registration helper
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    const signUpLink = page.locator('button.link-btn:has-text("Sign up")');
    if (await signUpLink.isVisible()) {
      await signUpLink.click();
    }

    const uniqueUsername = `user_${Date.now()}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
  });

  test('Keyboard Shortcuts Modal - Open by ? and Close by Escape', async ({ page }) => {
    // 1. Verify hotkeys modal is NOT visible initially
    const modal = page.locator('.modal-container');
    await expect(modal).not.toBeVisible();

    // 2. Press '?' key to open the shortcuts modal
    await page.keyboard.press('?');

    // 3. Verify modal is displayed and lists valid shortcuts
    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toHaveText('Keyboard Shortcuts');
    await expect(page.locator('.hotkeys-desc:has-text("Trigger / Run Fuzzer")')).toBeVisible();

    // 4. Press Escape key and verify that modal closes
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('Modal Dismissals - Backdrop Click, Close Button, and Escape on Payload Settings', async ({ page }) => {
    const modal = page.locator('.modal-container');

    // --- Part 1: Backdrop click on Shortcuts Modal ---
    // 1. Open the Keyboard Shortcuts modal
    await page.keyboard.press('?');
    await expect(modal).toBeVisible();

    // 2. Click on the overlay backdrop (using top-left corner offset of the container)
    await modal.click({ position: { x: 5, y: 5 } });

    // 3. Verify that the modal is dismissed
    await expect(modal).not.toBeVisible();

    // --- Part 2: Close button (✕) on Shortcuts Modal ---
    // 4. Reopen the Keyboard Shortcuts modal
    await page.keyboard.press('?');
    await expect(modal).toBeVisible();

    // 5. Click the close button
    const closeBtn = modal.locator('.modal-close');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // 6. Verify that it closes
    await expect(modal).not.toBeVisible();

    // --- Part 3: Escape key on Payload Settings Modal ---
    // 7. Open the Payload Settings modal by clicking the gear icon in ConfigSidebar
    const payloadSettingsBtn = page.locator('button[title="Payload Settings"]');
    await expect(payloadSettingsBtn).toBeVisible();
    await payloadSettingsBtn.click();

    // 8. Verify the Payload Settings modal opens
    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toHaveText('Payload Settings');

    // 9. Press Escape key
    await page.keyboard.press('Escape');

    // 10. Verify that it closes
    await expect(modal).not.toBeVisible();
  });
});
