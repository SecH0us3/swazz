import { test, expect } from '@playwright/test';

test.describe('Settings views sidebar auto-collapse and restore E2E Test', () => {
  test('should automatically collapse side panels in settings and restore them on navigate back', async ({ page }) => {
    // 1. Navigate to frontend dev server
    await page.goto('/');

    // 2. Register unique user
    await page.getByRole('button', { name: 'Create' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    const sidebar = page.locator('.sidebar');
    const configSidebar = page.locator('.config-sidebar');

    // 3. Verify sidebars are visible by default
    await expect(sidebar).toBeVisible();
    await expect(configSidebar).toBeVisible();

    // 4. Navigate to Project Settings
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // 5. Verify settings screen is loaded and sidebars are auto-hidden
    const projectSettingsHeader = page.locator('h1:has-text("Project Settings")');
    await expect(projectSettingsHeader).toBeVisible();
    await expect(sidebar).toBeHidden();
    await expect(configSidebar).toBeHidden();

    // 6. Navigate back to Dashboard and verify sidebars are restored to visible
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    await expect(sidebar).toBeVisible();
    await expect(configSidebar).toBeVisible();

    // 7. Open User/Profile Settings from dropdown
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const profileSettingsLink = page.locator('.dropdown-item:has-text("Profile Settings")');
    await expect(profileSettingsLink).toBeVisible();
    await profileSettingsLink.click();

    // 8. Verify User Settings screen loaded and sidebars are auto-hidden
    const userSettingsHeader = page.locator('h1:has-text("Settings")');
    await expect(userSettingsHeader).toBeVisible();
    await expect(sidebar).toBeHidden();
    await expect(configSidebar).toBeHidden();

    // 9. Navigate back and verify restored to visible
    const backBtn2 = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn2).toBeVisible();
    await backBtn2.click();

    await expect(sidebar).toBeVisible();
    await expect(configSidebar).toBeVisible();
  });
});
