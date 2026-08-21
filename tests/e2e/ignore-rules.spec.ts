// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { TIMEOUTS } from './helpers';

test.describe('Ignore Rules configuration and persistence E2E Tests', () => {
  test('should triage finding and check ignore rule scopes & auto cleanup', async ({ page }) => {
    // 1. Navigate to frontend
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register unique user (username matching length requirements)
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await configPromise;

    // 3. Add Vulnerable Demo API spec
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // 4. Trigger fuzzing
    // Ensure Config tab is opened in sidebar if not visible
    const configSidebar = page.locator('.config-sidebar');
    if (await configSidebar.count() > 0 && !(await configSidebar.isVisible())) {
      const configTab = page.locator('button.nav-item:has-text("Config"), button.tab-item:has-text("Config")');
      if (await configTab.count() > 0) await configTab.click();
    }
    const boundaryToggle = page.locator('.profile-toggle.boundary');
    if (await boundaryToggle.count() > 0 && await boundaryToggle.evaluate((node) => node.classList.contains('active'))) {
      await boundaryToggle.evaluate((node) => node.click());
    }
    

    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Verify run starts and completes
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.SCAN_RUN });

    // 5. Navigate to Grouped Errors tab
    const findingsTab = page.locator('button.tab-bar-btn:has-text("Grouped Errors")');
    await expect(findingsTab).toBeVisible();
    await findingsTab.click();

    // Click Expand All to render finding items
    const expandAllBtn = page.locator('button:has-text("Expand All")');
    await expect(expandAllBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expandAllBtn.click();

    // Select the first finding item
    const firstFinding = page.locator('.finding-item').first();
    await expect(firstFinding).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await firstFinding.click();

    // Verify detail panel and triage selector
    const triageSelect = page.locator('.request-detail-triage-select');
    await expect(triageSelect).toBeVisible();

    // 6. Select "ignored" triage
    await triageSelect.selectOption('ignored');

    // Verify Ignore Rule modal opens
    const modalTitle = page.locator('.ignore-modal-content h2:has-text("Add Ignore Rule")');
    await expect(modalTitle).toBeVisible();

    // Select 'all' scope (Everywhere) and confirm
    await page.locator('input[name="ignore-scope"][value="all"]').click();
    const confirmBtn = page.locator('button.btn-primary:has-text("Ignore Finding")');
    await expect(confirmBtn).toBeVisible();
    const triageResponsePromise = page.waitForResponse(res => res.url().includes('/config') && res.request().method() === 'POST');
    await confirmBtn.click();
    await triageResponsePromise;

    // Modal should disappear
    await expect(modalTitle).not.toBeVisible();

    // Verify IG badge and opacity on dashboard (wait up to 30s for React/IDB sync)
    const igBadge = firstFinding.locator('.badge:has-text("Ignored")');
    await expect(igBadge).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await expect(firstFinding).toHaveCSS('opacity', '0.6', { timeout: TIMEOUTS.LOAD });

    // Close the detail inspector panel
    const closeInspectorBtn = page.locator('button[aria-label="Close"]');
    await expect(closeInspectorBtn).toBeVisible();
    await closeInspectorBtn.click();

    // Wait for the 1.5s debounced config sync to finish persisting to the backend API
    await page.waitForTimeout(2000);

    // 7. Verify the ignore rule is synced to project settings raw config
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();

    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      rules: {
        ignore_rules: [
          {
            endpoint: '**',
          }
        ]
      }
    });

    // 8. Go back to Dashboard and untriage (set back to none)
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    await findingsTab.click();
    await expandAllBtn.click();
    
    const triagedFinding = page.locator('.finding-item:has(.badge:has-text("Ignored"))').first();
    await expect(triagedFinding).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await triagedFinding.click();

    const cleanupResponsePromise = page.waitForResponse(res => res.url().includes('/config') && res.request().method() === 'POST');
    await triageSelect.selectOption('none');

    // Close the detail inspector panel
    await closeInspectorBtn.click();

    // Opacity goes back to 1
    await expect(triagedFinding).toHaveCSS('opacity', '1');
    await expect(igBadge).not.toBeVisible();

    // Wait for the cleanup config sync to finish persisting to the backend API
    await cleanupResponsePromise;

    // Verify rule was automatically cleaned up from settings
    await moreSettingsBtn.click();
    await rawConfigTabBtn.click();

    await expect.poll(async () => {
      try {
        const parsed = JSON.parse(await rawTextarea.inputValue());
        return parsed.rules?.ignore_rules || [];
      } catch {
        return [];
      }
    }).toEqual([]);
  });
});
