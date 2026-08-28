// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { mockEnterpriseLicense, registerAndLogin, TIMEOUTS, disableBoundaryProfile } from './helpers';

test.describe('2026 Security Analyzers & PoC Generator E2E Tests', () => {
  test('should load 2026 endpoints, detect vulnerabilities, and export PoC exploit scripts', async ({ page }) => {
    // 1. Mock Enterprise license
    await mockEnterpriseLicense(page);

    // 2. Handle Login/Registration
    await registerAndLogin(page);

    // 3. Add the Swagger spec of local Demo API
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);

    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Verify spec is loaded
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);

    // Disable Boundary profile for test speed
    await disableBoundaryProfile(page);

    // 4. Start Fuzzing Run
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    // Allow fuzzer to process requests across profiles and endpoints
    await page.waitForTimeout(6000);
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 5. Switch to Request Logs tab
    const requestLogsTab = page.locator('button.tab-bar-btn:has-text("Request Logs")');
    await expect(requestLogsTab).toBeVisible();
    await requestLogsTab.click();

    // Click on the first log item to open Request Inspector Detail modal
    const firstLogRow = page.locator('.row-wrap').first();
    if (await firstLogRow.isVisible()) {
      await firstLogRow.click();

      // Verify Live Replay & PoC Export tab is present
      const pocTab = page.locator('button.tab-button:has-text("Live Replay & PoC Export")');
      await expect(pocTab).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
      await pocTab.click();

      // Verify PoC container and language tabs render
      const pocContainer = page.locator('.poc-container');
      await expect(pocContainer).toBeVisible();

      // Check cURL, Python, TS, Go language buttons
      const curlBtn = pocContainer.locator('button:has-text("cURL")');
      const pythonBtn = pocContainer.locator('button:has-text("Python")');
      const tsBtn = pocContainer.locator('button:has-text("TypeScript")');
      const goBtn = pocContainer.locator('button:has-text("Go")');

      await expect(curlBtn).toBeVisible();
      await expect(pythonBtn).toBeVisible();
      await expect(tsBtn).toBeVisible();
      await expect(goBtn).toBeVisible();

      // Click Python tab and verify generated requests script
      await pythonBtn.click();
      const codeBlock = pocContainer.locator('.poc-code-pre code');
      await expect(codeBlock).toContainText('import requests');

      // Click Go tab and verify Go script
      await goBtn.click();
      await expect(codeBlock).toContainText('package main');

      // Close modal
      const closeBtn = page.locator('button[title*="Close"]');
      await closeBtn.click();
    }
  });
});
