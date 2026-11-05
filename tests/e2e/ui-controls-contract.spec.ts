// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { registerAndLogin, TIMEOUTS } from './helpers';

test.describe('Pure DOM UI Controls Contract (No WebMCP)', () => {
  test('verifies pure DOM user interactions for tab navigation, profile toggles, and target input', async ({ page }) => {
    // 1. Authenticate and enter workspace
    await registerAndLogin(page, 'uicontract');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // =========================================================================
    // 1. PURE DOM: Tab Navigation (User clicks tab buttons with mouse)
    // =========================================================================
    const logsTab = page.locator('button.tab-bar-btn:has-text("Logs")');
    const findingsTab = page.locator('button.tab-bar-btn:has-text("Findings")');
    const wafTab = page.locator('button.tab-bar-btn:has-text("WAF")');
    const heatmapTab = page.locator('button.tab-bar-btn:has-text("Heatmap")');

    // Click Logs tab via real DOM click
    await expect(logsTab).toBeVisible();
    await logsTab.click();
    await expect(logsTab).toHaveClass(/active/);

    // Click Findings tab via real DOM click
    await expect(findingsTab).toBeVisible();
    await findingsTab.click();
    await expect(findingsTab).toHaveClass(/active/);

    // Click WAF tab via real DOM click
    await expect(wafTab).toBeVisible();
    await wafTab.click();
    await expect(wafTab).toHaveClass(/active/);

    // Click Heatmap tab via real DOM click
    await expect(heatmapTab).toBeVisible();
    await heatmapTab.click();
    await expect(heatmapTab).toHaveClass(/active/);

    // =========================================================================
    // 2. PURE DOM: Configuration Sidebar & Profile Toggles
    // =========================================================================
    const configSidebar = page.locator('.config-sidebar');
    const configToggle = page.locator('.workspace-config-toggle-btn');

    // If sidebar is hidden, open it via gear button click
    if (await configSidebar.count() > 0 && !(await configSidebar.isVisible())) {
      await expect(configToggle).toBeVisible();
      await configToggle.click();
    }
    await expect(configSidebar).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    const boundaryToggle = page.locator('.profile-toggle.boundary');
    const maliciousToggle = page.locator('.profile-toggle.malicious');
    const randomToggle = page.locator('.profile-toggle.random');

    await expect(boundaryToggle).toBeVisible();
    await expect(maliciousToggle).toBeVisible();
    await expect(randomToggle).toBeVisible();

    // Toggle boundary profile off and on via DOM click
    const initialBoundaryActive = await boundaryToggle.evaluate((el) => el.classList.contains('active'));
    await boundaryToggle.click();
    if (initialBoundaryActive) {
      await expect(boundaryToggle).not.toHaveClass(/active/);
      // Toggle back on
      await boundaryToggle.click();
      await expect(boundaryToggle).toHaveClass(/active/);
    } else {
      await expect(boundaryToggle).toHaveClass(/active/);
      // Toggle back off
      await boundaryToggle.click();
      await expect(boundaryToggle).not.toHaveClass(/active/);
    }

    // =========================================================================
    // 3. PURE DOM: Target API URL input
    // =========================================================================
    const targetInput = page.locator('input.workspace-target-input');
    await expect(targetInput).toBeVisible();
    const testUrl = 'http://127.0.0.1:9099';
    await targetInput.fill(testUrl);
    await targetInput.blur();
    await expect(targetInput).toHaveValue(testUrl);
  });
});
