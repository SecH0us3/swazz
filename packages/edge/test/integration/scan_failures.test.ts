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

  it('reads the reason a scan failed with from the scan', async () => {
    const repo = new ScansRepository(env);
    const id = await seedScan('dispatched', '-1 hour');
    const { ended } = await repo.processFindingsQueueMessages([{ body: { scanId: id, type: 'error', payload: { error: 'could not connect to https://u:p@mcp.example/sse?token=SECRET' } } }]);
    expect(ended).toEqual([id]);
    const row = await env.DB.prepare('SELECT status, failure_reason FROM scans WHERE id = ?').bind(id).first<any>();
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBe('could not connect to https://…@mcp.example/…?…');
    expect((await repo.getFailureReasons([id])).get(id)).toBe('could not connect to https://…@mcp.example/…?…');

    expect(await repo.markFailedIfActive(id, 'too late')).toBe(false);
    const stopped = await seedScan('queued', '-1 minutes');
    expect(await repo.markFailedIfActive(stopped, 'The scan was stopped before a runner started it.')).toBe(true);
    expect((await repo.getFailureReasons([stopped])).get(stopped)).toBe('The scan was stopped before a runner started it.');
  });

  // The stalled scan watchdog failed it; the runner came back and completed it: the user was told
  // it failed, and the scan.failed webhook went out, so it stays failed.
  it('lets the first terminal event of a scan win', async () => {
    const repo = new ScansRepository(env);
    const id = await seedScan('dispatched', '-1 hour');
    const failed = await repo.processFindingsQueueMessages([{ body: { scanId: id, type: 'error', payload: { error: 'Runner lost' } } }]);
    const completed = await repo.processFindingsQueueMessages([{ body: { scanId: id, type: 'event', payload: { type: 'complete', data: { totalRequests: 3 } } } }]);
    expect(failed.ended).toEqual([id]);
    expect(completed.ended).toEqual([]);
    const row = await env.DB.prepare('SELECT status, summary_stats FROM scans WHERE id = ?').bind(id).first<any>();
    expect(row.status).toBe('failed');
    expect(row.summary_stats).toBeNull();

    // Within one batch too.
    const other = await seedScan('dispatched', '-1 hour');
    const both = await repo.processFindingsQueueMessages([
      { body: { scanId: other, type: 'event', payload: { type: 'complete', data: {} } } },
      { body: { scanId: other, type: 'error', payload: { error: 'late' } } },
    ]);
    expect(both.ended).toEqual([other]);
    expect((await env.DB.prepare('SELECT status FROM scans WHERE id = ?').bind(other).first<any>()).status).toBe('completed');
  });

  it('falls back to the most recent stored error for scans that failed before reasons were kept', async () => {
    const repo = new ScansRepository(env);
    const a = await seedScan('failed', '-1 hour');
    const b = await seedScan('failed', '-1 hour');
    const quiet = await seedScan('failed', '-1 hour');
    await seedEvent(a, 'error', { error: 'older' }, '-30 minutes');
    await seedEvent(a, 'error', { error: 'newest\ngoroutine 1 [running]:' }, '-10 minutes');
    await seedEvent(a, 'event', { type: 'runner_log', data: { level: 'error', message: 'not an error event' } }, '-1 minutes');
    await seedEvent(b, 'event', { type: 'error', data: { message: 'from the runner event bus' } }, '-5 minutes');

    await env.DB.prepare("UPDATE scans SET failure_reason = NULL WHERE id IN (?, ?, ?)").bind(a, b, quiet).run();
    const reasons = await repo.getFailureReasons([a, b, quiet]);
    expect(reasons.get(a)).toBe('newest');
    expect(reasons.get(b)).toBe('from the runner event bus');
    expect(reasons.has(quiet)).toBe(false);

    // Kept on the scan, so its events are searched once, not on every listing.
    const stored = await env.DB.prepare('SELECT id, failure_reason FROM scans WHERE id IN (?, ?, ?)').bind(a, b, quiet).all<any>();
    expect(Object.fromEntries(stored.results.map((r: any) => [r.id, r.failure_reason]))).toEqual({
      [a]: 'newest', [b]: 'from the runner event bus', [quiet]: 'The scan failed without an error message.',
    });
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

    const found = await repo.getStalledActiveScans(10, 500, [], 60);
    const ids = found.map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining([idleDispatched, idlePaused, oldButReported]));
    for (const id of [recentlyActive, justCreated, finished, queued]) expect(ids).not.toContain(id);
    const byId = new Map(found.map(s => [s.id, s]));
    expect(byId.get(idleDispatched)).toMatchObject({ status: 'dispatched' });
    expect(byId.get(idlePaused)).toMatchObject({ status: 'paused' });
    expect(byId.get(idleDispatched)!.idle_minutes).toBeGreaterThanOrEqual(119);
    expect(byId.get(oldButReported)!.idle_minutes).toBeGreaterThanOrEqual(29);
    expect(byId.get(oldButReported)!.idle_minutes).toBeLessThan(35);
    expect((await repo.getStalledActiveScans(10, 1)).length).toBe(1);
  });

  // A scan that waited an hour in the queue, or was paused for hours, has just been dispatched or
  // resumed: it is not stalled, though its last event is old.
  it('counts idle time from the latest status change too', async () => {
    const repo = new ScansRepository(env);
    const waited = await seedScan('queued', '-2 hours');
    await repo.updateScanStatus(waited, 'dispatched');
    const resumed = await seedScan('dispatched', '-3 hours');
    await seedEvent(resumed, 'event', { type: 'progress' }, '-2 hours');
    await repo.updateScanStatus(resumed, 'paused');
    await repo.updateScanStatus(resumed, 'dispatched');
    const ids = (await repo.getStalledActiveScans(10, 500, [], 60)).map(s => s.id);
    expect(ids).not.toContain(waited);
    expect(ids).not.toContain(resumed);
  });

  // Owned paused scans (paused on purpose, with a runner) used to fill the batch on every pass
  // and keep the orphaned scans from ever being looked at.
  it('keeps scans a runner owns out of the orphaned batch, and lists owned ones only once silent long enough', async () => {
    const repo = new ScansRepository(env);
    const ownedPaused = await seedScan('paused', '-5 hours');
    const ownedSilent = await seedScan('dispatched', '-2 hours');
    const ownedRecent = await seedScan('dispatched', '-30 minutes');
    const orphan = await seedScan('dispatched', '-20 minutes');
    const owned = [ownedPaused, ownedSilent, ownedRecent];

    const found = await repo.getStalledActiveScans(10, 500, owned, 60);
    const ids = found.map(s => s.id);
    expect(ids).toContain(orphan);
    expect(ids).toContain(ownedSilent);
    expect(ids).not.toContain(ownedPaused);
    expect(ids).not.toContain(ownedRecent);
    // However small the batch, no owned scan takes an orphaned scan's place in it.
    const [firstOrphaned] = await repo.getStalledActiveScans(10, 1, owned, 60);
    expect(owned).not.toContain(firstOrphaned.id);
  });

  it('gives scans that could not be queued a reason', async () => {
    const repo = new ScansRepository(env);
    const id = await seedScan('queued', '-1 minutes');
    await repo.updateScanStatus(id, 'failed', undefined, undefined, 'The scan could not be queued, so it never started.');
    expect((await repo.getFailureReasons([id])).get(id)).toBe('The scan could not be queued, so it never started.');
    expect(await repo.hasActiveScans()).toBe(true);
  });
});
