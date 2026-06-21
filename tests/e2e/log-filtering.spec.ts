import { test, expect } from '@playwright/test';

test.describe('Request Log Filters (Status, Path & Identity) E2E Test', () => {
  test('should correctly filter fuzzer request logs by status and path', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.locator('button.link-btn', { hasText: 'Sign up' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Add the Swagger spec of our local Vulnerable Demo API
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);

    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Verify spec is loaded
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);

    // Wait for endpoints list to render
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 4. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 5. Verify run starts and completes
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    // Wait for the fuzzer to complete and Start button to become visible again
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 6. Switch to Request Logs tab
    const requestLogsTab = page.locator('button:has-text("Request Logs")');
    await expect(requestLogsTab).toBeVisible();
    await requestLogsTab.click();

    // Wait for logs list to render
    const logPaths = page.locator('.log-path');
    await expect(logPaths.first()).toBeVisible({ timeout: 10000 });

    // Store original total count of requests
    const countIndicator = page.locator('text=/\\d+ req(s)?/').first();
    await expect(countIndicator).toBeVisible();
    const originalCountText = await countIndicator.textContent();
    expect(originalCountText).not.toBeNull();

    // 7. Test Status Tab Filtering: Click 5xx tab
    const tab5xx = page.locator('.inspector-tab:has-text("5xx")');
    await expect(tab5xx).toBeVisible();
    await tab5xx.click();

    // Verify all visible rows have status-5xx class (wait for first row to be updated)
    const first5xxRow = page.locator('.log-row:not(.log-header)').first();
    await expect(first5xxRow).toHaveClass(/status-5xx/);
    const visible5xxRows = page.locator('.log-row:not(.log-header)');
    const count5xx = await visible5xxRows.count();
    
    // Ensure we actually recorded 5xx crashes
    expect(count5xx).toBeGreaterThan(0);
    for (let i = 0; i < count5xx; i++) {
      const classes = await visible5xxRows.nth(i).getAttribute('class');
      expect(classes).toContain('status-5xx');
    }

    // Go back to "All" tab
    const tabAll = page.locator('.inspector-tab:has-text("All")');
    await expect(tabAll).toBeVisible();
    await tabAll.click();

    // 8. Test Path Filtering: Filter by "/welcome"
    const searchInput = page.locator('input[aria-label="Filter by path"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('/welcome');
    // Wait for the path filter to apply
    const firstFilteredPath = page.locator('.log-path').first();
    await expect(firstFilteredPath).toHaveText(/\/welcome/);

    const filteredLogPaths = page.locator('.log-path');
    const filteredCount = await filteredLogPaths.count();
    expect(filteredCount).toBeGreaterThan(0);
    for (let i = 0; i < filteredCount; i++) {
      const text = await filteredLogPaths.nth(i).textContent();
      expect(text).toContain('/welcome');
    }

    // 9. Test Clear Search button
    const clearSearchBtn = page.locator('button[aria-label="Clear search"]');
    await expect(clearSearchBtn).toBeVisible();
    await clearSearchBtn.click();

    // Verify search is cleared and different endpoints appear again (count goes back up to original)
    await expect(searchInput).toHaveValue('');
    await expect(countIndicator).toHaveText(originalCountText!);
  });
});
