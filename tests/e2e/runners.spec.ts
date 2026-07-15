import { test, expect } from '@playwright/test';

test.describe('Distributed Fuzzing Agents Version Display E2E Test', () => {
  test('should navigate to runners settings tab and verify active runner version', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open "Project Settings" page from the right Config Sidebar
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // Verify Project Settings page is loaded
    await expect(page.locator('h1:has-text("Project Settings")')).toBeVisible();

    // 4. Click the "Active Runners" sub-tab in the project settings
    const activeRunnersTab = page.locator('button.tab-bar-btn:has-text("Active Runners")');
    await expect(activeRunnersTab).toBeVisible();
    await activeRunnersTab.click();

    // 5. Verify the connected local runner (runner-*) is visible in the table
    const runnerNameEl = page.locator('.runner-name').first();
    await expect(runnerNameEl).toBeVisible({ timeout: 15000 });
    const nameText = await runnerNameEl.textContent();
    expect(nameText).toMatch(/^runner-/);

    // 6. Verify the version badge/tag is visible next to the agent name
    const versionBadgeEl = page.locator('.runner-version-badge').first();
    await expect(versionBadgeEl).toBeVisible();
    const versionText = await versionBadgeEl.textContent();

    // 7. Assert that the version tag matches semantic versioning format (e.g. v1.0.0)
    expect(versionText).toMatch(/^v\d+\.\d+\.\d+/);
  });

  test('should not show restart button for shared runners', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open "Project Settings" page from the right Config Sidebar
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // Verify Project Settings page is loaded
    await expect(page.locator('h1:has-text("Project Settings")')).toBeVisible();

    // 4. Click the "Active Runners" sub-tab in the project settings
    const activeRunnersTab = page.locator('button.tab-bar-btn:has-text("Active Runners")');
    await expect(activeRunnersTab).toBeVisible();
    await activeRunnersTab.click();

    // 5. Verify the connected local runner is visible
    const runnerNameEl = page.locator('.runner-name').first();
    await expect(runnerNameEl).toBeVisible({ timeout: 15000 });

    // 6. Assert that no "Restart" button is visible in the row for this runner
    const restartBtn = page.locator('button:has-text("Restart")');
    await expect(restartBtn).not.toBeVisible();
  });
});
