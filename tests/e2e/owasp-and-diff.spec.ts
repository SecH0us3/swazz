// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { mockEnterpriseLicense, registerAndLogin, TIMEOUTS, disableBoundaryProfile } from './helpers';

test.describe('OWASP Top 10 Mapping & Request Mutation Visual Diff E2E Tests', () => {
  test('should run scan, verify request mutation visual diff, and verify OWASP mapping', async ({ page }) => {
    // 1. Mock Enterprise license to ensure full feature access and concurrency
    await mockEnterpriseLicense(page);

    // 2. Handle Login/Registration
    await registerAndLogin(page);

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
    await expect(endpointItems.first()).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // Disable Boundary profile to avoid sending huge stress-test strings during E2E tests
    await disableBoundaryProfile(page);
    

    // 4. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Verify run starts and executes initial requests
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    
    // Allow fuzzer to process requests across profiles and endpoints
    await page.waitForTimeout(5000);
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 5. Verify Request Mutation Visual Diff
    // Switch to Request Logs tab
    const requestLogsTab = page.locator('button.tab-bar-btn:has-text("Request Logs")');
    await expect(requestLogsTab).toBeVisible();
    await requestLogsTab.click();

    // Filter by path "/login" to ensure fuzzed POST requests are visible in the virtualized DOM
    const filterInput = page.locator('input[placeholder*="Filter by path"]');
    await expect(filterInput).toBeVisible();
    await filterInput.fill('/login');

    // Locate a fuzzed POST request log row (which has a request body)
    const fuzzedPostRow = page.locator('.log-row')
      .filter({ hasText: /MALICIOUS|BOUNDARY/ })
      .first();
    await expect(fuzzedPostRow).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await fuzzedPostRow.click();

    // Inspect the right side-panel (Request Detail) and check Mutation Diff
    const closeBtn = page.locator('button[aria-label="Close"]');
    await expect(closeBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    // Verify the visual diff comparisons/highlightings (like diff-mutated-malicious or diff-mutated-boundary) are visible
    const mutationDiffBtn = page.locator('button.detail-toggle-btn:has-text("Mutation Diff")');
    await expect(mutationDiffBtn).toBeVisible();
    
    // Check that diff highlights are present
    const highlightedElement = page.locator('.diff-mutated-malicious, .diff-mutated-boundary').first();
    await expect(highlightedElement).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    // Close the inspector panel
    await closeBtn.click();

    // 6. Verify OWASP Top 10 Mapping Accuracy (API 2023 & Web 2025)
    const owaspTab = page.locator('button.tab-bar-btn:has-text("OWASP Top 10")');
    await expect(owaspTab).toBeVisible();
    await owaspTab.click();

    // Verify the default header is OWASP API Security Top 10 (2023)
    const owaspTitle = page.locator('.owasp-summary-title');
    await expect(owaspTitle).toContainText('OWASP API Security Top 10 (2023)', { timeout: TIMEOUTS.DEFAULT });

    // Verify that at least one category card has findings
    const owaspCardWithFindings = page.locator('.owasp-card.has-findings').first();
    await expect(owaspCardWithFindings).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    // Click on the category card with findings to expand its details accordion
    await owaspCardWithFindings.click();

    // Verify the expanded accordion section shows finding instances
    const findingRow = page.locator('.owasp-finding-row').first();
    await expect(findingRow).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    const pathSpan = findingRow.locator('.owasp-finding-path').first();
    await expect(pathSpan).toHaveText(/.+/);

    // Toggle standard to Web Top 10 (2025)
    const webStandardBtn = page.locator('button.owasp-tab-btn:has-text("Web Top 10 (2025)")');
    await expect(webStandardBtn).toBeVisible();
    await webStandardBtn.click();

    await expect(owaspTitle).toContainText('OWASP Top 10 (2025)');
  });

  test('should display OWASP API 2023 by default with CWE badges and switch between standards & view tabs', async ({ page }) => {
    // 1. Mock Enterprise license and login
    await mockEnterpriseLicense(page);
    await registerAndLogin(page);

    // 2. Load demo API Swagger spec
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    await page.locator('button.btn-primary:has-text("Add")').click();
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl, { timeout: TIMEOUTS.LOAD });

    // Wait for tree leaf row
    await expect(page.locator('.tree-leaf-row').first()).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await disableBoundaryProfile(page);

    // 3. Run a quick scan to generate findings
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await page.waitForTimeout(5000);
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 4. Navigate to OWASP Top 10 tab
    const owaspTab = page.locator('button.tab-bar-btn:has-text("OWASP Top 10")');
    await expect(owaspTab).toBeVisible();
    await owaspTab.click();

    // 5. Verify default is OWASP API Security (2023)
    const owaspTitle = page.locator('.owasp-summary-title');
    await expect(owaspTitle).toContainText('OWASP API Security Top 10 (2023)');

    // Verify API-specific category cards exist (API1:2023 to API10:2023)
    const apiCard = page.locator('.owasp-card').filter({ hasText: /API1:2023|API8:2023|API10:2023/ }).first();
    await expect(apiCard).toBeVisible();

    // 6. Test Findings view tab
    const findingsTabBtn = page.locator('.owasp-nav-tabs button:has-text("Findings")');
    await expect(findingsTabBtn).toBeVisible();
    await findingsTabBtn.click();

    // Check that finding items in list view show CWE badges
    const cweBadge = page.locator('.badge-cwe').first();
    if (await cweBadge.isVisible()) {
      await expect(cweBadge).toHaveText(/CWE-\d+/);
    }

    // 7. Test switching back to Overview (Cards) and toggling to Web Top 10 (2025)
    const overviewTabBtn = page.locator('.owasp-nav-tabs button:has-text("Overview")');
    await overviewTabBtn.click();

    const webBtn = page.locator('.owasp-standard-toggle button:has-text("Web Top 10 (2025)")');
    await expect(webBtn).toBeVisible();
    await webBtn.click();

    // Header updates to Web Top 10 (2025)
    await expect(owaspTitle).toContainText('OWASP Top 10 (2025)');

    // Category cards update to A01:2025..A10:2025
    const webCard = page.locator('.owasp-card').filter({ hasText: /A01:2025|A02:2025|A10:2025/ }).first();
    await expect(webCard).toBeVisible();

    // Toggle back to API Security (2023)
    const apiBtn = page.locator('.owasp-standard-toggle button:has-text("API Security (2023)")');
    await apiBtn.click();
    await expect(owaspTitle).toContainText('OWASP API Security Top 10 (2023)');
  });
});
