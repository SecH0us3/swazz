// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// The paged scan list against the real schema.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Env } from '../../src/env';
import { ScansRepository, ScansCursor, scansPageSql } from '../../src/repositories/scans';
import { applyMigrations } from '../utils/migrations';

const env = rawEnv as unknown as Env;

async function seedScan(projectId: string, id: string, createdAt: string, status = 'completed'): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO scans (id, project_id, target_url, profile, status, created_at, waf_patch_report) VALUES (?, ?, 'http://t', 'default', ?, ?, '{\"big\":true}')"
  ).bind(id, projectId, status, createdAt).run();
}

describe('scan list', () => {
  beforeAll(async () => {
    await applyMigrations(env);
    // Two scans share a created_at: the id breaks the tie, so neither is skipped or repeated.
    await seedScan('list-p', 'a', '2026-10-01 10:00:00');
    await seedScan('list-p', 'b', '2026-10-02 10:00:00');
    await seedScan('list-p', 'c', '2026-10-02 10:00:00');
    await seedScan('list-p', 'd', '2026-10-03 10:00:00');
    await seedScan('list-p', 'e', '2026-10-04 10:00:00');
    await seedScan('list-other', 'z', '2026-10-05 10:00:00');
  });

  it('walks the project scans newest first, page by page', async () => {
    const repo = new ScansRepository(env);
    const seen: string[] = [];
    let before: ScansCursor | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const { scans, next } = await repo.getScans('list-p', 2, before);
      expect(scans.length).toBeLessThanOrEqual(2);
      seen.push(...scans.map(s => s.id));
      if (!next) break;
      before = next;
    }
    expect(seen).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('says there is no next page when the last one is exactly full', async () => {
    const repo = new ScansRepository(env);
    const { scans, next } = await repo.getScans('list-p', 5);
    expect(scans).toHaveLength(5);
    expect(next).toBeNull();
  });

  it('leaves the large per-scan columns out of the list', async () => {
    const repo = new ScansRepository(env);
    const { scans } = await repo.getScans('list-p', 1);
    expect(scans[0].id).toBe('e');
    expect(scans[0]).not.toHaveProperty('waf_patch_report');
    expect(scans[0]).not.toHaveProperty('last_checkpoint');
    expect(scans[0]).toHaveProperty('summary_stats');
    expect(scans[0]).toHaveProperty('failure_reason');
  });

  it('pages by the project index', async () => {
    // The query the repository runs: a page past the cursor seeks the index to it.
    const plan = await env.DB.prepare('EXPLAIN QUERY PLAN ' + scansPageSql(true))
      .bind('list-p', 'x', 'x', 3).all<any>();
    const detail = (plan.results || []).map(r => r.detail).join('\n');
    expect(detail).toContain('idx_scans_project_created');
    expect(detail).toMatch(/\(created_at,id\)<\(\?,\?\)/);
    expect(detail).not.toContain('TEMP B-TREE');
  });

  it('finds a scan that has not ended behind any number of newer ones', async () => {
    await seedScan('active-p', 'old-paused', '2026-09-01 10:00:00', 'paused');
    for (let i = 0; i < 60; i++) {
      await seedScan('active-p', `done-${String(i).padStart(2, '0')}`, `2026-09-02 10:${String(i).padStart(2, '0')}:00`);
    }
    await seedScan('active-p', 'running', '2026-09-03 10:00:00', 'running');
    const repo = new ScansRepository(env);
    const active = await repo.getUnfinishedScans('active-p', 50);
    expect(active.map(s => s.id)).toEqual(['running', 'old-paused']);
    expect(active[0]).not.toHaveProperty('waf_patch_report');
  });
});
