// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';

test.describe('Sidebar Endpoint Tree Filtering E2E Test', () => {
  test('should exclude checked-out endpoints from fuzzing scope', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

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

    // 4. Search for the /login endpoint in the sidebar endpoint tree
    const searchInput = page.locator('input[placeholder="Search endpoints..."]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('/login');

    // Locate the checkbox for POST /login and uncheck it
    const loginCheckbox = page.locator('input[aria-label="Enable endpoint POST /login"]');
    await expect(loginCheckbox).toBeVisible();
    // Verify it is checked initially
    expect(await loginCheckbox.isChecked()).toBe(true);
    // Uncheck it
    await loginCheckbox.uncheck();
    // Verify it is unchecked
    expect(await loginCheckbox.isChecked()).toBe(false);

    // Optionally clear the search input to see other endpoints
    await searchInput.fill('');

    // 5. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 6. Verify run starts and completes (wait for the run to finish)
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    // Wait for the fuzzer to complete and Start button to become visible again
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 7. Verify that no request targeting "POST /login" was executed
    // Switch to Request Logs tab
    const requestLogsTab = page.locator('button:has-text("Request Logs")');
    await expect(requestLogsTab).toBeVisible();
    await requestLogsTab.click();

    // Check all log rows under Request Logs tab
    const logPaths = page.locator('.log-path');
    await expect(logPaths.first()).toBeVisible({ timeout: 10000 });
    const logCount = await logPaths.count();
    
    // Ensure we have fuzzed other endpoints (there are logs present)
    expect(logCount).toBeGreaterThan(0);

    // Check each log row path to confirm /login is not present
    for (let i = 0; i < logCount; i++) {
      const text = await logPaths.nth(i).textContent();
      expect(text).not.toContain('/login');
    }
  });

  test('should toggle "Included Only" filter to hide/show excluded endpoints', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

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

    // Locate "Included Only" toggle button (aria-label: "Filter included endpoints only")
    const includedOnlyBtn = page.getByRole('button', { name: /Filter included endpoints/i });
    await expect(includedOnlyBtn).toBeVisible();

    // Locate checkbox for POST /login and uncheck it
    const loginCheckbox = page.locator('input[aria-label="Enable endpoint POST /login"]');
    await expect(loginCheckbox).toBeVisible();
    expect(await loginCheckbox.isChecked()).toBe(true);
    await loginCheckbox.uncheck();
    expect(await loginCheckbox.isChecked()).toBe(false);

    // Click "Included Only" toggle button to filter out excluded endpoints
    await includedOnlyBtn.click();

    // Verify POST /login row is hidden from sidebar endpoint tree while other included endpoints remain visible
    await expect(loginCheckbox).not.toBeVisible();
    await expect(endpointItems.first()).toBeVisible();

    // Click "Included Only" toggle button again to deactivate filter
    await includedOnlyBtn.click();

    // Verify POST /login reappears in tree view as disabled/unchecked
    await expect(loginCheckbox).toBeVisible();
    expect(await loginCheckbox.isChecked()).toBe(false);
  });
});

