// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/**
 * The tables whose rows belong to a scan, by scan_id. D1 enforces no foreign keys here, so
 * nothing removes them with the scan: every path that deletes scans goes through
 * deleteScansWhere, and a new table keyed by scan_id is added to this list.
 * (ws_tickets also names a run, but expires within a minute and is swept by the cron.)
 */
export const SCAN_CHILD_TABLES = ['findings', 'scan_events', 'oob_pending'] as const;

/** Child rows deleted per statement by purgeScanChildren. */
export const SCAN_CHILD_DELETE_CHUNK = 5000;

/**
 * Statements per table purgeScanChildren runs at most, so a runner that still writes events as
 * fast as they are deleted cannot keep it looping; the batch that deletes the scans takes the rest.
 */
export const SCAN_CHILD_MAX_CHUNKS = 100;

/**
 * The statements that delete the scans matching `where` (an SQL condition on the scans table,
 * with `binds` for its placeholders; a fixed string, never built from input) together with their
 * child rows: children first, while the scans they belong to can still be found. Run them in one
 * batch, so that it all happens or none; call purgeScanChildren first, so that batch stays small.
 */
export function deleteScansWhere(db: D1Database, where: string, binds: unknown[]): D1PreparedStatement[] {
  return [
    ...SCAN_CHILD_TABLES.map(table =>
      db.prepare(`DELETE FROM ${table} WHERE scan_id IN (SELECT id FROM scans WHERE (${where}))`).bind(...binds)),
    db.prepare(`DELETE FROM scans WHERE (${where})`).bind(...binds),
  ];
}

/**
 * Deletes the child rows of the scans matching `where` (as for deleteScansWhere) in chunks of
 * SCAN_CHILD_DELETE_CHUNK, so that a scan with hundreds of thousands of events cannot push the
 * batch that deletes the scans past D1's limits. Rows written meanwhile are caught by that batch.
 *
 * The chunks are committed one by one, before that batch: if the batch then fails, the scans are
 * still there without their findings and events. The deletion was asked for, and running it
 * again finishes it; what it must never do, leave rows of deleted scans behind, it does not.
 */
export async function purgeScanChildren(db: D1Database, where: string, binds: unknown[]): Promise<void> {
  for (const table of SCAN_CHILD_TABLES) {
    for (let chunk = 0; chunk < SCAN_CHILD_MAX_CHUNKS; chunk++) {
      const res = await db.prepare(
        `DELETE FROM ${table} WHERE rowid IN (
           SELECT rowid FROM ${table} WHERE scan_id IN (SELECT id FROM scans WHERE (${where})) LIMIT ${SCAN_CHILD_DELETE_CHUNK})`
      ).bind(...binds).run();
      if ((res.meta?.changes ?? 0) < SCAN_CHILD_DELETE_CHUNK) break;
    }
  }
}
