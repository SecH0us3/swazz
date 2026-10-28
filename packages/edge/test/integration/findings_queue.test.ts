// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Runner events reach a findings-queue batch shared by every tenant. Nothing one runner sends
// may stop another tenant's findings and scan status from being saved.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { Env } from '../../src/env';
import { ScansRepository, sanitizeRunnerFinding } from '../../src/repositories/scans';
import worker from '../../src/index';
import { applyMigrations } from '../utils/migrations';

const env = rawEnv as unknown as Env;

async function seedScan(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO scans (id, project_id, target_url, profile, status) VALUES (?, '', 'http://t', 'default', 'dispatched')")
    .bind(id).run();
  return id;
}

async function findingsOf(scanId: string): Promise<any[]> {
  const { results } = await env.DB.prepare('SELECT * FROM findings WHERE scan_id = ? ORDER BY rule_id').bind(scanId).all();
  return results || [];
}

const event = (scanId: string, payload: any, type: any = 'event') => ({ body: { scanId, type, payload } });

beforeAll(async () => {
  await applyMigrations(env);
});

describe('findings queue isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('drops malformed findings and still saves the rest of a mixed-tenant batch', async () => {
    const attackerScan = await seedScan();
    const victimScan = await seedScan();

    await new ScansRepository(env).processFindingsQueueMessages([
      event(attackerScan, { type: 'result', data: { analyzerFindings: [null, 5, 'x', [], { ruleId: { a: 1 }, level: 7 }] } }),
      event(attackerScan, undefined, null),
      event(victimScan, { type: 'result', data: { analyzerFindings: [{ ruleId: 'swazz/xss', level: 'error', message: 'm', evidence: 'e' }] } }),
      event(victimScan, { type: 'complete', data: { total: 1 } }),
    ]);

    const victim = await findingsOf(victimScan);
    expect(victim.map(f => f.rule_id)).toEqual(['swazz/xss']);
    const status = await env.DB.prepare('SELECT status FROM scans WHERE id = ?').bind(victimScan).first<{ status: string }>();
    expect(status?.status).toBe('completed');
  });

  it('a repeated finding id is ignored instead of failing the batch', async () => {
    const scanA = await seedScan();
    const scanB = await seedScan();
    const id = 'f_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

    await new ScansRepository(env).processFindingsQueueMessages([
      event(scanA, { type: 'result', data: { analyzerFindings: [{ id, ruleId: 'a' }] } }),
    ]);
    await new ScansRepository(env).processFindingsQueueMessages([
      event(scanA, { type: 'result', data: { analyzerFindings: [{ id, ruleId: 'a-again' }] } }),
      event(scanB, { type: 'result', data: { analyzerFindings: [{ ruleId: 'b' }] } }),
    ]);

    expect((await findingsOf(scanB)).map(f => f.rule_id)).toEqual(['b']);
  });

  it('the consumer retries only the messages that still fail on their own', async () => {
    const good = await seedScan();
    const bad = await seedScan();
    const original = ScansRepository.prototype.processFindingsQueueMessages;
    vi.spyOn(ScansRepository.prototype, 'processFindingsQueueMessages').mockImplementation(async function (this: ScansRepository, messages: readonly any[], ctx?: any) {
      if (messages.some(m => m.body.scanId === bad)) throw new Error('poisoned');
      return original.call(this, messages, ctx);
    });
    const msgs = [good, bad].map(scanId => ({
      ...event(scanId, { type: 'result', data: { analyzerFindings: [{ ruleId: `r-${scanId}` }] } }),
      ack: vi.fn(),
      retry: vi.fn(),
    }));

    await worker.queue({ queue: 'swazz-findings-queue', messages: msgs } as any, env, { waitUntil: () => {} } as any);

    expect(msgs[0].ack).toHaveBeenCalled();
    expect(msgs[0].retry).not.toHaveBeenCalled();
    expect(msgs[1].retry).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(msgs[1].ack).not.toHaveBeenCalled();
    expect((await findingsOf(good)).length).toBe(1);
  });

  it('acknowledges instead of retrying when message attempts reach 3', async () => {
    const bad = crypto.randomUUID();
    const failingMsg = {
      ...event(bad, { type: 'result', data: {} }),
      attempts: 3,
      ack: vi.fn(),
      retry: vi.fn(),
    };

    // Force processFindingsQueueMessages to fail on both batch and single message
    const repoSpy = vi.spyOn(ScansRepository.prototype, 'processFindingsQueueMessages')
      .mockRejectedValue(new Error('Persistent D1 connection failure'));

    await worker.queue({ queue: 'swazz-findings-queue', messages: [failingMsg] } as any, env, { waitUntil: () => {} } as any);

    expect(failingMsg.ack).toHaveBeenCalled();
    expect(failingMsg.retry).not.toHaveBeenCalled();
    repoSpy.mockRestore();
  });

  it('short-circuits per-message retries and backs off on D1_ERROR: Exceeded maximum DB size', async () => {
    const bad = crypto.randomUUID();
    const quotaMsgAttempt1 = {
      ...event(bad, { type: 'result', data: {} }),
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const quotaMsgAttempt3 = {
      ...event(bad, { type: 'result', data: {} }),
      attempts: 3,
      ack: vi.fn(),
      retry: vi.fn(),
    };

    const repoSpy = vi.spyOn(ScansRepository.prototype, 'processFindingsQueueMessages')
      .mockRejectedValue(new Error('D1_ERROR: Exceeded maximum DB size (10737418240 bytes)'));

    await worker.queue({ queue: 'swazz-findings-queue', messages: [quotaMsgAttempt1, quotaMsgAttempt3] } as any, env, { waitUntil: () => {} } as any);

    // Must short-circuit after the single bulk call without running per-message calls
    expect(repoSpy).toHaveBeenCalledTimes(1);
    expect(quotaMsgAttempt1.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(quotaMsgAttempt1.ack).not.toHaveBeenCalled();
    expect(quotaMsgAttempt3.ack).toHaveBeenCalled();
    expect(quotaMsgAttempt3.retry).not.toHaveBeenCalled();
    repoSpy.mockRestore();
  });
});

