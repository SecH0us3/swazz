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

/**
 * The statements that delete the scans matching `where` (an SQL condition on the scans table,
 * with `binds` for its placeholders) together with their child rows: children first, while the
 * scans they belong to can still be found. Run them in one batch, so that it all happens or none.
 */
export function deleteScansWhere(db: D1Database, where: string, binds: unknown[]): D1PreparedStatement[] {
  return [
    ...SCAN_CHILD_TABLES.map(table =>
      db.prepare(`DELETE FROM ${table} WHERE scan_id IN (SELECT id FROM scans WHERE ${where})`).bind(...binds)),
    db.prepare(`DELETE FROM scans WHERE ${where}`).bind(...binds),
  ];
}
