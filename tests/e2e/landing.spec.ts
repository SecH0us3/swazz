// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { disableTours } from './helpers.js';

test.describe('Landing Page', () => {
  test('should display the global scan count', async ({ page }) => {
    await disableTours(page);
    // Mock the /api/telemetry/scans/count endpoint
    await page.route('**/api/telemetry/scans/count', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 8765432 }),
      });
    });

    // Navigate to the landing page
    await page.goto('/');

    // Wait for the formatted number to become visible on the page
    // Using a slightly longer timeout in case of counting animation (takes ~2s)
    await expect(page.getByText('8,765,432+ Scans')).toBeVisible({ timeout: 15000 });
  });
});
