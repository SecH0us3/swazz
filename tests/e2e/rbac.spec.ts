import { test, expect } from '@playwright/test';

test.describe('RBAC and Project Invitations E2E Tests', () => {
  test('should create custom roles, validate inputs, invite a user, and accept invitation', async ({ page, context }) => {
    // 1. Navigate to the frontend dev server and register User A (Owner)
    await page.goto('/');

    const createAccountBtn = page.getByRole('button', { name: 'Create' });
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

    // 4. Go to Roles sub-view
    const rolesBtn = page.locator('.rbac-tab-btn:has-text("Roles")');
    await expect(rolesBtn).toBeVisible();
    await rolesBtn.click();

    // Verify default roles (Owner, Editor, Viewer) are listed
    await expect(page.locator('.rbac-role-card:has-text("Owner")')).toBeVisible();
    await expect(page.locator('.rbac-role-card:has-text("Editor")')).toBeVisible();
    await expect(page.locator('.rbac-role-card:has-text("Viewer")')).toBeVisible();

    // 5. Create a Custom Role
    const createRoleBtn = page.locator('button:has-text("Create Custom Role")');
    await expect(createRoleBtn).toBeVisible();
    await createRoleBtn.click();

    // Verify Create Custom Role modal is open
    await expect(page.locator('.rbac-modal-content:has-text("Create Custom Role")')).toBeVisible();

    const customRoleName = 'Custom Auditor';
    await page.locator('input[placeholder="e.g. Audit Viewer"]').fill(customRoleName);

    // Select "Viewer" to inherit from
    const inheritCheckbox = page.locator('.rbac-checkbox-item:has-text("Viewer") input[type="checkbox"]');
    await expect(inheritCheckbox).toBeVisible();
    await inheritCheckbox.check();

    // Assign "Start new scans" permission
    const scanPermCheckbox = page.locator('.rbac-checkbox-item:has-text("Start new scans") input[type="checkbox"]');
    await expect(scanPermCheckbox).toBeVisible();
    await scanPermCheckbox.check();

    // Submit Custom Role creation
    const submitRoleBtn = page.locator('.rbac-modal-footer button:has-text("Create Role")');
    await expect(submitRoleBtn).toBeVisible();
    await submitRoleBtn.click();

    // Verify custom role is added to the list
    await expect(page.locator(`.rbac-role-card:has-text("${customRoleName}")`)).toBeVisible({ timeout: 10000 });

    // 6. Invite User B with the custom role
    const membersBtn = page.locator('.rbac-tab-btn:has-text("Members")');
    await expect(membersBtn).toBeVisible();
    await membersBtn.click();

    const inviteBtn = page.locator('button:has-text("Invite User")');
    await expect(inviteBtn).toBeVisible();
    await inviteBtn.click();

    // Verify Invite modal is open
    await expect(page.locator('.rbac-modal-content:has-text("Invite User")')).toBeVisible();

    const usernameB = `u${(Date.now() + 1).toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('input[placeholder="user@example.com"]').fill(usernameB);

    // Select the newly created custom role
    const customRoleCheckbox = page.locator(`.rbac-checkbox-item:has-text("${customRoleName}") input[type="checkbox"]`);
    await expect(customRoleCheckbox).toBeVisible();
    await customRoleCheckbox.check();

    // Intercept invite creation API response to retrieve the invitation token
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/projects/') && res.url().includes('/invitations') && res.request().method() === 'POST'),
      page.locator('.rbac-modal-footer button:has-text("Send Invite")').click()
    ]);
    const { token: inviteToken } = await response.json();
    expect(inviteToken).toBeDefined();

    // 7. Log out User A
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const logoutBtn = page.locator('button:has-text("Logout")');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Wait for login screen to reappear
    await expect(createAccountBtn).toBeVisible();

    // 8. Register User B
    await page.locator('#username').fill(usernameB);
    await page.locator('#password').fill('Password123!');
    await createAccountBtn.click();

    // Wait for the main dashboard to load for User B
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 9. Navigate to the invitation URL (using the token query parameter) to trigger invitation acceptance
    await page.goto(`/?token=${inviteToken}`);

    // Wait for toast notification confirming invitation acceptance
    await expect(page.locator('.toast:has-text("Invitation accepted successfully")')).toBeVisible({ timeout: 10000 });

    // 10. Verify that User B now has access to the project settings of the invited project
    // (Open project settings to verify User B has custom roles)
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();
    await expect(settingsHeader).toBeVisible();

    await expect(membersRolesTabBtn).toBeVisible();
    await membersRolesTabBtn.click();
    
    // Check that User B is listed in the members list with the custom role
    await expect(page.locator(`.rbac-table tr:has-text("${usernameB}"):has-text("${customRoleName}")`)).toBeVisible();
  });
});
