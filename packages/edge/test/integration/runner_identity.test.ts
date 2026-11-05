// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A runner that connects with a public key is attributed to the account holding that key, so
// one key must never be held by two accounts.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { ulid } from 'ulidx';
import { Env } from '../../src/env';
import { AuthRepository } from '../../src/repositories/auth';
import { AuthService } from '../../src/services/auth';
import { splitSql } from '../../src/splitSql';
import { applyMigrations } from '../utils/migrations';
import uniqueKeyMigration from '../../migrations/0037_unique_runner_public_key.sql?raw';

const env = rawEnv as unknown as Env;

async function seedUser(publicKey: string | null = null): Promise<string> {
  const id = ulid();
  await env.DB.prepare('INSERT INTO users (id, username, password_hash, public_key) VALUES (?, ?, ?, ?)')
    .bind(id, `u_${id.slice(-10).toLowerCase()}`, 'x', publicKey).run();
  return id;
}

async function keyOf(userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT public_key FROM users WHERE id = ?').bind(userId).first<{ public_key: string | null }>();
  return row?.public_key ?? null;
}

const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');

describe('runner public keys belong to one account', () => {
  let service: AuthService;

  beforeAll(async () => {
    await applyMigrations(env);
    service = new AuthService(env, new AuthRepository(env));
  });

  it('refuses to register a key another account already holds', async () => {
    const key = randomKey();
    const victim = await seedUser();
    const attacker = await seedUser();
    await service.updatePublicKey(victim, key);

    await expect(service.updatePublicKey(attacker, key)).rejects.toThrow('|409');
    await expect(service.updatePublicKey(attacker, key.toUpperCase())).rejects.toThrow('|409');
    expect(await keyOf(attacker)).toBeNull();
    expect(await keyOf(victim)).toBe(key);
  });

  it('lets an account re-save or clear its own key', async () => {
    const key = randomKey();
    const user = await seedUser();
    await service.updatePublicKey(user, key);
    await service.updatePublicKey(user, key);
    expect(await keyOf(user)).toBe(key);
    await service.updatePublicKey(user, null);
    expect(await keyOf(user)).toBeNull();
  });

  it('the database itself rejects a duplicate key', async () => {
    const key = randomKey();
    await seedUser(key);
    await expect(seedUser(key)).rejects.toThrow(/UNIQUE/);
  });

  it('the migration clears keys that more than one account held, and keeps unique ones', async () => {
    await env.DB.prepare('DROP INDEX IF EXISTS idx_users_public_key_unique').run();
    const shared = randomKey();
    const a = await seedUser(shared);
    const b = await seedUser(shared.toUpperCase());
    const unique = randomKey().toUpperCase();
    const c = await seedUser(unique);

    for (const statement of splitSql(uniqueKeyMigration)) {
      await env.DB.prepare(statement).run();
    }

    expect(await keyOf(a)).toBeNull();
    expect(await keyOf(b)).toBeNull();
    expect(await keyOf(c)).toBe(unique.toLowerCase());
    await expect(seedUser(unique.toLowerCase())).rejects.toThrow(/UNIQUE/);
  });
});

describe('unscoped spec cache rows are dropped', () => {
  it('removes bare-URL rows and keeps per-user ones', async () => {
    const { default: dropMigration } = await import('../../migrations/0040_drop_unscoped_swagger_cache.sql?raw');
    const insert = (url: string) => env.DB.prepare('INSERT OR REPLACE INTO swagger_cache (url, base_path, endpoints_hash, endpoints_r2_key, raw_spec_r2_key) VALUES (?, ?, ?, ?, ?)')
      .bind(url, '/', 'h', 'specs/parsed/x.json', 'specs/raw/x.json').run();
    await insert('https://legacy.example/openapi.json');
    await insert('user:u1|https://legacy.example/openapi.json');

    for (const statement of splitSql(dropMigration)) await env.DB.prepare(statement).run();

    const { results } = await env.DB.prepare("SELECT url FROM swagger_cache WHERE url LIKE '%legacy.example%' ORDER BY url").all<{ url: string }>();
    expect(results.map(r => r.url)).toEqual(['user:u1|https://legacy.example/openapi.json']);
  });
});
