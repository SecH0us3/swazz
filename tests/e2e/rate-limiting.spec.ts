// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { mockEnterpriseLicense, registerAndLogin } from './helpers';

test.describe('Rate Limit Detection & Throttle Control E2E Test', () => {
  test('should detect rate limits and report them in findings', async ({ page }) => {
    // 1. Mock Enterprise license & register user
    await mockEnterpriseLicense(page);
    await page.goto('/');

    // 3. Go to More Project Settings to configure rate limiting and intensity
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    const fuzzingTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing & Performance")');
    await expect(fuzzingTabBtn).toBeVisible();
    await fuzzingTabBtn.click();

    const rateLimitCheckbox = page.locator('label:has-text("Enable Rate Limit Detection") >> input[type="checkbox"]');
    await expect(rateLimitCheckbox).toBeVisible();
    await rateLimitCheckbox.check();
    await expect(rateLimitCheckbox).toBeChecked();

    const burstSizeInput = page.locator('label:has-text("Burst Size") + input');
    await expect(burstSizeInput).toBeVisible();
    await burstSizeInput.fill('25');

    // Switch to Fuzzing & Intensity sub-tab
    const fuzzingSubTabBtn = page.locator('button.performance-subtab-btn:has-text("Fuzzing & Intensity")');
    await expect(fuzzingSubTabBtn).toBeVisible();
    await fuzzingSubTabBtn.click();

    const iterationsInput = page.locator('label:has-text("Fuzzing Intensity") + input');
    await expect(iterationsInput).toBeVisible();
    await iterationsInput.fill('1');

    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const saveBtn = page.locator('button:has-text("Save Configuration")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const successMsg = page.locator('text=/Configuration updated successfully/');
    await expect(successMsg).toBeVisible();

    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    const profilesSection = page.locator('.sidebar-section:has-text("Profiles")');
    await expect(profilesSection).toBeVisible();
    const boundaryToggle = profilesSection.locator('.profile-toggle.boundary');
    const maliciousToggle = profilesSection.locator('.profile-toggle.malicious');

    try {
      // Disable boundary and malicious profiles
      await boundaryToggle.click();
      await expect(boundaryToggle).not.toHaveClass(/active/);

      await maliciousToggle.click();
      await expect(maliciousToggle).not.toHaveClass(/active/);

      // Add Swagger spec URL
      const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
      await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
      const addBtn = page.locator('button.btn-primary:has-text("Add")');
      await addBtn.click();

      // Wait for endpoints list to render
      const endpointItems = page.locator('.tree-leaf-row');
      await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

      // Run fuzzer
      const startBtn = page.locator('#btn-start');
      await expect(startBtn).toBeVisible();
      await startBtn.click();

      // Wait for the fuzzer to start (button becomes hidden) to prevent race conditions
      await expect(startBtn).toBeHidden();

      // Wait for the fuzzer to complete (timeout of 120s max)
      await expect(startBtn).toBeVisible({ timeout: 120000 });

      // 4. Verify that 'Missing Rate Limiting' (swazz/no-rate-limit) Finding was detected on /users
      const requestLogsTab = page.locator('button.tab-bar-btn:has-text("Request Logs")');
      await expect(requestLogsTab).toBeVisible();
      await requestLogsTab.click();

      // Filter by /users
      const filterInput = page.locator('input[placeholder*="Filter by path"]');
      await expect(filterInput).toBeVisible();
      await filterInput.fill('/users');

      // Click on the rate limit log row (indicated by RATE-LIMIT profile)
      const rateLimitLogRow = page.locator('.log-row').filter({ hasText: 'RATE-LIMIT' }).first();
      await expect(rateLimitLogRow).toBeVisible({ timeout: 15000 });
      await rateLimitLogRow.click();

      // Verify the details sidebar contains "swazz/no-rate-limit"
      const detailsInspector = page.locator('.modal-pane:has-text("Request Details")');
      await expect(detailsInspector).toBeVisible();

      // Switch to the Alerts & Findings tab to see the analyzer finding
      await page.getByRole('tab', { name: /Alerts & Findings/ }).click();

      const findingBanner = page.locator('.alert-banner-header:has-text("swazz/no-rate-limit")');
      await expect(findingBanner).toBeVisible({ timeout: 10000 });

      const closeBtn = page.locator('button[aria-label="Close"]');
      await closeBtn.click();

    } finally {
      // Cleanup: Restore default configurations to prevent state pollution
      // Dismiss any open Request Detail modal/inspector panels so they do not block pointer events on the sidebar
      await page.keyboard.press('Escape');
      
      if (await backBtn.isVisible()) {
        const boundaryClass = await boundaryToggle.getAttribute('class');
        if (boundaryClass && !boundaryClass.includes('active')) {
          await boundaryToggle.click();
        }
        const maliciousClass = await maliciousToggle.getAttribute('class');
        if (maliciousClass && !maliciousClass.includes('active')) {
          await maliciousToggle.click();
        }
      }
    }
  });
});
