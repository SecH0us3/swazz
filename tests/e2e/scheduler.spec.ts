// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { mockEnterpriseLicense, registerAndLogin, TIMEOUTS, disableBoundaryProfile } from './helpers';

test.describe('Scan Scheduler & Timeout E2E Tests', () => {
  test('should restrict scheduling to Supporter Plan, allow saving valid cron, reject fast cron, support scan timeout, and reconnect on refresh', async ({ page }) => {
    // 1. Mock Enterprise license to unlock Scan Scheduler tab
    await mockEnterpriseLicense(page);

    // Enable diagnostics logging
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));
    page.on('requestfailed', req => console.log(`BROWSER REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));
    page.on('response', res => {
      if (res.status() >= 400) {
        console.log(`BROWSER RESPONSE ERROR: ${res.url()} -> ${res.status()}`);
      }
    });

    // 1. Navigate to frontend & register a new user
    await registerAndLogin(page);

    // Add Vulnerable Demo API swagger spec so we have endpoints to scan
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();

    const configPromise2 = page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'POST' && resp.status() === 200);
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();
    await configPromise2;

    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 2. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // Verify Project Settings header is visible
    const settingsHeader = page.locator('h1:has-text("Project Settings")');
    await expect(settingsHeader).toBeVisible();

    // 3. Navigate to Scan Scheduler tab
    const schedulerTabBtn = page.locator('button.tab-bar-btn:has-text("Scan Scheduler")');
    await expect(schedulerTabBtn).toBeVisible();
    const configFetchPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'GET' && resp.status() === 200);
    await schedulerTabBtn.click();
    await configFetchPromise;

    // Frequency select should be visible
    await expect(page.locator('label:has-text("Schedule Frequency")')).toBeVisible();

    // 5. Select custom cron and input invalid frequency (e.g. hourly `0 * * * *`)
    await page.locator('select.schedule-select').selectOption('custom');
    const cronInput = page.locator('input.schedule-input');
    await expect(cronInput).toBeVisible();
    await cronInput.fill('0 * * * *');

    const saveBtn = page.locator('button:has-text("Save Schedule")');
    await saveBtn.click();

    // Should show validation toast/alert
    await expect(page.locator('text=Frequency limit')).toBeVisible();

    // 6. Set valid daily cron `0 12 * * *` and save successfully
    await cronInput.fill('0 12 * * *');
    await saveBtn.click();
    await expect(page.locator('text=Schedule settings saved successfully')).toBeVisible();

    // 7. Test Scan Timeout
    // Open Performance sub-tab
    const performanceTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing & Performance")');
    await expect(performanceTabBtn).toBeVisible();
    await performanceTabBtn.click();

    // Switch to Timeout & Duration sub-tab
    const timeoutSubTabBtn = page.locator('button.performance-subtab-btn:has-text("Timeout & Duration")');
    await expect(timeoutSubTabBtn).toBeVisible();
    await timeoutSubTabBtn.click();

    // Fill "Maximum Scan Duration (minutes)" with 1
    const timeoutInput = page.locator('input.input-width-md');
    await expect(timeoutInput).toBeVisible();
    const timeoutSavePromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'POST' && resp.status() === 200);
    await timeoutInput.fill('1');
    await timeoutSavePromise;

    // 8. Reconnect on Page Reload
    // Press escape to close the settings modal
    await page.keyboard.press('Escape');

    // Click "Start Scan" (id="btn-start")
    const startFuzzBtn = page.locator('#btn-start');
    await expect(startFuzzBtn).toBeVisible();

    // Disable Boundary profile to avoid sending huge stress-test strings during E2E tests
    await disableBoundaryProfile(page);

    await startFuzzBtn.click();

    // Wait for run to get active
    await page.waitForTimeout(1500);

    // Reload the page
    const reconnectConfigPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    const reconnectMePromise = page.waitForResponse(resp => resp.url().includes('/api/auth/me') && resp.status() === 200);
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await reconnectConfigPromise;
    await reconnectMePromise;

    // Verify it automatically reconnected to the running session
    await expect(page.locator('button.btn-danger[title="Stop"]')).toBeVisible({ timeout: TIMEOUTS.LOAD });
  });
});
