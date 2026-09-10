// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect, Page } from '@playwright/test';
import { registerAndLogin , TIMEOUTS} from './helpers';

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

  await expect(page.locator('h2:has-text("License & Subscription")')).toBeVisible({ timeout: TIMEOUTS.SHORT });
}

test.describe('Trial License Self-Generation E2E Test', () => {
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
    await expect(page.locator('.two-factor-success-alert')).toContainText('14-day free trial license activated successfully', { timeout: TIMEOUTS.DEFAULT });
    await expect(page.locator('.license-status-badge.active')).toContainText('Trial License Active');
    await expect(page.locator('.license-days-badge')).toContainText('remaining');
    await expect(page.locator('.license-info-value', { hasText: 'Trial' })).toBeVisible();

    // Token copy box is displayed
    const copyBtn = page.getByRole('button', { name: 'Copy' });
    await expect(copyBtn).toBeVisible();
    await expect(page.locator('.trial-token-content')).toBeVisible();

    // Claim button is now gone
    await expect(page.getByRole('button', { name: 'Claim 14-Day Free Trial' })).not.toBeVisible();
  });

  test('commercial license user who previously claimed trial does not show Trial License Active', async ({ page }) => {
    await registerAndLogin(page, 'u', false);

    // The endpoint is /api/user/trial-status, not /api/user/license/trial-status —
    // the wrong glob never matched, so this test ran against the real (claimed: false)
    // status and never covered the "previously claimed a trial" case it is named for.
    await page.route('**/api/user/trial-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ claimed: true, can_claim: false }),
      });
    });

    const expiresAt = new Date(Date.now() + 86400000 * 90).toISOString();
    await page.route('**/api/user/license', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'active',
            license: {
              company: 'Acme Enterprise',
              kind: 'commercial',
              expires_at: expiresAt,
              features: ['*'],
              concurrency: 50,
              key_fingerprint: 'abcdef0123456789',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await navigateToLicenseSettings(page);

    await expect(page.locator('.license-status-badge.active')).toContainText('Enterprise License Active');
    await expect(page.locator('.license-status-badge')).not.toContainText('Trial License Active');
    await expect(page.getByRole('button', { name: 'Claim 14-Day Free Trial' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Renew 14-Day Trial' })).not.toBeVisible();
  });

  test('expired license displays License Expired badge and Contact Sales primary button', async ({ page }) => {
    await registerAndLogin(page, 'u', false);

    const expiredDate = new Date(Date.now() - 86400000 * 10).toISOString();
    await page.route('**/api/user/license', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'expired',
            license: {
              company: 'Expired Corp',
              kind: 'commercial',
              expires_at: expiredDate,
              features: ['*'],
              concurrency: 10,
              key_fingerprint: '1234567890abcdef',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await navigateToLicenseSettings(page);

    await expect(page.locator('.license-status-badge')).toContainText('License Expired');
    await expect(page.locator('.license-info-value', { hasText: 'Expired Corp' })).toBeVisible();
    const contactSalesBtn = page.getByRole('button', { name: '✉ Contact Sales' });
    await expect(contactSalesBtn).toBeVisible();
    await expect(contactSalesBtn).toHaveClass(/btn-primary/);
  });
});

