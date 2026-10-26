// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// An OOB callback that arrives after its run ended used to be lost with the runner's store. The
// runner now hands its unanswered tokens over before its end event (oob_pending), and a later
// callback becomes a finding of the scan. The callback URL is public, so a token reports at most
// once, only for the scan that handed it over, and the response says nothing about which exist.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Env } from '../../src/env';
import { ScansRepository, sanitizeOobPending } from '../../src/repositories/scans';
import { CleanupRepository } from '../../src/repositories/cleanup';
import { OobHandler, LATE_OOB_RETRY_DELAYS_MS } from '../../src/coordinator/handlers/oob';
import { applyMigrations } from '../utils/migrations';

const env = rawEnv as unknown as Env;

async function seedScan(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO scans (id, project_id, target_url, profile, status) VALUES (?, '', 'http://t', 'default', 'dispatched')")
    .bind(id).run();
  return id;
}

const pending = (scanId: string, tokens: any[]) => ({ body: { scanId, type: 'event', payload: { type: 'oob_pending', data: { tokens } } } });
const token = (uuid: string) => ({ uuid, endpoint: 'POST /webhooks', payload: 'http://oob/{{OOB_URL}}' });

async function pendingRows(scanId: string): Promise<any[]> {
  const { results } = await env.DB.prepare('SELECT * FROM oob_pending WHERE scan_id = ? ORDER BY token').bind(scanId).all();
  return results || [];
}

async function oobFindings(scanId: string): Promise<any[]> {
  const { results } = await env.DB.prepare("SELECT * FROM findings WHERE scan_id = ? AND rule_id = 'swazz/oob-interaction'").bind(scanId).all();
  return results || [];
}

// The D1 work runs after the response (waitUntil); a test awaits it before it looks.
let background: Promise<unknown>[] = [];

function handlerContext(jobs: Map<string, any>, handingOver: boolean) {
  return {
    env,
    state: { waitUntil: (p: Promise<unknown>) => { background.push(p); } },
    stateManager: { jobs, oobHandedOverWithin: () => handingOver },
    queueService: {},
  } as any;
}

async function callback(runId: string, uuid: string, opts: { jobs?: Map<string, any>; handingOver?: boolean; settle?: boolean } = {}): Promise<Response> {
  const url = new URL(`http://do/oob/${runId}/${uuid}`);
  const res = await new OobHandler().handle(new Request(url), url, handlerContext(opts.jobs ?? new Map(), opts.handingOver ?? false));
  if (opts.settle !== false) await settle();
  return res;
}

async function settle(): Promise<void> {
  const pending = background;
  background = [];
  await Promise.all(pending);
}

beforeAll(async () => {
  await applyMigrations(env);
});

const defaultDelays = [...LATE_OOB_RETRY_DELAYS_MS];

