// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// The queries behind a failed scan's reason, its runner log, and the stalled scan watchdog.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Env } from '../../src/env';
import { ScansRepository } from '../../src/repositories/scans';
import { applyMigrations } from '../utils/migrations';

const env = rawEnv as unknown as Env;

async function seedScan(status: string, createdAgo: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO scans (id, project_id, target_url, profile, status, created_at) VALUES (?, '', 'http://t', 'default', ?, datetime('now', ?))"
  ).bind(id, status, createdAgo).run();
  return id;
}

async function seedEvent(scanId: string, type: string, payload: unknown, ago: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO scan_events (id, scan_id, type, payload, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))"
  ).bind(crypto.randomUUID(), scanId, type, JSON.stringify(payload), ago).run();
}

describe('scan failure queries', () => {
  beforeAll(async () => {
    await applyMigrations(env);
  });

  it('reads the most recent error of each scan, in either stored shape', async () => {
    const repo = new ScansRepository(env);
    const a = await seedScan('failed', '-1 hour');
    const b = await seedScan('failed', '-1 hour');
    const quiet = await seedScan('failed', '-1 hour');
    await seedEvent(a, 'error', { error: 'older' }, '-30 minutes');
    await seedEvent(a, 'error', { error: 'newest\ngoroutine 1 [running]:' }, '-10 minutes');
    await seedEvent(a, 'event', { type: 'runner_log', data: { level: 'error', message: 'not an error event' } }, '-1 minutes');
    await seedEvent(b, 'event', { type: 'error', data: { message: 'from the runner event bus' } }, '-5 minutes');

    const reasons = await repo.getFailureReasons([a, b, quiet]);
    expect(reasons.get(a)).toBe('newest');
    expect(reasons.get(b)).toBe('from the runner event bus');
    expect(reasons.has(quiet)).toBe(false);
  });

  it('includes errors in the runner log, in order', async () => {
    const repo = new ScansRepository(env);
    const id = await seedScan('failed', '-1 hour');
    await seedEvent(id, 'event', { type: 'runner_log', data: { level: 'info', message: 'Starting' } }, '-3 minutes');
    await seedEvent(id, 'event', { type: 'result', data: {} }, '-2 minutes');
    await seedEvent(id, 'error', { error: 'boom' }, '-1 minutes');
    const rows = await repo.getRunnerLogs(id);
    expect(rows.map((r: any) => r.type)).toEqual(['event', 'error']);
  });

  it('finds active scans with no recent event as watchdog candidates', async () => {
    const repo = new ScansRepository(env);
    const idleDispatched = await seedScan('dispatched', '-2 hours');
    const idlePaused = await seedScan('paused', '-2 hours');
    const recentlyActive = await seedScan('dispatched', '-2 hours');
    await seedEvent(recentlyActive, 'event', { type: 'progress' }, '-1 minutes');
    const oldButReported = await seedScan('dispatched', '-2 hours');
    await seedEvent(oldButReported, 'event', { type: 'progress' }, '-30 minutes');
    const justCreated = await seedScan('dispatched', '-1 minutes');
    const finished = await seedScan('completed', '-2 hours');
    const queued = await seedScan('queued', '-2 hours');

    const found = await repo.getStalledActiveScans(10, 500);
    expect(found).toEqual(expect.arrayContaining([idleDispatched, idlePaused, oldButReported]));
    for (const id of [recentlyActive, justCreated, finished, queued]) expect(found).not.toContain(id);
    expect((await repo.getStalledActiveScans(10, 1)).length).toBe(1);
  });
});
