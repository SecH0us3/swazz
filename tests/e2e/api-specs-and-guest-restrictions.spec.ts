import { test, expect } from '@playwright/test';

test.describe('API Specifications and Guest Restrictions E2E Tests', () => {
  
  test('Guest Mode should restrict Member/Role modifications but allow viewing settings', async ({ page }) => {
    // 1. Navigate and log in as Guest
    await page.goto('/');
    const guestBtn = page.getByRole('button', { name: 'Continue as Guest' });
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
    await page.getByRole('button', { name: 'Create' }).click();

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
    const specUrlInput = page.locator('input[placeholder="https://petstore.swagger.io/v2/swagger.json"]');
    await expect(specUrlInput).toBeVisible();
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
    
    const addUrlBtn = page.locator('button:has-text("Add URL")');
    await expect(addUrlBtn).toBeVisible();
    await addUrlBtn.click();

    // Verify it appeared in the list
    const urlItem = page.locator('.specs-url-text:has-text("http://127.0.0.1:8788/swagger.json")');
    await expect(urlItem).toBeVisible({ timeout: 10000 });

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

    // Verify the new endpoint has been parsed and loaded in the sidebar
    const uploadedEndpointItem = page.locator('.tree-leaf-row:has-text("/test-fuzz-e2e-upload")');
    await expect(uploadedEndpointItem).toBeVisible({ timeout: 15000 });
  });

});
