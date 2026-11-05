// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../../src/env';
import { splitSql } from '../../src/splitSql';

/** Applies every D1 migration, in order, to the test database. */
export async function applyMigrations(env: Env): Promise<void> {
  const migrationFiles = (import.meta as any).glob('../../migrations/*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  for (const path of Object.keys(migrationFiles).sort()) {
    for (const statement of splitSql(migrationFiles[path])) {
      try {
        await env.DB.prepare(statement).run();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes('duplicate column name') || msg.includes('SQL code did not contain a statement')) continue;
        throw err;
      }
    }
  }
}
