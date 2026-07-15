import { test, expect } from '@playwright/test';

test.describe('Multi-Scan Comparison E2E Tests', () => {
  test('should run multiple scans, select them in History, compare them, and verify comparison data', async ({ page }) => {
    // 1. Navigate to frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Registration
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

    // 3. Add Vulnerable Demo API Swagger Specification
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Verify endpoints are loaded
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // --- Run Scan 1 ---
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for fuzzer to start
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Wait for the first run to complete
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // Disable Boundary profile for run 2 to vary the stats slightly
    const boundaryToggle = page.locator('.profile-toggle.boundary');
    await expect(boundaryToggle).toBeVisible();
    await boundaryToggle.click();

    // --- Run Scan 2 ---
    await startBtn.click();
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 4. Navigate to Scan History
    const historyBtn = page.locator('button:has-text("History")');
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    // Verify history page loads
    await expect(page.locator('h1:has-text("Scan History")')).toBeVisible();

    // Locate the checkboxes for both runs
    const rowCheckboxes = page.locator('.history-row input[type="checkbox"]');
    await expect(rowCheckboxes).toHaveCount(2);

    // 5. Select both runs for comparison
    await rowCheckboxes.nth(0).check();
    await rowCheckboxes.nth(1).check();

    // Floating action bar should slide in
    const compareBar = page.locator('.compare-bar');
    await expect(compareBar).toBeVisible({ timeout: 5000 });

    // 6. Submit comparison
    const submitBtn = page.locator('#compare-scans-submit-btn');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // 7. Verify we transitioned to the Compare tab
    const compareTitle = page.locator('.compare-header-title');
    await expect(compareTitle).toBeVisible();
    await expect(compareTitle).toHaveText('Scan Comparison');

    // 8. Assert comparison metrics and charts are rendered
    const severityChart = page.locator('.compare-chart-card').first();
    await expect(severityChart).toBeVisible();
    
    const coverageCard = page.locator('.compare-metrics-grid .compare-chart-card').nth(1);
    await expect(coverageCard).toBeVisible();
    await expect(coverageCard).toContainText('Coverage Shift');

    // 9. Verify finding list tabs can be toggled
    const newTab = page.locator('#compare-tab-new');
    const fixedTab = page.locator('#compare-tab-fixed');
    
    await expect(newTab).toBeVisible();
    await expect(fixedTab).toBeVisible();

    // 10. Verify filter search can be typed into
    const filterInput = page.locator('#compare-search-input');
    await expect(filterInput).toBeVisible();
    await filterInput.fill('SQL');
  });
});
