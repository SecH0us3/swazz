// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A link must never change who the visitor is signed in as, or which projects they belong to,
// without an explicit action in the UI (login CSRF / silent invitation accept).

import { test, expect } from '@playwright/test';
import { registerAndLogin, TIMEOUTS } from './helpers';

test.describe('URL parameters cannot switch the session or join a project', () => {
  test('?auth_token= neither replaces the current session nor stays in the URL', async ({ page }) => {
    await registerAndLogin(page, 'csrf', false);
    const ownToken = await page.evaluate(() => localStorage.getItem('swazz_token'));
    expect(ownToken).toBeTruthy();

    await page.goto('/?auth_token=attacker.jwt.value');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: TIMEOUTS.LOAD });

    expect(await page.evaluate(() => localStorage.getItem('swazz_token'))).toBe(ownToken);
    await expect(page).not.toHaveURL(/auth_token=/);
  });

  test('an invitation link never accepts by itself', async ({ page }) => {
    await registerAndLogin(page, 'inv', false);
    const acceptCalls: string[] = [];
    await page.route('**/api/auth/invitations/accept', route => {
      acceptCalls.push(route.request().url());
      return route.fulfill({ status: 500, body: '{"error":"must not be called"}' });
    });

    const token = '01HXYZABCDEFGHJKMNPQRSTVWX01HXYZABCDEFGHJKMNPQRSTVWX';

    // On an arbitrary path the token is ignored.
    await page.goto(`/?token=${token}`);
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: TIMEOUTS.LOAD });

    // On the dedicated route it is only remembered for the header banner, and removed from the URL.
    await page.goto(`/accept-invite?token=${token}`);
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await expect(page).not.toHaveURL(/token=/);
    expect(await page.evaluate(() => sessionStorage.getItem('swazz_pending_invite'))).toBe(token);

    await page.waitForTimeout(1500); // give any stray effect time to fire
    expect(acceptCalls).toEqual([]);
  });
});
