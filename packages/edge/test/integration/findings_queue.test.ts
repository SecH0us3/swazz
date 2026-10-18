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

describe('findings queue isolation', () => {
  beforeAll(async () => {
    await applyMigrations(env);
  });

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
    expect(msgs[1].retry).toHaveBeenCalled();
    expect(msgs[1].ack).not.toHaveBeenCalled();
    expect((await findingsOf(good)).length).toBe(1);
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
