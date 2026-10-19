// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A runner's WebSocket can die mid-scan without the coordinator noticing (a reset stream on the
// agent's side only). The agent reconnects and keeps the scan running; its results must still
// reach the dashboard instead of being dropped as events of a run the new connection does not own,
// and the scan must not be dispatched a second time.

import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import { TIMEOUTS, registerAndLogin, disableBoundaryProfile } from './helpers';

/**
 * A TCP proxy to the coordinator that breaks the runner's connection shortly after it forwards the
 * first job_dispatch (server-to-client WebSocket frames are unmasked, so the type is visible). The
 * break is half-open, as when a NAT or edge drops a stream: the agent's side is reset, while the
 * coordinator's side stays open and silent, so the coordinator never learns the socket is dead.
 */
async function startHalfOpenProxy(targetPort: number): Promise<{ port: number; breaks: () => number; close: () => void }> {
  const sockets = new Set<net.Socket>();
  let breaks = 0;
  let armed = true;
  const server = net.createServer(client => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    let broken = false;
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      s.on('error', () => {});
    }
    client.on('data', chunk => { if (!broken) upstream.write(chunk); });
    upstream.on('data', chunk => {
      if (broken) return;
      client.write(chunk);
      if (armed && chunk.includes('job_dispatch')) {
        armed = false;
        setTimeout(() => {
          broken = true;
          breaks++;
          client.resetAndDestroy();
        }, 150);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    breaks: () => breaks,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

test.describe('Runner reconnect mid-scan', () => {
  let agent: ChildProcess | null = null;
  let proxy: Awaited<ReturnType<typeof startHalfOpenProxy>> | null = null;

  test.afterEach(() => {
    agent?.kill();
    agent = null;
    proxy?.close();
    proxy = null;
  });

  test('results of a scan survive a half-open drop of the runner connection', async ({ page }) => {
    test.setTimeout(TIMEOUTS.SCAN_RUN + 60_000);
    await registerAndLogin(page, 'recon', false);

    // The user's own runner (connected with their API key) gets their scans ahead of the shared one.
    const apiKey = await page.evaluate(async () => {
      const res = await fetch('/api/auth/regenerate-key', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('swazz_token')}` },
      });
      return (await res.json()).api_key as string;
    });
    expect(apiKey).toMatch(/^swazz_live_/);

    proxy = await startHalfOpenProxy(8787);
    let agentLog = '';
    const agentBinary = path.join(process.cwd(), 'packages/container', process.platform === 'win32' ? 'swazz-engine.exe' : 'swazz-engine');
    agent = spawn(agentBinary, [
      'run-agent',
      '--coordinator', `ws://127.0.0.1:${proxy.port}/api/runners/connect`,
      '--token', apiKey,
      '--dangerous-no-container',
      '--allow-private-networks',
      '--name', 'runner-reconnect-e2e',
    ]);
    const onOutput = (data: Buffer) => { agentLog += data.toString(); };
    agent.stdout?.on('data', onOutput);
    agent.stderr?.on('data', onOutput);
    await expect.poll(() => agentLog, { timeout: TIMEOUTS.LOAD }).toContain('Successfully connected to coordinator');

    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
    await page.locator('button.btn-primary:has-text("Add")').click();
    await expect(page.locator('.tree-leaf-row').first()).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await disableBoundaryProfile(page);

    const startBtn = page.locator('#btn-start');
    await startBtn.click();
    await expect(page.locator('button.btn-danger[title="Stop"]')).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    // The scan ran on this runner, its connection was reset, and it resumed the run on reconnect.
    await expect.poll(() => agentLog, { timeout: TIMEOUTS.LOAD }).toContain('Received job dispatch');
    await expect.poll(() => proxy!.breaks(), { timeout: TIMEOUTS.LOAD }).toBe(1);
    await expect.poll(() => agentLog, { timeout: TIMEOUTS.LOAD }).toMatch(/Resumed \d+ active run/);

    // The completion event arrived over the new connection: the scan finishes in the dashboard,
    // with its request log populated.
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.SCAN_RUN });
    await expect(page.locator('button.tab-bar-btn:has-text("Logs")')).toContainText(/[1-9]\d*/, { timeout: TIMEOUTS.DEFAULT });
    expect(agentLog.match(/Received job dispatch/g)).toHaveLength(1);
  });
});
