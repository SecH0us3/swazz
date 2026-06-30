import { test, expect } from '@playwright/test';

test.describe('Vulnerability Triage and Scan History Persistence E2E Tests', () => {
  test('should complete scan, triage a finding, reload page, restore from history, and verify triage state is persisted', async ({ page }) => {
    // 1. Navigate to frontend
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

    // 3. Add Vulnerable Demo API spec
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Verify endpoints are populated in the sidebar
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);

    // Wait for endpoints list to render to ensure spec is loaded
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // Verify target base URL input is populated in the header
    const targetInput = page.locator('input.header-target-input');
    await expect(targetInput).toBeVisible();
    await expect(targetInput).toHaveValue(/127\.0\.0\.1:8788/);

    // Disable Boundary profile to avoid sending huge stress-test strings during E2E tests
    const boundaryToggle = page.locator('.profile-toggle.boundary');
    await expect(boundaryToggle).toBeVisible();
    await expect(boundaryToggle).toHaveClass(/active/);
    await boundaryToggle.click();
    await expect(boundaryToggle).not.toHaveClass(/active/);

    // 4. Trigger fuzzing by clicking the Start/Run button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for the stop button to appear (scan has started)
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Wait for the run to complete (Start button "Run" is visible again)
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

    // Verify side panel / inspector is open and triage selector is visible
    const triageSelect = page.locator('.request-detail-triage-select');
    await expect(triageSelect).toBeVisible();

    // 6. Change triage state to 'False Positive'
    await triageSelect.selectOption('false_positive');

    // Confirm the ignore rule modal
    const confirmBtn = page.locator('button.btn-primary:has-text("Ignore Finding")');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Assert that the item's opacity fades out and the FP badge is applied instantly
    await expect(firstFinding).toHaveCSS('opacity', '0.6');
    const fpBadge = firstFinding.locator('.badge-warning:has-text("FP")');
    await expect(fpBadge).toBeVisible();

    // Close the detail inspector panel
    const closeInspectorBtn = page.locator('button[aria-label="Close"]');
    await expect(closeInspectorBtn).toBeVisible({ timeout: 10000 });
    await closeInspectorBtn.click();

    // 7. Reload the page
    const configPromiseReload = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromiseReload;

    // 8. Navigate to Scan History in the sidebar
    const historyBtn = page.locator('button:has-text("Scan History")');
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    // Verify scan history loaded
    await expect(page.locator('h1:has-text("Scan History")')).toBeVisible();

    // Load the latest run from the history table (this action automatically redirects back to the dashboard/heatmap tab)
    const loadRunBtn = page.locator('.history-row').first().locator('button:has-text("Load Run")');
    await expect(loadRunBtn).toBeVisible();
    await loadRunBtn.click();

    // Navigate to Grouped Errors and expand all
    await findingsTab.click();
    await expandAllBtn.click();

    // 10. Verify triage state is restored (opacity is 0.6 and FP badge is present)
    const restoredFinding = page.locator('.finding-item').first();
    await expect(restoredFinding).toHaveCSS('opacity', '0.6');
    await expect(restoredFinding.locator('.badge-warning:has-text("FP")')).toBeVisible();
  });
});
