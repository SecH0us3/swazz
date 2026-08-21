// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Page, expect } from '@playwright/test';

/**
 * Mocks the user license endpoint to unlock all enterprise feature gates
 * (RBAC, Webhooks, Scheduler, AI Remediation, Report Exports, etc.).
 */
export async function mockEnterpriseLicense(page: Page, features: string[] = ['*']): Promise<void> {
  await page.route('**/api/user/license', async (route) => {
    const license = {
      company: 'E2E Enterprise Corp',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      features,
      max_users: 10,
      max_concurrency: 1000,
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
}

/**
 * Safely registers and logs in a new unique user, disables intrusive onboarding tips,
 * and optionally claims a 14-day enterprise trial to enable backend & frontend enterprise features.
 */
export async function registerAndLogin(
  page: Page,
  usernamePrefix: string = 'u',
  claimTrial: boolean = true
): Promise<string> {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('swazz_tips_enabled', 'false');
  });
  await page.goto('/');

  const signInBtn = page.getByRole('button', { name: 'Sign In' }).first();
  await expect(signInBtn).toBeVisible({ timeout: 10000 });
  await signInBtn.click();

  const createBtn = page.getByRole('button', { name: 'Create an account' });
  await expect(createBtn).toBeVisible({ timeout: 10000 });
  await createBtn.click();

  // Ensure total length is strictly < 20 chars for database constraints
  const prefix = usernamePrefix.slice(0, 5); // limit prefix
  const uniqueUsername = `${prefix}${Date.now().toString().slice(-5)}_${Math.floor(Math.random() * 1000)}`;
  await page.locator('#username').fill(uniqueUsername);
  await page.locator('#password').fill('Password123!');
  await page.locator('#password').press('Enter');

  await expect(page.locator('.app-layout')).toBeVisible({ timeout: 30000 });

  if (claimTrial) {
    await page.evaluate(async () => {
      const token = localStorage.getItem('swazz_token');
      if (token) {
        await fetch('/api/user/trial-license', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    });
  }

  return uniqueUsername;
}

/**
 * Shared timeouts for E2E tests to prevent hardcoded numbers
 */
export const TIMEOUTS = {
  SHORT: 5000,
  DEFAULT: 10000,
  LOAD: 30000,
  SCAN_RUN: 180000,
  GLOBAL_TEST: 300000,
};
