import { test, expect } from '@playwright/test';

async function expandSection(page: any, sectionTitle: string) {
  const sectionHeader = page.locator(`.sidebar-section:has-text("${sectionTitle}") >> .sidebar-section-header`).first();
  await expect(sectionHeader).toBeVisible();
  if (await sectionHeader.getAttribute('aria-expanded') === 'false') {
    await sectionHeader.click();
  }
}

async function fillKVRow(row: any, key: string, value: string) {
  const keyInput = row.locator('input[placeholder="Header"], input[placeholder="Name"], input[placeholder="Key"]');
  await keyInput.fill(key);
  await keyInput.press('Tab');
  await expect(keyInput).toHaveValue(key);
  
  const valInput = row.locator('input[placeholder="Value"]');
  await valInput.fill(value);
  await valInput.press('Tab');
  await expect(valInput).toHaveValue(value);
}

test.describe('BOLA / Multi-Identity vulnerability testing E2E Test', () => {
  test('should run scan with User A and User B credentials and detect BOLA/IDOR vulnerability', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.locator('button.link-btn:has-text("Sign up")').click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    // Wait for the config to be loaded and populated in localStorage
    await page.waitForFunction(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('swazz:config:')) {
          return true;
        }
      }
      return false;
    }, { timeout: 15000 });

    // Set Intensity to 1 to speed up fuzzer run and make E2E test reliable/fast
    const profilesSection = page.locator('.sidebar-section:has-text("Profiles")');
    await expect(profilesSection).toBeVisible();
    const intensityInput = profilesSection.locator('input[type="number"]').first();
    await expect(intensityInput).toBeVisible();
    await intensityInput.fill('1');
    await expect(intensityInput).toHaveValue('1');

    // Disable BOUNDARY and MALICIOUS profiles, leaving only RANDOM profile active to keep request counts minimal
    const boundaryToggle = profilesSection.locator('.profile-toggle.boundary');
    if (await boundaryToggle.evaluate(el => el.classList.contains('active'))) {
      await boundaryToggle.click();
      await expect(boundaryToggle).not.toHaveClass(/active/);
    }
    const maliciousToggle = profilesSection.locator('.profile-toggle.malicious');
    if (await maliciousToggle.evaluate(el => el.classList.contains('active'))) {
      await maliciousToggle.click();
      await expect(maliciousToggle).not.toHaveClass(/active/);
    }

    // 3. Configure Headers for User A (Primary Session)
    await expandSection(page, 'Headers (User A / Primary Session)');
    const userASection = page.locator('.sidebar-section:has-text("Headers (User A / Primary Session)")');
    const userAAddBtn = userASection.locator('.kv-add');
    await expect(userAAddBtn).toBeVisible();
    await userAAddBtn.click();

    // Fill key/value in the newly added row
    const lastRowA = userASection.locator('.kv-row').last();
    await fillKVRow(lastRowA, 'Authorization', 'Bearer user1-token');

    // Verify it starts as an auth token (locked) by default
    const authToggleA = lastRowA.locator('button.kv-auth-toggle');
    await expect(authToggleA).toHaveClass(/is-auth/);

    // Test toggling it off (unlocking)
    await authToggleA.click();
    await expect(authToggleA).not.toHaveClass(/is-auth/);

    // Test toggling it back on (locking)
    await authToggleA.click();
    await expect(authToggleA).toHaveClass(/is-auth/);

    // 4. Configure BOLA / Multi-Identity Settings and User B (Secondary Session)
    await expandSection(page, 'BOLA / Multi-Identity');
    const bolaSection = page.locator('.sidebar-section:has-text("BOLA / Multi-Identity")');
    const bolaCheckbox = bolaSection.locator('label:has(span:has-text("Enable BOLA & Bypass Testing")) >> input[type="checkbox"]');
    await expect(bolaCheckbox).toBeVisible();
    await bolaCheckbox.check();
    await expect(bolaCheckbox).toBeChecked();

    // Verify Warning is gone (since Authorization is marked as auth token)
    const warningBox = bolaSection.locator('.bola-warning-box');
    await expect(warningBox).not.toBeVisible();

    // Configure headers for User B
    const userBHeaders = page.locator('div.bola-sub-title:has-text("Headers (User B)") + .kv-editor');
    await expect(userBHeaders.locator('.kv-add')).toBeVisible();
    await userBHeaders.locator('.kv-add').click();

    const lastRowB = userBHeaders.locator('.kv-row').last();
    await fillKVRow(lastRowB, 'Authorization', 'Bearer user2-token');

    // 5. Add the Swagger spec of our local Vulnerable Demo API
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

    // 6. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Verify run starts and completes
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    // Wait for the fuzzer to complete and Start button to become visible again
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 7. Verify BOLA findings under OWASP Top 10 tab
    const owaspTab = page.locator('button.tab-bar-btn:has-text("OWASP Top 10")');
    await expect(owaspTab).toBeVisible();
    await owaspTab.click();

    // Verify summary count reflects finding(s)
    const summaryBanner = page.locator('.owasp-summary-count');
    await expect(summaryBanner).toHaveText(/\d+ Finding[s]? Detected/, { timeout: 10000 });

    // Find and expand A01:2025 Broken Access Control category card
    const bolaCard = page.locator('.owasp-card:has-text("A01:2025")');
    await expect(bolaCard).toBeVisible({ timeout: 10000 });
    await expect(bolaCard).toHaveClass(/has-findings/);
    await bolaCard.click();

    // Check that a BOLA finding on /api/goods/ exists in the expanded accordion
    const findingRow = page.locator('.owasp-accordion:has-text("A01:2025") .owasp-finding-row').filter({ hasText: '/api/goods/' }).first();
    await expect(findingRow).toBeVisible({ timeout: 10000 });
    await findingRow.click();

    // Inspect the right side-panel (Request Detail) for BOLA details
    const closeBtn = page.locator('button[aria-label="Close"]');
    await expect(closeBtn).toBeVisible({ timeout: 10000 });

    // Close the inspector panel
    await closeBtn.click();
  });
});
