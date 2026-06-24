import { test, expect } from '@playwright/test';

test.describe('User Settings and Profile Management E2E Test', () => {
  test('should open settings, toggle theme preference, and apply to body instantly', async ({ page }) => {
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

    // 3. Open the UserMenu dropdown in the header
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    // 4. Click "Profile Settings" in the dropdown to navigate to settings
    const settingsLink = page.locator('.dropdown-item:has-text("Profile Settings")');
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    // 5. Verify settings screen is loaded
    const settingsHeader = page.locator('h1:has-text("Settings")');
    await expect(settingsHeader).toBeVisible();

    // Verify initial theme state is 'light' or default class on body
    const body = page.locator('body');
    await expect(body).toHaveClass(/light/);

    // 6. Click the toggle theme button in Settings page
    const toggleThemeBtn = page.locator('#btn-toggle-theme-settings');
    await expect(toggleThemeBtn).toBeVisible();
    await toggleThemeBtn.click();

    // 7. Verify body has .dark class instantly
    await expect(body).toHaveClass(/dark/);

    // 8. Click toggle theme button again to revert
    await toggleThemeBtn.click();

    // 9. Verify body is back to .light class
    await expect(body).toHaveClass(/light/);
  });

  test('should toggle runner modes and save Ed25519 public key in user settings', async ({ page }) => {
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

    // 3. Open the UserMenu dropdown in the header
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    // 4. Click "Profile Settings" in the dropdown to navigate to settings
    const settingsLink = page.locator('.dropdown-item:has-text("Profile Settings")');
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    // 5. Verify settings screen is loaded
    const settingsHeader = page.locator('h1:has-text("Settings")');
    await expect(settingsHeader).toBeVisible();

    // 6. Test runner mode tabs
    const privateRunnerTab = page.locator('button:has-text("Private Runner")');
    const sharedRunnerTab = page.locator('button:has-text("Shared Runner")');

    await expect(privateRunnerTab).toBeVisible();
    await expect(sharedRunnerTab).toBeVisible();

    // Default should be Private Runner mode active
    await expect(page.locator('text=Private Mode:')).toBeVisible();
    await expect(page.locator('text=generate-keys')).toBeVisible();
    await expect(page.locator('text=--key')).toBeVisible();

    // Switch to Shared Runner mode
    await sharedRunnerTab.click();
    await expect(page.locator('text=Shared Mode:')).toBeVisible();
    await expect(page.locator('text=--token')).toBeVisible();
    await expect(page.locator('text=generate-keys')).toBeHidden();

    // Switch back to Private
    await privateRunnerTab.click();
    await expect(page.locator('text=Private Mode:')).toBeVisible();
    await expect(page.locator('text=--key')).toBeVisible();

    // 7. Test invalid public key format validation (negative scenario)
    const pubKeyInput = page.locator('input[placeholder*="Enter hex-encoded public key"]');
    await expect(pubKeyInput).toBeVisible();

    await pubKeyInput.fill('invalid-key-short');
    const saveBtn = page.locator('form button[type="submit"]:has-text("Save")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify error message is displayed
    await expect(page.locator('text=Invalid public key format')).toBeVisible();

    // 8. Save a mock 64-character public key (positive scenario)
    const mockPubKey = 'a'.repeat(64);
    await pubKeyInput.fill(mockPubKey);
    await saveBtn.click();

    // Verify success message
    await expect(page.locator('text=Public key saved successfully!')).toBeVisible();

    // 9. Reload page and check persistence (persistency scenario)
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // Open User Settings again
    await accountBtn.click();
    await settingsLink.click();
    await expect(settingsHeader).toBeVisible();

    // Verify the saved key is still in the input field
    const reloadedPubKeyInput = page.locator('input[placeholder*="Enter hex-encoded public key"]');
    await expect(reloadedPubKeyInput).toHaveValue(mockPubKey);
  });
});


