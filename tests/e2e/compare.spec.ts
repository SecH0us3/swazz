// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { mockEnterpriseLicense, registerAndLogin , TIMEOUTS, disableBoundaryProfile} from './helpers';

test.describe('Multi-Scan Comparison E2E Tests', () => {
  test('should run two scans with different configurations, compare results, and display diff analytics', async ({ page }) => {
    // 1. Mock Enterprise license & register user
    await mockEnterpriseLicense(page);
    await registerAndLogin(page);

    // 2. Add Swagger spec of local Vulnerable Demo API
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);

    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Verify spec is loaded
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);

    // Wait for endpoints tree to render
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // Disable Boundary profile for run 1 to avoid massive payload generation
    await disableBoundaryProfile(page);

    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for fuzzer to start
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    // Wait for the first run to complete
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.SCAN_RUN });

    // Disable Malicious profile (since Boundary is already disabled) for run 2 to vary the stats slightly
    const maliciousToggle = page.locator('.profile-toggle.malicious');
    
    await maliciousToggle.evaluate((node) => node.click());

    // --- Run Scan 2 ---
    await startBtn.click();
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.SCAN_RUN });

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
    await expect(compareBar).toBeVisible({ timeout: TIMEOUTS.SHORT });

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