describe('sanitizeRunnerFinding', () => {
  it('rejects non-objects and findings without a rule id', () => {
    for (const raw of [null, undefined, 5, 'x', [], {}, { ruleId: '' }]) {
      expect(sanitizeRunnerFinding(raw)).toBeNull();
    }
  });

  it('keeps a plain identifier and replaces anything else', () => {
    expect(sanitizeRunnerFinding({ id: 'abc12345', ruleId: 'r' })!.id).toBe('abc12345');
    expect(sanitizeRunnerFinding({ id: "x'; DROP TABLE findings;--", ruleId: 'r' })!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sanitizeRunnerFinding({ id: 42, ruleId: 'r' })!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('coerces and bounds every text field', () => {
    const f = sanitizeRunnerFinding({ ruleId: 'r'.repeat(1000), level: 3, message: { a: 1 }, evidence: 'e'.repeat(200_000) })!;
    expect(f.ruleId.length).toBe(256);
    expect(f.level).toBe('3');
    expect(typeof f.message).toBe('string');
    expect(f.evidence!.length).toBe(64 * 1024);
  });
});

// Acknowledged delivery: an event the coordinator processes twice (a replay after a restart, a
// queue redelivery, or the queue and its D1 fallback both succeeding) must be stored once.
describe('sequenced runner events', () => {
  const sequenced = (scanId: string, seq: number, exec = 'abc123') =>
    ({ body: { scanId, type: 'event', payload: { type: 'result', data: { id: `r${seq}` } }, exec, seq } });

  async function eventCount(scanId: string): Promise<number> {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM scan_events WHERE scan_id = ?').bind(scanId).first<{ n: number }>();
    return row?.n ?? 0;
  }

  it('stores each event once, within a batch and across batches', async () => {
    const scanId = await seedScan();
    const repo = new ScansRepository(env);
    await repo.processFindingsQueueMessages([sequenced(scanId, 1), sequenced(scanId, 1), sequenced(scanId, 2)]);
    await repo.processFindingsQueueMessages([sequenced(scanId, 2), sequenced(scanId, 3)]);
    expect(await eventCount(scanId)).toBe(3);

    // Another execution of the run numbers from 1 again: different events.
    await repo.processFindingsQueueMessages([sequenced(scanId, 1, 'def456')]);
    expect(await eventCount(scanId)).toBe(4);
  });

  it('does not repeat the effects of a terminal event stored before', async () => {
    const scanId = await seedScan();
    const repo = new ScansRepository(env);
    const complete = { body: { scanId, type: 'event', payload: { type: 'complete', data: { total: 1 } }, exec: 'abc123', seq: 9 } };
    await repo.processFindingsQueueMessages([complete]);
    await env.DB.prepare("UPDATE scans SET status = 'dispatched' WHERE id = ?").bind(scanId).run();
    await repo.processFindingsQueueMessages([complete]);
    const status = await env.DB.prepare('SELECT status FROM scans WHERE id = ?').bind(scanId).first<{ status: string }>();
    expect(status?.status).toBe('dispatched');
  });

  it('gives events without a valid exec and seq ids of their own', async () => {
    const scanId = await seedScan();
    await new ScansRepository(env).processFindingsQueueMessages([
      sequenced(scanId, 1, 'x:y'),
      sequenced(scanId, 1, 'x:y'),
      { body: { scanId, type: 'event', payload: { type: 'result' } } },
      { body: { scanId, type: 'event', payload: { type: 'result' } } },
    ]);
    expect(await eventCount(scanId)).toBe(4);
  });

  it('compacts payload and coalesces progress and [Fuzz Progress] rows while preserving runner_log and error', async () => {
    const scanId = await seedScan();
    const repo = new ScansRepository(env);

    await repo.processFindingsQueueMessages([
      { body: { scanId, type: 'event', payload: { type: 'progress', data: { bigData: 'x'.repeat(1000) } } } },
      { body: { scanId, type: 'event', payload: { type: 'progress', data: { bigData: 'y'.repeat(1000) } } } },
      { body: { scanId, type: 'event', payload: { type: 'result', data: { analyzerFindings: [{ ruleId: 'compact-test' }] } } } },
      { body: { scanId, type: 'event', payload: { type: 'runner_log', data: { level: 'info', message: '[Fuzz Progress] 10/100 requests' } } } },
      { body: { scanId, type: 'event', payload: { type: 'runner_log', data: { level: 'info', message: '[Fuzz Progress] 50/100 requests' } } } },
      { body: { scanId, type: 'event', payload: { type: 'runner_log', data: { level: 'info', message: 'runner log text' } } } },
      { body: { scanId, type: 'error', payload: { type: 'error', error: 'fatal error text' } } },
    ]);

    const { results } = await env.DB.prepare('SELECT id, type, payload FROM scan_events WHERE scan_id = ? ORDER BY created_at ASC').bind(scanId).all<{ id: string; type: string; payload: string }>();
    // 2 progress events coalesced to 1 + 1 result + 2 [Fuzz Progress] coalesced to 1 + 1 runner_log + 1 error = 5 rows
    expect(results?.length).toBe(5);

    const progressEvents = results?.filter(r => r.payload === '{"type":"progress"}');
    expect(progressEvents?.length).toBe(1);
    expect(progressEvents?.[0].id).toBe(`${scanId}:progress`);

    const resultEvent = results?.find(r => r.payload === '{"type":"result"}');
    expect(resultEvent).toBeDefined();

    const runnerLogs = await repo.getRunnerLogs(scanId);
    // Latest [Fuzz Progress] line is still visible in getRunnerLogs along with regular runner_log and error
    expect(runnerLogs.some((r: any) => r.payload.includes('[Fuzz Progress] 50/100 requests'))).toBe(true);
    expect(runnerLogs.some((r: any) => r.payload.includes('[Fuzz Progress] 10/100 requests'))).toBe(false);
    expect(runnerLogs.some((r: any) => r.payload.includes('runner log text'))).toBe(true);
    expect(runnerLogs.some((r: any) => r.payload.includes('fatal error text'))).toBe(true);
  });
});
