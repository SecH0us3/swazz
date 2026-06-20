import { test, expect } from '@playwright/test';

test.describe('OWASP Top 10 Mapping & Request Mutation Visual Diff E2E Tests', () => {
  test('should run scan, verify request mutation visual diff, and verify OWASP mapping', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user (limit to < 20 characters)
    const signUpLink = page.locator('button.link-btn:has-text("Sign up")');
    if (await signUpLink.isVisible()) {
      await signUpLink.click();
    }

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');

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

    // 4. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Verify run starts and completes
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    // Wait for the fuzzer to complete and Start button to become visible again
    await expect(startBtn).toBeVisible({ timeout: 60000 });

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
    await expect(fuzzedPostRow).toBeVisible({ timeout: 10000 });
    await fuzzedPostRow.click();

    // Inspect the right side-panel (Request Detail) and check Mutation Diff
    const closeBtn = page.locator('button[aria-label="Close"]');
    await expect(closeBtn).toBeVisible({ timeout: 10000 });

    // Verify the visual diff comparisons/highlightings (like diff-mutated-malicious or diff-mutated-boundary) are visible
    const mutationDiffBtn = page.locator('button.detail-toggle-btn:has-text("Mutation Diff")');
    await expect(mutationDiffBtn).toBeVisible();
    
    // Check that diff highlights are present
    const highlightedElement = page.locator('.diff-mutated-malicious, .diff-mutated-boundary').first();
    await expect(highlightedElement).toBeVisible({ timeout: 10000 });

    // Close the inspector panel
    await closeBtn.click();

    // 6. Verify OWASP Top 10 Mapping Accuracy
    const owaspTab = page.locator('button.tab-bar-btn:has-text("OWASP Top 10")');
    await expect(owaspTab).toBeVisible();
    await owaspTab.click();

    // Verify the summary banner displays findings detected
    const summaryBanner = page.locator('.owasp-summary-count');
    await expect(summaryBanner).toHaveText(/\d+ Finding[s]? Detected/, { timeout: 10000 });

    // Verify that at least one category card (e.g. A05:2025 Injection or A10:2025 Mishandling of Exceptional Conditions) has findings
    const owaspCardWithFindings = page.locator('.owasp-card.has-findings').first();
    await expect(owaspCardWithFindings).toBeVisible({ timeout: 10000 });

    // Click on the category card with findings to expand its details accordion
    await owaspCardWithFindings.click();

    // Verify the expanded accordion section shows the correct finding instances
    const findingRow = page.locator('.owasp-finding-row').first();
    await expect(findingRow).toBeVisible({ timeout: 10000 });

    const pathSpan = findingRow.locator('.owasp-finding-path').first();
    await expect(pathSpan).toHaveText(/.+/);
  });
});
