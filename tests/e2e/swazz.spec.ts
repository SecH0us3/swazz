import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('Swazz Integration E2E Test', () => {
  test('should load dashboard, add vulnerable demo spec, trigger fuzzing, and verify results', async ({ page }) => {
    // Enable diagnostics logging
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));
    page.on('requestfailed', req => console.log(`BROWSER REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));
    page.on('response', res => {
      if (res.status() >= 400) {
        console.log(`BROWSER RESPONSE ERROR: ${res.url()} -> ${res.status()}`);
      }
    });

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
    
    // We assume Vulnerable Demo API runs on port 8788
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // 4. Verify endpoints are populated in the sidebar
    // It should fetch the spec and render the endpoint tree list
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);
    
    // Wait for endpoints list to render
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 5. Verify the target base URL input is populated in the header
    const targetInput = page.locator('input.header-target-input');
    await expect(targetInput).toBeVisible();
    const targetVal = await targetInput.inputValue();
    expect(targetVal).toContain('127.0.0.1:8788');

    // Disable Boundary profile to avoid sending huge stress-test strings during E2E tests
    const boundaryToggle = page.locator('.profile-toggle.boundary');
    await expect(boundaryToggle).toBeVisible();
    await expect(boundaryToggle).toHaveClass(/active/);
    await boundaryToggle.click();
    await expect(boundaryToggle).not.toHaveClass(/active/);

    // 6. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 7. Verify the run starts and logs / heatmap cells are populated
    // Wait for progress logs or stats to change, indicating active execution
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Wait for the heatmap or status codes to start rendering
    const heatmapGrid = page.locator('.heatmap-grid');
    await expect(heatmapGrid).toBeVisible({ timeout: 30000 });

    // Wait for the run to complete (Stop button goes away, or starts showing "Run" again)
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 8. Assert that findings are populated
    // Switch to Grouped Errors tab to view findings
    const findingsTab = page.locator('button.tab-bar-btn:has-text("Grouped Errors")');
    await expect(findingsTab).toBeVisible();
    await findingsTab.click();

    // Click Expand All to render finding items
    const expandAllBtn = page.locator('button:has-text("Expand All")');
    await expect(expandAllBtn).toBeVisible({ timeout: 10000 });
    await expandAllBtn.click();

    // Ensure we see findings like reflected XSS or SQL Injection
    const inspectorItems = page.locator('.finding-item');
    await expect(inspectorItems.first()).toBeVisible({ timeout: 10000 });

    // 9. Download HTML export report
    const downloadTab = page.locator('button.tab-bar-btn:has-text("Download")');
    await expect(downloadTab).toBeVisible();
    await downloadTab.hover();

    const htmlReportBtn = page.locator('button:has-text("HTML Report")');
    await expect(htmlReportBtn).toBeVisible();

    // Start waiting for download before clicking
    const downloadPromise = page.waitForEvent('download');
    await htmlReportBtn.click();
    const download = await downloadPromise;

    // Wait for the download process to complete
    const path = await download.path();
    expect(path).not.toBeNull();

    // Verify downloaded file content (file download verification scenario)
    if (path) {
      const content = fs.readFileSync(path, 'utf8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('Swazz Fuzzing Report');
      expect(content).toContain('noscript-warning');
    }
  });

  test('should load dashboard, click Try Vulnerable Demo button, and verify fuzzing starts and finishes successfully', async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));

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

    // Click Try Vulnerable Demo
    const demoBtn = page.getByRole('button', { name: /Try Vulnerable Demo/ });
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    // 3. Verify endpoints are populated in the sidebar
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 4. Verify target base URL input is populated in the header
    const targetInput = page.locator('input.header-target-input');
    await expect(targetInput).toBeVisible();

    // 5. Verify the run starts and click Stop to finish the test quickly
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 15000 });
    await stopBtn.click();

    // Verify fuzzer has stopped
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible({ timeout: 15000 });
  });
});

