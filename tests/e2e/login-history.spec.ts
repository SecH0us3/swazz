import { test, expect } from '@playwright/test';

test.describe('Login History E2E Tests', () => {
  test('should display login history audit logs for project members', async ({ page }) => {
    // 1. Navigate to the frontend dev server and register User A (Owner)
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const createAccountBtn = page.getByRole('button', { name: 'Create an account' });
    await expect(createAccountBtn).toBeVisible();

    const usernameA = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(usernameA);
    await page.locator('#password').fill('Password123!');
    await createAccountBtn.click();

    // Wait for the main dashboard to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 2. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // Verify Project Settings header is visible
    const settingsHeader = page.locator('h1:has-text("Project Settings")');
    await expect(settingsHeader).toBeVisible();

    // 3. Open Members & Roles tab
    const membersRolesTabBtn = page.locator('button.tab-bar-btn:has-text("Members & Roles")');
    await expect(membersRolesTabBtn).toBeVisible();
    await membersRolesTabBtn.click();

    // Verify "Access & Permissions" header is visible
    await expect(page.locator('.rbac-tab-title:has-text("Access & Permissions")')).toBeVisible();

    // 4. Find User A in the members list and click "History"
    const memberRow = page.locator(`.rbac-table tbody tr:has-text("${usernameA}")`);
    await expect(memberRow).toBeVisible();

    const historyBtn = memberRow.locator('button:has-text("History")');
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    // 5. Verify that the Login History modal is open and shows audit log entries
    const modalHeader = page.locator('.rbac-modal-title:has-text("Login History:")');
    await expect(modalHeader).toBeVisible();

    // Verify the history table renders success entry
    const successBadge = page.locator('.rbac-badge-status-success:has-text("success")');
    await expect(successBadge).toBeVisible();

    // 6. Close the modal
    const closeBtn = page.locator('.rbac-modal-footer-between button:has-text("Close")');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Verify the modal is closed
    await expect(modalHeader).not.toBeVisible();
  });
});
