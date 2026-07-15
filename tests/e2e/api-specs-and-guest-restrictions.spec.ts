import { test, expect } from '@playwright/test';

test.describe('API Specifications and Guest Restrictions E2E Tests', () => {
  
  test('Guest Mode should restrict Member/Role modifications but allow viewing settings', async ({ page }) => {
    // 1. Navigate and log in as Guest
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();
    const guestBtn = page.getByRole('button', { name: 'Try as guest →' });
    await expect(guestBtn).toBeVisible();
    await guestBtn.click();

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 2. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // 3. Open Members & Roles tab
    const membersRolesTabBtn = page.locator('button.tab-bar-btn:has-text("Members & Roles")');
    await expect(membersRolesTabBtn).toBeVisible();
    await membersRolesTabBtn.click();

    // 4. Verify guest warning banner is visible
    const warningBanner = page.locator('.rbac-warning-banner');
    await expect(warningBanner).toBeVisible();
    await expect(warningBanner).toContainText('Guest accounts are permitted to view existing access rights, but cannot invite members, edit roles, or modify permissions.');

    // 5. Verify invite member button is disabled
    const inviteBtn = page.locator('button:has-text("Invite User")');
    await expect(inviteBtn).toBeDisabled();

    // 6. Switch to Roles and verify actions are disabled
    const rolesBtn = page.locator('.rbac-tab-btn:has-text("Roles")');
    await expect(rolesBtn).toBeVisible();
    await rolesBtn.click();

    const createRoleBtn = page.locator('button:has-text("Create Custom Role")');
    await expect(createRoleBtn).toBeDisabled();
  });

  test('Owner should be able to view, edit, upload, and add API Specifications', async ({ page }) => {
    // 1. Navigate and register standard user
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 2. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // 3. Open API Specifications sub-tab
    const apiSpecsTabBtn = page.locator('button.tab-bar-btn:has-text("API Specifications")');
    await expect(apiSpecsTabBtn).toBeVisible();
    await apiSpecsTabBtn.click();

    // 4. Verify Target Base URL field is editable
    const baseUrlInput = page.locator('input[placeholder="e.g. https://api.production.internal"]');
    await expect(baseUrlInput).toBeVisible();
    await baseUrlInput.fill('http://127.0.0.1:9090');
    await expect(baseUrlInput).toHaveValue('http://127.0.0.1:9090');

    // 5. Verify Swagger URL adding works
    const specUrlInput = page.locator('input[placeholder="https://bbad.secmy.app/swagger.json"]');
    await expect(specUrlInput).toBeVisible();
    
    // Add first URL
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
    const addUrlBtn = page.locator('button:has-text("Add URL")');
    await expect(addUrlBtn).toBeVisible();
    await addUrlBtn.click();

    // Verify it appeared in the list
    const firstUrlItem = page.locator('.specs-url-text:has-text("http://127.0.0.1:8788/swagger.json")').first();
    await expect(firstUrlItem).toBeVisible({ timeout: 10000 });

    // Verify status badge and method count
    const statusBadge = page.locator('.specs-status-badge.status-success').first();
    await expect(statusBadge).toBeVisible({ timeout: 10000 });
    await expect(statusBadge).toHaveText('✓ Active');

    const methodStats = page.locator('.specs-stats').first();
    await expect(methodStats).toBeVisible();
    await expect(methodStats).toHaveText(/\d+ methods/);

    // Verify "Refresh All" button does NOT appear for 1 URL
    const refreshAllBtn = page.locator('button:has-text("Refresh All")');
    await expect(refreshAllBtn).not.toBeVisible();

    // Add second URL
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json?dup=1');
    await addUrlBtn.click();

    // Wait for the second URL to appear in the list
    const secondUrlItem = page.locator('.specs-url-text:has-text("http://127.0.0.1:8788/swagger.json?dup=1")');
    await expect(secondUrlItem).toBeVisible({ timeout: 10000 });
    await expect(refreshAllBtn).not.toBeVisible();

    // Add third URL to trigger "Refresh All" button visibility (> 2 URLs)
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json?dup=2');
    await addUrlBtn.click();

    // Wait for the third URL to appear in the list
    const thirdUrlItem = page.locator('.specs-url-text:has-text("http://127.0.0.1:8788/swagger.json?dup=2")');
    await expect(thirdUrlItem).toBeVisible({ timeout: 10000 });

    // Verify "Refresh All" button is now visible
    await expect(refreshAllBtn).toBeVisible();
    await refreshAllBtn.click();

    // Wait for the Refresh All operation to complete
    const successToast = page.locator('.toast:has-text("Refreshed all specs")');
    await expect(successToast).toBeVisible({ timeout: 15000 });

    // 6. Test file upload functionality
    const filePayload = {
      swagger: "2.0",
      info: { title: "Test E2E Spec", version: "1.0" },
      paths: {
        "/test-fuzz-e2e-upload": {
          get: {
            responses: { "200": { description: "Success" } }
          }
        }
      }
    };

    await page.setInputFiles('input[type="file"]', {
      name: 'test_spec.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(filePayload))
    });

    // Go back to the dashboard to restore the sidebar
    await page.locator('.header-logo').click();

    // Verify the new endpoint has been parsed and loaded in the sidebar
    const uploadedEndpointItem = page.locator('.tree-leaf-row:has-text("/test-fuzz-e2e-upload")');
    await expect(uploadedEndpointItem).toBeVisible({ timeout: 15000 });
  });

});
