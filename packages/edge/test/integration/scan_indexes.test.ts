// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// The hot lookups by scan and by scan status search an index instead of reading the whole table.
// The plans are those of the statements the repositories actually run (recorded, not copied), so
// a change to one of those queries that loses its index fails here.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Env } from '../../src/env';
import { ScansRepository } from '../../src/repositories/scans';
import { ProjectRepository } from '../../src/repositories/projects';
import { applyMigrations } from '../utils/migrations';

const env = rawEnv as unknown as Env;

interface Recorded { sql: string; binds: unknown[] }

/** An env whose DB records every statement prepared through it, with its bindings. */
function recordingEnv(): { env: Env; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop !== 'prepare') return Reflect.get(target, prop, target);
      return (sql: string) => {
        const rec: Recorded = { sql, binds: [] };
        recorded.push(rec);
        const stmt = target.prepare(sql);
        return new Proxy(stmt, {
          get(s, p) {
            if (p !== 'bind') return Reflect.get(s, p, s);
            return (...binds: unknown[]) => {
              rec.binds = binds;
              return s.bind(...binds);
            };
          },
        });
      };
    },
  });
  return { env: { ...env, DB: db } as Env, recorded };
}

/** SQLite's plan for a recorded statement, one step per line. */
async function plan(rec: Recorded): Promise<string> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${rec.sql}`).bind(...rec.binds).all<{ detail: string }>();
  return (results ?? []).map(r => r.detail).join('\n');
}

/** The plans of the statements run by fn that read table (`FROM <table>` in their SQL). */
async function plansOf(table: string, fn: (env: Env) => Promise<unknown>): Promise<string[]> {
  const { env: recEnv, recorded } = recordingEnv();
  await fn(recEnv);
  const touching = recorded.filter(r => new RegExp(`FROM\\s+${table}\\b`, 'i').test(r.sql));
  expect(touching.length).toBeGreaterThan(0);
  return Promise.all(touching.map(plan));
}

/** A full read of a table: `SCAN <table|alias>`, with or without walking a whole index. */
function fullRead(p: string, name: string): boolean {
  return new RegExp(`\\bSCAN ${name}\\b`).test(p);
}

describe('scan lookup indexes', () => {
  beforeAll(async () => {
    await applyMigrations(env);
  });

  it("searches a scan's findings by idx_findings_scan_id", async () => {
    const plans = await plansOf('findings', e => new ScansRepository(e).getFindings('scan-1'));
    for (const p of plans) {
      expect(p).toContain('SEARCH findings USING INDEX idx_findings_scan_id (scan_id=?)');
      expect(fullRead(p, 'findings')).toBe(false);
    }
  });

  it("joins a project's scans to their findings by the index", async () => {
    const plans = await plansOf('findings', e => new ProjectRepository(e).getProjectAnalytics('project-1', null, '30d'));
    for (const p of plans) {
      expect(p).toContain('SEARCH f USING INDEX idx_findings_scan_id (scan_id=?)');
      expect(fullRead(p, 'f')).toBe(false);
      expect(fullRead(p, 's')).toBe(false);
    }
  });

  it('searches active scans by status for the watchdog and the scan lists', async () => {
    const plans = await plansOf('scans', async e => {
      const repo = new ScansRepository(e);
      await repo.hasActiveScans();
      await repo.getStalledActiveScans(10, 50);
      await repo.getStalledActiveScans(10, 50, ['run-1'], 5);
      await repo.getQueuedScans();
      await repo.getActiveScans();
    });
    for (const p of plans) {
      expect(p).toMatch(/SEARCH (scans|s) USING (COVERING )?INDEX idx_scans_status_created \(status=\?/);
      expect(fullRead(p, 'scans')).toBe(false);
      expect(fullRead(p, 's')).toBe(false);
    }
  });
});
