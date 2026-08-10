// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { enableTours } from './helpers.js';

test.describe('Contextual tours', () => {
  test('manually starts a tour and walks through steps', async ({ page }) => {
    await enableTours(page);

    // 1. Navigate to the frontend dev server and sign in as a fresh user
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Register a unique user via the UI to reach the workspace
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 2. Start the workspace tour manually via DOM event
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('swazz:tour', { detail: { tourId: 'workspace-first' } }));
    });

    // 3. First step title should appear in a dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 4. Walk through steps: workspace-first has 3 steps
    // step 0 -> 1, step 1 -> 2
    await dialog.getByRole('button', { name: /Next/ }).click();
    await dialog.getByRole('button', { name: /Next/ }).click();
    // step 2 (last) -> Done
    await dialog.getByRole('button', { name: /Done/ }).click();

    // 5. After finishing, the dialog is gone
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
