import { test, expect } from '@playwright/test';

test.describe('Admin Logs Viewer E2E Tests', () => {
  test('Admin Logs Tab access and log viewing', async ({ page }) => {
    // Mock the admin logs API response to ensure logs are returned
    await page.route('**/api/admin/logs', async (route) => {
      const mockLogs = [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          module: 'Coordinator',
          msg: 'Runner agent connected successfully'
        },
        {
          timestamp: new Date(Date.now() - 5000).toISOString(),
          level: 'warn',
          module: 'Cleanup',
          msg: 'Cleaned up expired rate limits.'
        }
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLogs)
      });
    });

    // 1. Navigate to the frontend
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user
    const createBtn = page.getByRole('button', { name: 'Create an account' });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Generate random username under 20 characters (Rule: registration limit 3-20 characters)
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
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

    // 6. Navigate to Admin Logs tab
    const adminLogsTab = page.locator('button:has-text("Admin Logs")');
    await expect(adminLogsTab).toBeVisible();
    await adminLogsTab.click();

    // 7. Input admin secret
    const secretInput = page.locator('input[placeholder="Enter Admin Secret"]');
    await expect(secretInput).toBeVisible();
    await secretInput.fill('test-admin-secret');

    const saveBtn = page.locator('button:has-text("Save & Authenticate")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // 8. Verify logs table is visible and contains our mock logs
    const logsTable = page.locator('.logs-table-wrapper');
    await expect(logsTable).toBeVisible();

    await expect(page.locator('text=Runner agent connected successfully')).toBeVisible();
    await expect(page.locator('text=Cleaned up expired rate limits.')).toBeVisible();
  });
});
