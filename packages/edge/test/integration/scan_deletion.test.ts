// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// D1 enforces no foreign keys here, so a scan's findings, events and pending OOB tokens used to
// outlive the scan when its project or account was deleted. Every path that deletes scans now
// deletes those rows with them (scanDeletion.ts), and leaves other scans' rows alone.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Env } from '../../src/env';
import { CleanupRepository } from '../../src/repositories/cleanup';
import { ProjectRepository } from '../../src/repositories/projects';
import { SCAN_CHILD_TABLES, SCAN_CHILD_DELETE_CHUNK, purgeScanChildren } from '../../src/repositories/scanDeletion';
import { applyMigrations } from '../utils/migrations';

const env = rawEnv as unknown as Env;

beforeAll(async () => {
  await applyMigrations(env);
});

/** A scan with one row in every child table. */
async function seedScan(opts: { projectId?: string; userId?: string | null }): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO scans (id, project_id, target_url, profile, status, user_id) VALUES (?, ?, 'http://t', 'default', 'completed', ?)")
      .bind(id, opts.projectId ?? '', opts.userId ?? null),
    env.DB.prepare("INSERT INTO findings (id, scan_id, rule_id, level, message) VALUES (?, ?, 'swazz/x', 'warning', 'm')")
      .bind(`f-${id}`, id),
    env.DB.prepare("INSERT INTO scan_events (id, scan_id, type, payload) VALUES (?, ?, 'event', '{}')")
      .bind(`e-${id}`, id),
    env.DB.prepare("INSERT INTO oob_pending (scan_id, token) VALUES (?, ?)")
      .bind(id, crypto.randomUUID()),
  ]);
  return id;
}

/** How many rows each child table still holds for the scan. */
async function childRows(scanId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of SCAN_CHILD_TABLES) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id = ?`).bind(scanId).first<{ n: number }>();
    out[table] = row?.n ?? -1;
  }
  return out;
}

const none = Object.fromEntries(SCAN_CHILD_TABLES.map(t => [t, 0]));
const one = Object.fromEntries(SCAN_CHILD_TABLES.map(t => [t, 1]));

async function seedUser(): Promise<{ id: string; username: string }> {
  const id = crypto.randomUUID();
  const username = `u_${id}`;
  await env.DB.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'h')").bind(id, username).run();
  return { id, username };
}

describe('deleting scans deletes their findings, events and pending OOB tokens', () => {
  it('when a project is deleted', async () => {
    const projectId = crypto.randomUUID();
    const gone = await seedScan({ projectId });
    const kept = await seedScan({ projectId: crypto.randomUUID() });

    await new ProjectRepository(env).deleteProject(projectId);

    expect(await env.DB.prepare('SELECT id FROM scans WHERE id = ?').bind(gone).first()).toBeNull();
    expect(await childRows(gone)).toEqual(none);
    expect(await childRows(kept)).toEqual(one);
  });

  it('when a guest account is deleted, with its own scans and its projects\' scans', async () => {
    const user = await seedUser();
    const projectId = crypto.randomUUID();
    const own = await seedScan({ userId: user.id });
    const inProject = await seedScan({ projectId });
    const kept = await seedScan({ userId: (await seedUser()).id });

    await new CleanupRepository(env).deleteGuestUserData(user.id, [projectId], user.username);

    expect(await childRows(own)).toEqual(none);
    expect(await childRows(inProject)).toEqual(none);
    expect(await childRows(kept)).toEqual(one);
  });

  it('when accounts are purged in bulk, with and without projects', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const projectId = crypto.randomUUID();
    const ofA = await seedScan({ userId: a.id });
    const inProject = await seedScan({ projectId });
    const ofB = await seedScan({ userId: b.id });
    const kept = await seedScan({ userId: (await seedUser()).id });

    const repo = new CleanupRepository(env);
    await repo.deleteUsersData([a.id], [projectId], [a.username]);
    await repo.deleteUsersData([b.id], [], [b.username]);

    expect(await childRows(ofA)).toEqual(none);
    expect(await childRows(inProject)).toEqual(none);
    expect(await childRows(ofB)).toEqual(none);
    expect(await childRows(kept)).toEqual(one);
  });
});

describe('purgeScanChildren', () => {
  it('deletes more child rows than one chunk holds, and only those of the matching scans', async () => {
    const projectId = crypto.randomUUID();
    const gone = await seedScan({ projectId });
    const kept = await seedScan({ projectId: crypto.randomUUID() });
    // One chunk and a bit more, so the loop has to run a second statement.
    const extra = SCAN_CHILD_DELETE_CHUNK + 7;
    const rows = Array.from({ length: extra }, (_, i) =>
      env.DB.prepare("INSERT INTO scan_events (id, scan_id, type, payload) VALUES (?, ?, 'event', '{}')").bind(`e-${gone}-${i}`, gone));
    for (let i = 0; i < rows.length; i += 500) await env.DB.batch(rows.slice(i, i + 500));

    await purgeScanChildren(env.DB, 'project_id = ?', [projectId]);

    expect(await childRows(gone)).toEqual(none);
    expect(await childRows(kept)).toEqual(one);
    // The scan itself is left for the batch that deletes it.
    expect(await env.DB.prepare('SELECT id FROM scans WHERE id = ?').bind(gone).first()).not.toBeNull();
  });
});
