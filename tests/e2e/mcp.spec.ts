import { test, expect } from '@playwright/test';

test.describe('MCP and API Key Hashing E2E Tests', () => {
  test('should display masked key, support rotation and show plain-text key once', async ({ page }) => {
    // 1. Navigate to the frontend
    await page.goto('/');

    // 2. Register a unique user
    await page.getByRole('button', { name: 'Create' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open Profile Settings
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const settingsLink = page.locator('.dropdown-item:has-text("Profile Settings")');
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    // Verify Settings screen is loaded
    const settingsHeader = page.locator('h1:has-text("Settings")');
    await expect(settingsHeader).toBeVisible();

    // 4. Verify initial API Key input is present and masked
    const apiKeyInput = page.locator('.settings-input-monospace');
    await expect(apiKeyInput).toBeVisible();
    await expect(apiKeyInput).toHaveValue(/swazz_live_.*•/);

    // 5. Setup confirm dialog handler to accept key regeneration
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to regenerate your API key?');
      await dialog.accept();
    });

    // 6. Click the Regenerate API Key button
    const rotateBtn = page.locator('#btn-rotate-api-key');
    await expect(rotateBtn).toBeVisible();
    await rotateBtn.click();

    // 7. Verify new API Key alert is shown with plain text key
    const newAlert = page.locator('.api-key-new-alert');
    await expect(newAlert).toBeVisible();

    const newApiKeyInput = newAlert.locator('.settings-input-monospace');
    await expect(newApiKeyInput).toBeVisible();
    await expect(newApiKeyInput).toHaveValue(/swazz_live_/);
    await expect(newApiKeyInput).not.toHaveValue(/•/);

    // Click Dismiss button
    const dismissBtn = page.locator('#btn-dismiss-api-key');
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();

    // Verify the alert is gone
    await expect(newAlert).toBeHidden();

    // 8. Reload page to verify that the key returns to being masked
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // Navigate back to Profile Settings
    await accountBtn.click();
    await settingsLink.click();
    await expect(settingsHeader).toBeVisible();

    // Verify it is masked again
    const apiInputReloaded = page.locator('.settings-input-monospace');
    await expect(apiInputReloaded).toBeVisible();
    await expect(apiInputReloaded).toHaveValue(/swazz_live_.*•/);
  });
});
