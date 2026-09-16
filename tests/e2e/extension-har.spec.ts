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
    await popup.locator('#btn-toggle-record').check();
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
    await app.close();
  });
});
