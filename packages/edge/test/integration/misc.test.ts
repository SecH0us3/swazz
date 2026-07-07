// @ts-nocheck
import { describe, it, expect, beforeAll } from 'vitest';
import { env as rawEnv } from 'cloudflare:test';
import { Env } from '../../src/env';
import { MiscRepository } from '../../src/repositories/misc';
import { splitSql } from '../../src/splitSql';
import { ulid } from 'ulidx';

const env = rawEnv as unknown as Env;

beforeAll(async () => {
  const migrationFiles = (import.meta as any).glob('../../migrations/*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  const sortedPaths = Object.keys(migrationFiles).sort();

  for (const path of sortedPaths) {
    const sql = migrationFiles[path];
    const statements = splitSql(sql);

    for (const statement of statements) {
      try {
        await env.DB.prepare(statement).run();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes('duplicate column name') || msg.includes('SQL code did not contain a statement')) continue;
        throw err;
      }
    }
  }
});

describe('MiscRepository Integration', () => {
  let repo: MiscRepository;

  beforeAll(() => {
    repo = new MiscRepository(env);
  });

  it('can query and increment anonymous usage count', async () => {
    const ip = '192.168.1.1';
    
    // Check initial usage (should be 0)
    let count = await repo.getAnonymousUsage(ip);
    expect(count).toBe(0);

    // Increment
    await repo.incrementAnonymousUsage(ip);
    count = await repo.getAnonymousUsage(ip);
    expect(count).toBe(1);

    // Increment again
    await repo.incrementAnonymousUsage(ip);
    count = await repo.getAnonymousUsage(ip);
    expect(count).toBe(2);
  });

  it('can query user public key correctly', async () => {
    const userId = ulid();
    
    // Fetch non-existent key
    let key = await repo.getUserPublicKey(userId);
    expect(key).toBeNull();

    // Insert user with public key
    await env.DB.prepare(
      "INSERT INTO users (id, username, password_hash, public_key) VALUES (?, 'test_misc', 'dummy_hash', 'test_key')"
    ).bind(userId).run();

    key = await repo.getUserPublicKey(userId);
    expect(key).toBe('test_key');
  });
});
