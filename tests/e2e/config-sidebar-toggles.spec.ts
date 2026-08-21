// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { TIMEOUTS } from './helpers';

test.describe('Config Sidebar Contextual Toggle E2E Tests', () => {
  test('should toggle the configuration sidebar using the control bar gear and sidebar close button', async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));

    // 1. Navigate to dashboard and log in as guest
    await page.goto('/');
    const signInBtn = page.getByRole('button', { name: 'Sign In' }).first();
    await expect(signInBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await signInBtn.click();

    const guestBtn = page.getByRole('button', { name: 'Try as guest →' });
    await expect(guestBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await guestBtn.click();

    // 2. Wait for main layout
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: TIMEOUTS.LOAD });

    const sidebar = page.locator('.config-sidebar');
    const closeBtn = page.locator('.config-sidebar-close');

    // If the sidebar is currently visible, click the close button inside the sidebar to hide it
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }

    // Now, verify the sidebar is hidden (has class hidden-desktop)
    await expect(sidebar).toHaveClass(/hidden-desktop/);

    // Verify the settings gear button is visible in the fuzzer control bar
    const gearBtn = page.locator('.workspace-config-toggle-btn');
    await expect(gearBtn).toBeVisible();

    // 4. Click the gear button to open the configuration sidebar
    await gearBtn.click();

    // Verify the configuration sidebar is now visible (does not have hidden-desktop class)
    await expect(sidebar).not.toHaveClass(/hidden-desktop/);

    // Verify the gear button in the control bar is hidden
    await expect(gearBtn).not.toBeVisible();

    // Verify the close button is visible inside the sidebar
    await expect(closeBtn).toBeVisible();

    // 5. Click the close button inside the sidebar
    await closeBtn.click();

    // Verify the sidebar is hidden again
    await expect(sidebar).toHaveClass(/hidden-desktop/);

    // Verify the gear button is visible again
    await expect(gearBtn).toBeVisible();
  });
});
