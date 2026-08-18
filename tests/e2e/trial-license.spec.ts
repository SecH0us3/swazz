// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { registerAndLogin } from './helpers';

async function navigateToLicenseSettings(page: Page) {
  // Open UserMenu dropdown
  const accountBtn = page.locator('button[title="Account"]');
  await expect(accountBtn).toBeVisible();
  await accountBtn.click();

  // Click Profile Settings
  const settingsLink = page.locator('.dropdown-item:has-text("Profile Settings")');
  await expect(settingsLink).toBeVisible();
  await settingsLink.click();

  // Click License & Subscription sub-tab
  const licenseTab = page.locator('#tab-user-license');
  await expect(licenseTab).toBeVisible();
  await licenseTab.click();

  await expect(page.locator('h2:has-text("License & Subscription")')).toBeVisible({ timeout: 5000 });
}

test.describe('Trial License Self-Generation E2E Test', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));
    page.on('requestfailed', req => console.log(`BROWSER REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));
  });

  test('allows registered user to claim one-time 14-day trial and shows badge and token', async ({ page }) => {
    await registerAndLogin(page, 'u', false);
    await navigateToLicenseSettings(page);

    // Initial state: Community mode and claim card visible
    await expect(page.locator('.license-status-badge')).toContainText('Community (Free) Mode');
    const claimBtn = page.getByRole('button', { name: 'Claim 14-Day Free Trial' });
    await expect(claimBtn).toBeVisible();

    // Click Claim Trial
    await claimBtn.click();

    // Verify success and active state
    await expect(page.locator('.two-factor-success-alert')).toContainText('14-day free trial license activated successfully', { timeout: 10000 });
    await expect(page.locator('.license-status-badge.active')).toContainText('Trial License Active');
    await expect(page.locator('.trial-days-badge')).toContainText('remaining');
    await expect(page.locator('.license-info-value', { hasText: 'Trial' })).toBeVisible();

    // Token copy box is displayed
    const copyBtn = page.getByRole('button', { name: 'Copy Key' });
    await expect(copyBtn).toBeVisible();
    await expect(page.locator('.trial-token-content')).toBeVisible();

    // Claim button is now gone
    await expect(page.getByRole('button', { name: 'Claim 14-Day Free Trial' })).not.toBeVisible();
  });
});