describe('late OOB callbacks', () => {
  afterEach(() => {
    LATE_OOB_RETRY_DELAYS_MS.splice(0, LATE_OOB_RETRY_DELAYS_MS.length, ...defaultDelays);
  });

  it('stores the handed-over tokens, and the event log keeps only their count', async () => {
    const scan = await seedScan();
    const tokens = sanitizeOobPending({ tokens: [token('tok-a'), token('tok-b'), null, { uuid: '../x' }, { uuid: 5 }] });
    await new ScansRepository(env).storeOobPending(scan, tokens);
    await new ScansRepository(env).processFindingsQueueMessages([pending(scan, [token('tok-a'), token('tok-b')])]);
    expect((await pendingRows(scan)).map(r => r.token)).toEqual(['tok-a', 'tok-b']);
    const ev = await env.DB.prepare('SELECT payload FROM scan_events WHERE scan_id = ?').bind(scan).first<{ payload: string }>();
    expect(JSON.parse(ev!.payload)).toEqual({ type: 'oob_pending', data: { count: 2 } });
  });

  it('a callback after the run ended becomes one finding of that scan', async () => {
    const scan = await seedScan();
    await new ScansRepository(env).storeOobPending(scan, sanitizeOobPending({ tokens: [token('tok-late')] }));

    const first = await callback(scan, 'tok-late');
    const again = await callback(scan, 'tok-late');
    const unknown = await callback(scan, 'tok-never-sent');

    const findings = await oobFindings(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe('error');
    expect(findings[0].message).toContain('POST /webhooks');
    expect(findings[0].evidence).toContain('tok-late');
    expect(await pendingRows(scan)).toHaveLength(0);
    // Same answer whether or not the token existed.
    for (const res of [first, again, unknown]) {
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('swazz-oob-received');
    }
  });

  it('a token reports only for the scan that handed it over', async () => {
    const owner = await seedScan();
    const other = await seedScan();
    await new ScansRepository(env).storeOobPending(owner, sanitizeOobPending({ tokens: [token('tok-owned')] }));
    await callback(other, 'tok-owned');
    expect(await oobFindings(other)).toHaveLength(0);
    expect(await pendingRows(owner)).toHaveLength(1);
  });

  it('a callback while the run is live goes to the runner, and to D1 for a handed-over token', async () => {
    const scan = await seedScan();
    await new ScansRepository(env).storeOobPending(scan, sanitizeOobPending({ tokens: [token('tok-live')] }));
    const sent: string[] = [];
    LATE_OOB_RETRY_DELAYS_MS.splice(0, LATE_OOB_RETRY_DELAYS_MS.length);
    await callback(scan, 'tok-live', { jobs: new Map([[scan, { send: (m: string) => sent.push(m) }]]), handingOver: true });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({ type: 'oob_trigger', payload: { runId: scan, uuid: 'tok-live' } });
    // The run handed the token over already (it is ending), so the runner no longer knows it: D1
    // reports it.
    expect(await oobFindings(scan)).toHaveLength(1);
  });

  it('a callback just after the run ended is retried until its token is stored', async () => {
    const scan = await seedScan();
    LATE_OOB_RETRY_DELAYS_MS.splice(0, LATE_OOB_RETRY_DELAYS_MS.length, 200);
    const res = await callback(scan, 'tok-racing', { handingOver: true, settle: false });
    expect(res.status).toBe(200);
    // The handed-over tokens reach D1 after the callback.
    await new ScansRepository(env).storeOobPending(scan, [{ token: 'tok-racing', endpoint: 'POST /webhooks', payload: 'p' }]);
    await settle();
    expect(await oobFindings(scan)).toHaveLength(1);
  });

  it('a callback for a scan that was deleted reports nothing', async () => {
    const scan = await seedScan();
    await new ScansRepository(env).storeOobPending(scan, sanitizeOobPending({ tokens: [token('tok-gone')] }));
    await env.DB.prepare('DELETE FROM scans WHERE id = ?').bind(scan).run();
    expect(await new ScansRepository(env).recordLateOobCallback(scan, 'tok-gone')).toBe(false);
    expect(await oobFindings(scan)).toHaveLength(0);
  });

  it('an expired token no longer reports and is cleaned up', async () => {
    const scan = await seedScan();
    await env.DB.prepare(
      "INSERT INTO oob_pending (scan_id, token, created_at) VALUES (?, 'tok-old', datetime('now', '-8 days')), (?, 'tok-stale', datetime('now', '-8 days'))"
    ).bind(scan, scan).run();
    expect(await new ScansRepository(env).recordLateOobCallback(scan, 'tok-old')).toBe(false);
    expect(await oobFindings(scan)).toHaveLength(0);
    const changes = await new CleanupRepository(env).cleanupSecurityTables();
    expect(changes.oobPending).toBeGreaterThanOrEqual(1);
    expect(await pendingRows(scan)).toHaveLength(0);
  });

  it('a scan keeps at most 2000 tokens, whatever the runner sends', async () => {
    const scan = await seedScan();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
       INSERT INTO oob_pending (scan_id, token) SELECT ?, 'seed-' || i FROM n`
    ).bind(scan).run();
    await new ScansRepository(env).storeOobPending(scan, sanitizeOobPending({ tokens: [token('tok-over')] }));
    expect(await pendingRows(scan)).toHaveLength(2000);
  });

  it('another tenant cannot claim a late finding by its id', async () => {
    const victim = await seedScan();
    const attacker = await seedScan();
    // A runner may name its findings; one named like a live OOB finding of the token claims nothing.
    await new ScansRepository(env).processFindingsQueueMessages([
      { body: { scanId: attacker, type: 'event', payload: { type: 'result', data: { analyzerFindings: [{ id: 'oob-tok-claim', ruleId: 'x' }] } } } },
    ]);
    await new ScansRepository(env).storeOobPending(victim, [{ token: 'tok-claim', endpoint: 'e', payload: 'p' }]);
    expect(await new ScansRepository(env).recordLateOobCallback(victim, 'tok-claim')).toBe(true);
    expect(await oobFindings(victim)).toHaveLength(1);
  });

  it('the queue copy of a hand-over does not bring back a reported token', async () => {
    const scan = await seedScan();
    await new ScansRepository(env).storeOobPending(scan, [{ token: 'tok-once', endpoint: 'e', payload: 'p' }]);
    await callback(scan, 'tok-once');
    await new ScansRepository(env).processFindingsQueueMessages([pending(scan, [token('tok-once')])]);
    expect(await pendingRows(scan)).toHaveLength(0);
    expect(await oobFindings(scan)).toHaveLength(1);
  });

  it('drops tokens of an unknown scan, and caps an event and its fields', async () => {
    await new ScansRepository(env).storeOobPending('no-such-scan', sanitizeOobPending({ tokens: [token('tok-x')] }));
    expect(await pendingRows('no-such-scan')).toHaveLength(0);

    const many = Array.from({ length: 150 }, (_, i) => ({ uuid: `t${i}`, endpoint: 'e'.repeat(1000), payload: 7 }));
    const clean = sanitizeOobPending({ tokens: many });
    expect(clean).toHaveLength(100);
    expect(clean[0]!.endpoint).toHaveLength(256);
    expect(clean[0]!.payload).toBe('');
    expect(sanitizeOobPending({ tokens: 'nope' })).toEqual([]);
  });
});
