// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { mockEnterpriseLicense, registerAndLogin, TIMEOUTS, disableBoundaryProfile } from './helpers';

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

    // 1. Mock Enterprise license & register user
    await mockEnterpriseLicense(page);
    await registerAndLogin(page);

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
    await expect(endpointItems.first()).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 5. Verify the target base URL input is populated in the header
    const targetInput = page.locator('input.header-target-input');
    await expect(targetInput).toBeVisible();
    const targetVal = await targetInput.inputValue();
    expect(targetVal).toContain('127.0.0.1:8788');

    // Disable Boundary profile to avoid sending huge stress-test strings during E2E tests
    await disableBoundaryProfile(page);
    

    // 6. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 7. Verify the run starts and allow fuzzer to process initial requests
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await page.waitForTimeout(5000);
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 8. Assert that findings are populated
    // Switch to Findings tab to view findings
    const findingsTab = page.locator('button.tab-bar-btn:has-text("Findings")');
    await expect(findingsTab).toBeVisible();
    await findingsTab.click();

    // Click Expand All to render finding items
    const expandAllBtn = page.locator('button:has-text("Expand All")');
    await expect(expandAllBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expandAllBtn.click();

    // Ensure we see findings like reflected XSS or SQL Injection
    const inspectorItems = page.locator('.finding-item');
    await expect(inspectorItems.first()).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

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

    // 1. Mock Enterprise license & register user
    await mockEnterpriseLicense(page);
    await registerAndLogin(page);

    // Click Try Vulnerable Demo
    const demoBtn = page.getByRole('button', { name: /Try Vulnerable Demo/ });
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    // 3. Verify endpoints are populated in the sidebar
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 4. Verify target base URL input is populated in the header
    const targetInput = page.locator('input.header-target-input');
    await expect(targetInput).toBeVisible();

    // 5. Verify the run starts and click Stop to finish the test quickly
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await stopBtn.click();

    // Verify fuzzer has stopped
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });
  });
});

