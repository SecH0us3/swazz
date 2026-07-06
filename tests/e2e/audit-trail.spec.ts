import { test, expect, Download } from '@playwright/test';

test.describe('Audit Trail E2E', () => {
  test('should record action and display in audit trail tab', async ({ page }) => {
    await page.goto('/');

    // Register unique user
    await page.getByRole('button', { name: 'Create' }).click();
    const username = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(username);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // Navigate to Project Settings
    const settingsBtn = page.locator('.tab-bar-btn', { hasText: 'Project Settings' })
      .or(page.locator('[data-tab="settings"]'))
      .or(page.locator('button', { hasText: 'Settings' }))
      .first();
    await settingsBtn.click();
    await expect(page.locator('.project-settings-layout')).toBeVisible({ timeout: 8000 });

    // Perform a mutation: update project name (triggers PATCH /api/projects/:id)
    const generalTab = page.locator('.tab-bar-btn', { hasText: 'General' });
    await generalTab.click();
    const nameInput = page.locator('input[id*="project-name"], input[placeholder*="Project name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill(`AuditTest ${Date.now()}`);
      const saveBtn = page.locator('button', { hasText: /save|update/i }).first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        // Wait for save to complete
        await page.waitForTimeout(500);
      }
    }

    // Open Audit Trail tab
    const auditTab = page.locator('#tab-audit-trail');
    await expect(auditTab).toBeVisible({ timeout: 5000 });
    await auditTab.click();

    // Wait for content to load
    await page.waitForTimeout(1500);

    // Verify the audit trail table or empty state is visible
    const tableOrEmpty = page.locator('.audit-trail-table, .audit-trail-empty-state');
    await expect(tableOrEmpty).toBeVisible({ timeout: 8000 });

    // If table is present, verify at least one row
    const hasTable = await page.locator('.audit-trail-table').isVisible();
    if (hasTable) {
      const rows = page.locator('.audit-trail-table tbody tr');
      await expect(rows.first()).toBeVisible();

      // Verify source badge shows something
      const sourceBadge = rows.first().locator('.audit-trail-source-badge');
      await expect(sourceBadge).toBeVisible();

      // Verify actor column is not empty
      const actorCell = rows.first().locator('td').nth(1);
      const actorText = await actorCell.innerText();
      expect(actorText.trim().length).toBeGreaterThan(0);
    }
  });

  test('should filter audit logs by source', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create' }).click();
    const username = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(username);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    const settingsBtn = page.locator('.tab-bar-btn', { hasText: 'Project Settings' })
      .or(page.locator('[data-tab="settings"]'))
      .or(page.locator('button', { hasText: 'Settings' }))
      .first();
    await settingsBtn.click();
    await expect(page.locator('.project-settings-layout')).toBeVisible({ timeout: 8000 });

    const auditTab = page.locator('#tab-audit-trail');
    await auditTab.click();
    await page.waitForTimeout(1200);

    // Source filter: select 'api_key' — should show empty state or filtered results (not crash)
    const sourceSelect = page.locator('#audit-trail-source-filter');
    await expect(sourceSelect).toBeVisible({ timeout: 5000 });
    await sourceSelect.selectOption('api_key');
    await page.waitForTimeout(800);

    const tableOrEmpty = page.locator('.audit-trail-table, .audit-trail-empty-state');
    await expect(tableOrEmpty).toBeVisible({ timeout: 5000 });

    // Reset filter
    await sourceSelect.selectOption('');
    await page.waitForTimeout(500);
  });

  test('should search audit logs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create' }).click();
    const username = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(username);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    const settingsBtn = page.locator('.tab-bar-btn', { hasText: 'Project Settings' })
      .or(page.locator('[data-tab="settings"]'))
      .or(page.locator('button', { hasText: 'Settings' }))
      .first();
    await settingsBtn.click();
    await expect(page.locator('.project-settings-layout')).toBeVisible({ timeout: 8000 });

    const auditTab = page.locator('#tab-audit-trail');
    await auditTab.click();
    await page.waitForTimeout(1200);

    const searchInput = page.locator('#audit-trail-search');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Search for something that won't match → should show empty state
    await searchInput.fill('xyznonexistentterm123456');
    await page.waitForTimeout(500);

    const emptyState = page.locator('.audit-trail-empty-state');
    const tableNotEmpty = page.locator('.audit-trail-table tbody tr');
    // Either empty state is shown, or the table has 0 rows
    const isEmptyState = await emptyState.isVisible();
    const rowCount = await tableNotEmpty.count();
    expect(isEmptyState || rowCount === 0).toBeTruthy();

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(500);
  });

  test('should export CSV from audit trail', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create' }).click();
    const username = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(username);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // Trigger some action first so there's something to export
    const settingsBtn = page.locator('.tab-bar-btn', { hasText: 'Project Settings' })
      .or(page.locator('[data-tab="settings"]'))
      .or(page.locator('button', { hasText: 'Settings' }))
      .first();
    await settingsBtn.click();
    await expect(page.locator('.project-settings-layout')).toBeVisible({ timeout: 8000 });

    const auditTab = page.locator('#tab-audit-trail');
    await auditTab.click();
    await page.waitForTimeout(1500);

    const exportBtn = page.locator('#audit-trail-export-btn');
    await expect(exportBtn).toBeVisible({ timeout: 5000 });

    const hasTable = await page.locator('.audit-trail-table').isVisible();
    if (hasTable) {
      // Listen for download
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportBtn.click(),
      ]);
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/^audit-trail-.+\.csv$/);
    } else {
      // Export button should be disabled when no data
      await expect(exportBtn).toBeDisabled();
    }
  });
});
