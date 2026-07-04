import { test, expect } from '@playwright/test';

test.describe('Ignore Rules configuration and persistence E2E Tests', () => {
  test('should triage finding and check ignore rule scopes & auto cleanup', async ({ page }) => {
    // 1. Navigate to frontend
    await page.goto('/');

    // 2. Register unique user (username matching length requirements)
    await page.getByRole('button', { name: 'Create' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

    // 3. Add Vulnerable Demo API spec
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 4. Trigger fuzzing
    // Disable Boundary profile to avoid sending huge stress-test strings during E2E tests
    const boundaryToggle = page.locator('.profile-toggle.boundary');
    await expect(boundaryToggle).toBeVisible();
    await expect(boundaryToggle).toHaveClass(/active/);
    await boundaryToggle.click();
    await expect(boundaryToggle).not.toHaveClass(/active/);

    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for the run to complete
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 5. Navigate to Grouped Errors tab
    const findingsTab = page.locator('button.tab-bar-btn:has-text("Grouped Errors")');
    await expect(findingsTab).toBeVisible();
    await findingsTab.click();

    // Click Expand All to render finding items
    const expandAllBtn = page.locator('button:has-text("Expand All")');
    await expect(expandAllBtn).toBeVisible({ timeout: 10000 });
    await expandAllBtn.click();

    // Select the first finding item
    const firstFinding = page.locator('.finding-item').first();
    await expect(firstFinding).toBeVisible({ timeout: 10000 });
    await firstFinding.click();

    // Verify detail panel and triage selector
    const triageSelect = page.locator('.request-detail-triage-select');
    await expect(triageSelect).toBeVisible();

    // 6. Select "ignored" triage
    await triageSelect.selectOption('ignored');

    // Verify Ignore Rule modal opens
    const modalTitle = page.locator('.ignore-modal-content h2:has-text("Add Ignore Rule")');
    await expect(modalTitle).toBeVisible();

    // Select 'all' scope (Everywhere) and confirm
    await page.locator('input[name="ignore-scope"][value="all"]').click();
    const confirmBtn = page.locator('button.btn-primary:has-text("Ignore Finding")');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Modal should disappear
    await expect(modalTitle).not.toBeVisible();

    // Verify opacity & IG badge on dashboard
    await expect(firstFinding).toHaveCSS('opacity', '0.6');
    const igBadge = firstFinding.locator('.badge:has-text("Ignored")');
    await expect(igBadge).toBeVisible();

    // Close the detail inspector panel
    const closeInspectorBtn = page.locator('button[aria-label="Close"]');
    await expect(closeInspectorBtn).toBeVisible();
    await closeInspectorBtn.click();

    // Wait for the 1.5s debounced config sync to finish persisting to the backend API
    await page.waitForTimeout(2000);

    // 7. Verify the ignore rule is synced to project settings raw config
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();

    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      rules: {
        ignore_rules: [
          {
            endpoint: '**',
          }
        ]
      }
    });

    // 8. Go back to Dashboard and untriage (set back to none)
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    await findingsTab.click();
    await expandAllBtn.click();
    await firstFinding.click();

    await triageSelect.selectOption('none');

    // Close the detail inspector panel
    await closeInspectorBtn.click();

    // Opacity goes back to 1
    await expect(firstFinding).toHaveCSS('opacity', '1');
    await expect(igBadge).not.toBeVisible();

    // Wait for the cleanup config sync to finish persisting to the backend API
    await page.waitForTimeout(2000);

    // Verify rule was automatically cleaned up from settings
    await moreSettingsBtn.click();
    await rawConfigTabBtn.click();

    await expect.poll(async () => {
      try {
        const parsed = JSON.parse(await rawTextarea.inputValue());
        return parsed.rules?.ignore_rules || [];
      } catch {
        return [];
      }
    }).toEqual([]);
  });
});
