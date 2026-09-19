// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Extension capture -> HAR download -> dashboard upload round trip.
 *
 * This is the path the extension exists for: record real traffic, export it as a
 * standard HAR, and feed that exact file back into Swazz. It needs a persistent
 * context because Chrome only loads unpacked extensions there, so it cannot use
 * the shared `page` fixture.
 */

const EXTENSION_PATH = path.resolve(__dirname, '../../packages/extension');
const TARGET = '127.0.0.1:8788';
const DASHBOARD = 'http://localhost:5173';

test.describe.configure({ mode: 'serial' });

test.describe('Browser extension HAR round trip', () => {
  let context: BrowserContext;
  let extensionId: string;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swazz-ext-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    // MV3 exposes the background service worker; its URL carries the extension id.
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    extensionId = new URL(worker.url()).host;
    expect(extensionId, 'extension failed to load').toBeTruthy();
  });

  test.afterAll(async () => {
    await context?.close();
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  // The switch is a toggle and these tests share one context, so clicking it
  // blindly turns recording OFF when a previous test left it on.
  async function setRecording(popup: Page, on: boolean) {
    const box = popup.locator('#btn-toggle-record');
    if ((await box.isChecked()) !== on) {
      await popup.locator('label.switch:has(#btn-toggle-record) .slider').click();
    }
    await expect(box).toBeChecked({ checked: on });
  }

  async function openPopup(): Promise<Page> {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('.popup-container')).toBeVisible();
    return popup;
  }

  test('records in-scope traffic and exports it as a HAR the dashboard accepts', async () => {
    // 1. Configure scope and start recording.
    const popup = await openPopup();
    await popup.locator('#settings-toggle').click();
    await popup.locator('#input-domains').fill(TARGET);
    await setRecording(popup, true);
    await expect(popup.locator('#recording-status')).toHaveText('Recording');
    await popup.close();

    // 2. Generate traffic against the vulnerable demo target: a top-level
    //    navigation plus a fetch issued from the page, so both capture paths run.
    const target = await context.newPage();
    await target.goto(`http://${TARGET}/welcome`);
    await target.evaluate(async () => {
      await fetch('/api/goods?limit=10');
      await fetch('/users');
    });
    await target.waitForTimeout(1000); // let the debounced flush land
    await target.close();

    // 3. The popup should now list the captured endpoints.
    const popup2 = await openPopup();
    await expect(popup2.locator('#lbl-endpoint-count')).not.toHaveText('0');
    await expect(popup2.locator('.endpoint-item')).not.toHaveCount(0);

    // 4. Export works with no token and no project selected — the offline path.
    const exportBtn = popup2.locator('#btn-export-har');
    await expect(exportBtn).toBeEnabled();

    const downloadPromise = popup2.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.har$/);

    const harPath = path.join(userDataDir, 'capture.har');
    await download.saveAs(harPath);
    await popup2.close();

    // 5. The downloaded file must be a valid HAR carrying what we recorded.
    const har = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries.length).toBeGreaterThan(0);
    const urls = har.log.entries.map((e: { request: { url: string } }) => e.request.url);
    expect(urls.some((u: string) => u.includes('/api/goods'))).toBe(true);

    // 6. Feed that exact file back into the dashboard.
    const app = await context.newPage();
    await app.goto(DASHBOARD);
    await app.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('swazz_tips_enabled', 'false');
    });
    await app.goto(DASHBOARD);

    await app.getByRole('button', { name: 'Sign In' }).first().click();
    await app.getByRole('button', { name: 'Create an account' }).click();
    const username = `x${Date.now().toString().slice(-5)}_${Math.floor(Math.random() * 1000)}`;
    await app.locator('#username').fill(username);
    await app.locator('#password').fill('Password123!');
    await app.locator('#password').press('Enter');
    await expect(app.locator('.app-layout')).toBeVisible({ timeout: 30000 });

    await app.locator('input[type="file"].sidebar-file-input-hidden').setInputFiles(harPath);

    // Endpoints recorded by the extension now appear in the project's tree.
    await expect(app.locator('.tree-leaf-row:has-text("goods")')).toBeVisible({ timeout: 30000 });
    await app.evaluate(() => localStorage.clear());
    await app.close();
  });

  test('lists every ignored domain and switches views', async () => {
    // Scope something unrelated, so every request the demo page makes is out of
    // scope. Both hosts below serve the same demo server, so both requests
    // genuinely happen — a host that refuses the connection would leave the test
    // unable to tell "not recorded" from "never sent".
    const popup = await openPopup();
    await popup.locator('#settings-toggle').click();
    await popup.locator('#input-domains').fill('example.invalid');
    await setRecording(popup, true);
    // Start from a clean slate: earlier tests in this shared context may have
    // left ignored hosts behind, which would mask a failure here.
    await popup.locator('#tab-ignored').click();
    await popup.locator('#btn-clear-ignored').click();
    await popup.close();

    const target = await context.newPage();
    await target.goto(`http://${TARGET}/welcome`);
    await target.evaluate(async () => {
      for (const u of ['/users', 'http://localhost:8788/users', 'http://localhost:8788/welcome']) {
        try { await fetch(u, { mode: 'no-cors' }); } catch { /* the drop is what matters */ }
      }
    });
    await target.waitForTimeout(1500);
    await target.close();

    // Assert against the worker's own state first, so a UI assertion failing
    // cannot be confused with traffic never having been generated.
    const worker = context.serviceWorkers()[0];
    const dropped = await worker.evaluate(
      () => (globalThis as any).chrome.storage.local.get('droppedHosts')
    );
    expect(Object.keys(dropped.droppedHosts || {}).length).toBeGreaterThan(1);

    const popup2 = await openPopup();
    await popup2.locator('#tab-ignored').click();

    // The captured list gives way to the ignored list.
    await expect(popup2.locator('#ignored-view')).toBeVisible();
    await expect(popup2.locator('.endpoints-list-container').first()).toBeHidden();

    const rows = popup2.locator('.ignored-item');
    await expect(rows.first()).toBeVisible();
    const hosts = await popup2.locator('.ignored-host').allTextContents();
    // Every ignored domain is listed, not just the most recent one.
    expect(hosts.length).toBe(Object.keys(dropped.droppedHosts || {}).length);
    expect(hosts.length).toBeGreaterThan(1);

    // Switching back restores the captured view.
    await popup2.locator('#tab-captured').click();
    await expect(popup2.locator('#ignored-view')).toBeHidden();
    await popup2.close();
  });

  test('offers a close control in the side panel but not in the popup', async () => {
    const popup = await openPopup();
    await expect(popup.locator('#btn-close-sidepanel')).toBeHidden();
    await expect(popup.locator('#link-open-sidepanel')).toBeVisible();
    await popup.close();

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.locator('#btn-close-sidepanel')).toBeVisible();
    await expect(panel.locator('#link-open-sidepanel')).toBeHidden();
    await panel.close();
  });

  test('picks up the token after logging in on the same tab, without Auto-Sync', async () => {
    // The storage event never fires in the tab that wrote the value, so a login
    // performed on the dashboard tab itself used to go unnoticed and the token
    // field stayed empty until the user pressed Auto-Sync.
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('token'));

    const app = await context.newPage();
    await app.goto(DASHBOARD);
    const hasToken = await app.evaluate(() => {
      const t = !!localStorage.getItem('swazz_token');
      localStorage.clear();
      localStorage.setItem('swazz_tips_enabled', 'false');
      return t;
    });
    if (hasToken) {
      await app.reload();
    }

    await app.getByRole('button', { name: 'Sign In' }).first().click();
    await app.getByRole('button', { name: 'Create an account' }).click();
    const username = `t${Date.now().toString().slice(-5)}_${Math.floor(Math.random() * 1000)}`;
    await app.locator('#username').fill(username);
    await app.locator('#password').fill('Password123!');
    await app.locator('#password').press('Enter');
    await expect(app.locator('.app-layout')).toBeVisible({ timeout: 30000 });

    // No Auto-Sync click: the extension must notice on its own.
    await expect
      .poll(async () => (await worker.evaluate(() => (globalThis as any).chrome.storage.local.get('token'))).token, {
        timeout: 15000,
      })
      .toBeTruthy();
    await app.evaluate(() => localStorage.clear());
    await app.close();
  });

  test('accepts the dashboard Auto-Sync handshake and rejects a hostile origin', async () => {
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => (globalThis as any).chrome.storage.local.remove('token'));

    // A page that is not the dashboard must not be able to plant a token.
    const hostile = await context.newPage();
    await hostile.goto(`http://${TARGET}/welcome`);
    await hostile.evaluate(() => {
      localStorage.setItem('swazz_token', 'attacker-token');
      window.dispatchEvent(new CustomEvent('swazz-handshake', { detail: { token: 'attacker-token' } }));
    });
    await hostile.waitForTimeout(500);
    let stored = await worker.evaluate(() => (globalThis as any).chrome.storage.local.get('token'));
    expect(stored.token, 'a non-dashboard origin must never set the token').toBeFalsy();
    await hostile.close();

    // The dashboard itself may, via the Auto-Sync button's event.
    const app = await context.newPage();
    await app.goto(DASHBOARD);
    await app.evaluate(() => {
      localStorage.setItem('swazz_token', 'dashboard-token');
      window.dispatchEvent(new CustomEvent('swazz-handshake', { detail: {} }));
    });
    await expect
      .poll(async () => (await worker.evaluate(() => (globalThis as any).chrome.storage.local.get('token'))).token, {
        timeout: 10000,
      })
      .toBe('dashboard-token');
    await app.close();
  });
});
