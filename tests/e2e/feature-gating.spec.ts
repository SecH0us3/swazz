// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import { test, expect, Page } from '@playwright/test';

async function registerAndLogin(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign In' }).click();
  const createBtn = page.getByRole('button', { name: 'Create an account' });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
  await page.locator('#username').fill(uniqueUsername);
  await page.locator('#password').fill('Password123!');
  await page.locator('#password').press('Enter');

  await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
  return uniqueUsername;
}

async function openProjectSettings(page: Page) {
  await page.locator('button:has-text("More Project Settings")').click();
  await expect(page.locator('h1:has-text("Project Settings")')).toBeVisible({ timeout: 10000 });
}

test.describe('Feature Gating E2E', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));
    page.on('requestfailed', req => console.log(`BROWSER REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));
  });

  test('guest sees locked paid tabs and coming-soon tabs in Project Settings', async ({ page }) => {
    // Register as a regular (free) user — no license key.
    await page.goto('/');
    await openProjectSettings(page);

    // Paid tabs show the lock badge.
    await expect(page.locator('#tab-webhooks')).toContainText('🔒');
    await expect(page.locator('#tab-schedule')).toContainText('🔒');
    await expect(page.locator('#tab-ai-remediation')).toContainText('🔒');
    await expect(page.locator('#tab-members')).toContainText('🔒');

    // Coming-soon tabs show the hourglass badge.
    await expect(page.locator('#tab-waf-analysis')).toContainText('⏳');
    await expect(page.locator('#tab-domain-recon')).toContainText('⏳');

    // Clicking a locked paid tab does not open it and shows a toast.
    await page.locator('#tab-webhooks').click();
    await expect(page.locator('.toast', { hasText: 'requires a paid plan' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.project-settings-content')).not.toContainText('Webhook');

    // Clicking a coming-soon tab shows the coming-soon toast.
    await page.locator('#tab-waf-analysis').click();
    await expect(page.locator('.toast', { hasText: 'coming soon' })).toBeVisible({ timeout: 5000 });
  });

  test('activating a license unlocks paid tabs', async ({ page }) => {
    await page.goto('/');

    // Mock the license API to simulate a successful activation with
    // scheduled_runs granted. The real Ed25519 verification is covered by
    // unit tests; here we exercise the UI unlock flow.
    await page.route('**/api/user/license', async (route) => {
      const license = {
        company: 'E2E Corp',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        features: ['scheduled_runs'],
      };
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'active', license }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', license }),
        });
      }
    });

    // Reload so the app fetches the (mocked) license status.
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    await openProjectSettings(page);

    // Webhooks tab is now unlocked — no lock badge, click opens the tab.
    await expect(page.locator('#tab-webhooks')).not.toContainText('🔒');
    await page.locator('#tab-webhooks').click();
    await expect(page.locator('.project-settings-content')).toContainText('Webhook', { timeout: 5000 });

    // Coming-soon tabs stay locked regardless of license.
    await expect(page.locator('#tab-waf-analysis')).toContainText('⏳');
  });
});
