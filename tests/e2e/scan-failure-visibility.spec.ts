// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A project with an MCP server that rejects the runner (401). Before, every scan of it failed
// within seconds while the dashboard kept showing it as running, with no reason anywhere. Now:
//  - with an API to scan, the API is scanned and the dashboard says the MCP part was skipped, why,
//    and what to change;
//  - with nothing but the MCP server, the scan ends as failed, and says why, in the dashboard, the
//    runner log and the scan history.

import { test, expect, Page } from '@playwright/test';
import http from 'http';
import net from 'net';
import { mockEnterpriseLicense, registerAndLogin, TIMEOUTS, disableBoundaryProfile } from './helpers';

/** An "MCP server" that rejects every request, as one does without its token. */
async function startRejectingServer() {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"unauthorized"}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/sse`, close: () => server.close() };
}

/** Merges into the project's raw JSON config. */
async function editProjectConfig(page: Page, edit: (config: any) => void) {
  await page.locator('button:has-text("More Project Settings")').click();
  await page.locator('button.tab-bar-btn:has-text("Raw JSON Config")').click();
  const textarea = page.locator('textarea.textarea');
  await expect(textarea).toBeVisible();
  const config = JSON.parse(await textarea.inputValue());
  edit(config);
  await textarea.fill(JSON.stringify(config, null, 2));
  await page.locator('button:has-text("Save Configuration")').click();
  await expect(page.locator('text=/Configuration updated successfully/')).toBeVisible();
  await page.locator('button:has-text("Back to Dashboard")').click();
}

test.describe('Scan failures are visible', () => {
  let mcp: Awaited<ReturnType<typeof startRejectingServer>>;

  test.beforeEach(async () => {
    mcp = await startRejectingServer();
  });

  test.afterEach(() => mcp.close());

  test('an MCP server that rejects the runner costs only the MCP part, and the dashboard says why', async ({ page }) => {
    test.setTimeout(TIMEOUTS.SCAN_RUN + 60_000);
    await mockEnterpriseLicense(page);
    await registerAndLogin(page, 'mcpwarn');
    await editProjectConfig(page, config => {
      config.mcp_server = { type: 'sse', url: mcp.url };
      config.settings.profiles = ['RANDOM'];
      config.settings.intensity = 1;
    });

    await page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]').fill('http://127.0.0.1:8788/swagger.json');
    await page.locator('button.btn-primary:has-text("Add")').click();
    await expect(page.locator('.tree-leaf-row').first()).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await disableBoundaryProfile(page);
    await page.locator('#btn-start').click();

    // The scan runs to the end instead of failing on the MCP server.
    await expect(page.locator('button.btn-danger[title="Stop"]')).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expect(page.locator('#btn-start')).toBeVisible({ timeout: TIMEOUTS.SCAN_RUN });

    const banner = page.locator('.scan-issue-banner.scan-issue-warning');
    await expect(banner).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expect(banner).toContainText(/The scan completed with \d+ warning/);
    await expect(banner).toContainText('MCP');
    await expect(banner.locator('button:has-text("Open Project Settings")')).toBeVisible();

    // The runner log tells the same story, starting with what the scan covers.
    await banner.locator('button:has-text("Open runner logs")').click();
    const logs = page.locator('.runner-logs-viewer');
    await expect(logs.getByText(/Scan targets: \d+ API endpoint\(s\)/)).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expect(logs.getByText(/The MCP part of the scan is skipped/)).toBeVisible();
  });

  test('a scan with nothing but a rejecting MCP server ends as failed, and says why everywhere', async ({ page }) => {
    test.setTimeout(TIMEOUTS.SCAN_RUN + 60_000);
    await mockEnterpriseLicense(page);
    await registerAndLogin(page, 'mcpfail');
    await editProjectConfig(page, config => {
      config.mcp_server = { type: 'sse', url: mcp.url };
      config.endpoints = [{ method: 'CALL', path: 'mcp://tool/echo', schema: { type: 'object' } }];
      config.settings.profiles = ['RANDOM'];
      config.settings.intensity = 1;
    });

    await expect(page.locator('#btn-start')).toBeEnabled({ timeout: TIMEOUTS.LOAD });
    await page.locator('#btn-start').click();

    // It ends, instead of showing "Running" forever.
    await expect(page.locator('#btn-start')).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await expect(page.locator('.header-status')).toHaveCount(0);

    const banner = page.locator('.scan-issue-banner.scan-issue-error');
    await expect(banner).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expect(banner).toContainText('The scan failed');
    await expect(banner).toContainText(/MCP server/);
    await expect(banner).toContainText('Global Headers');

    await banner.locator('button:has-text("Open runner logs")').click();
    await expect(page.locator('.runner-logs-viewer').getByText(/only target of this scan/).first()).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    // History lists it as failed, with the reason.
    await page.locator('button.tab-bar-btn:has-text("History")').first().click();
    await page.locator('.history-tab-btn:has-text("Failed")').click();
    await expect(page.locator('.history-failure-reason').first()).toContainText(/MCP server/);
  });
});
