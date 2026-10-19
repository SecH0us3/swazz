// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A runner's WebSocket can die mid-scan without the coordinator noticing (a reset stream on the
// agent's side only). The agent reconnects and keeps the scan running; its results must still
// reach the dashboard instead of being dropped as events of a run the new connection does not own,
// and the scan must not be dispatched a second time. Events written into the dead connection
// before anyone noticed must be delivered too (acknowledged delivery), each exactly once.

import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import { TIMEOUTS, registerAndLogin, disableBoundaryProfile } from './helpers';

/**
 * A TCP proxy to the coordinator that can break the runner's connection the way a NAT or edge
 * does: blackholed (the agent's writes succeed locally but never arrive) and then reset on the
 * agent's side only, while the coordinator's side stays open and silent. It notices the first
 * job_dispatch it forwards (server-to-client WebSocket frames are unmasked).
 */
async function startBreakableProxy(targetPort: number) {
  const links = new Set<{ client: net.Socket; upstream: net.Socket; blackholed: boolean }>();
  let dispatched = false;
  const server = net.createServer(client => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    const link = { client, upstream, blackholed: false };
    links.add(link);
    for (const s of [client, upstream]) {
      s.on('error', () => {});
      s.on('close', () => links.delete(link));
    }
    client.on('data', chunk => { if (!link.blackholed) upstream.write(chunk); });
    upstream.on('data', chunk => {
      if (link.blackholed) return;
      client.write(chunk);
      if (chunk.includes('job_dispatch')) dispatched = true;
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    dispatched: () => dispatched,
    /** Everything the agent sends from now on is silently lost. */
    blackhole: () => { for (const l of links) l.blackholed = true; },
    /** The agent sees its connection reset; the coordinator sees nothing. */
    resetAgentSide: () => { for (const l of links) { l.blackholed = true; l.client.resetAndDestroy(); } },
    close: () => {
      for (const l of links) { l.client.destroy(); l.upstream.destroy(); }
      server.close();
    },
  };
}

type Proxy = Awaited<ReturnType<typeof startBreakableProxy>>;

test.describe('Runner reconnect mid-scan', () => {
  let agent: ChildProcess | null = null;
  let proxy: Proxy | null = null;
  let agentLog = '';
  let resultIds: string[] = [];

  test.afterEach(() => {
    agent?.kill();
    agent = null;
    proxy?.close();
    proxy = null;
  });

  /** Registers a user, connects their own runner through the proxy and starts a demo scan. */
  async function startScanThroughProxy(page: Page): Promise<void> {
    // Every result the dashboard receives for the run, as the coordinator streams it.
    resultIds = [];
    page.on('websocket', ws => ws.on('framereceived', frame => {
      try {
        const msg = JSON.parse(String(frame.payload));
        if (msg?.type === 'result' && msg.data?.id) resultIds.push(String(msg.data.id));
      } catch { /* not JSON */ }
    }));
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

    proxy = await startBreakableProxy(8787);
    agentLog = '';
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

    await page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]').fill('http://127.0.0.1:8788/swagger.json');
    await page.locator('button.btn-primary:has-text("Add")').click();
    await expect(page.locator('.tree-leaf-row').first()).toBeVisible({ timeout: TIMEOUTS.LOAD });
    await disableBoundaryProfile(page);

    await page.locator('#btn-start').click();
    await expect(page.locator('button.btn-danger[title="Stop"]')).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await expect.poll(() => proxy!.dispatched(), { timeout: TIMEOUTS.LOAD }).toBe(true);
  }

  /**
   * The scan finishes in the dashboard, none of its results is lost (at least one per request the
   * agent made; out-of-band callbacks add more) and none arrives twice.
   */
  async function expectScanDeliveredExactlyOnce(page: Page): Promise<void> {
    await expect(page.locator('#btn-start')).toBeVisible({ timeout: TIMEOUTS.SCAN_RUN });
    const executed = Number(agentLog.match(/finished with (\d+) requests/)?.[1]);
    expect(executed).toBeGreaterThan(0);
    expect(resultIds.length).toBeGreaterThanOrEqual(executed);
    expect(new Set(resultIds).size).toBe(resultIds.length);
    await expect(page.locator('button.tab-bar-btn:has-text("Logs")')).toContainText(resultIds.length.toLocaleString('en-US'), { timeout: TIMEOUTS.DEFAULT });
    expect(agentLog.match(/Received job dispatch/g)).toHaveLength(1);
  }

  test('results of a scan survive a half-open drop of the runner connection', async ({ page }) => {
    test.setTimeout(TIMEOUTS.SCAN_RUN + 60_000);
    await startScanThroughProxy(page);

    // Shortly after the dispatch, the agent's side is reset and it reconnects mid-scan.
    await page.waitForTimeout(150);
    proxy!.resetAgentSide();
    await expect.poll(() => agentLog, { timeout: TIMEOUTS.LOAD }).toMatch(/Claimed \d+ active run\(s\) for resume/);

    await expectScanDeliveredExactlyOnce(page);
  });

  test('events written into a silently dead connection are delivered after the reconnect', async ({ page }) => {
    test.setTimeout(TIMEOUTS.SCAN_RUN + 60_000);
    await startScanThroughProxy(page);

    // From the dispatch on, nothing the agent sends arrives, and nothing tells it so: the whole
    // scan, "complete" included, is written into the void.
    proxy!.blackhole();
    await expect.poll(() => agentLog, { timeout: TIMEOUTS.SCAN_RUN }).toContain('[Fuzz Complete]');
    proxy!.resetAgentSide();
    await expect.poll(() => agentLog, { timeout: TIMEOUTS.LOAD }).toMatch(/Claimed \d+ active run\(s\) for resume/);

    await expectScanDeliveredExactlyOnce(page);
  });
});
