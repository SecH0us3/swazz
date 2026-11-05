// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// One-time authentication factors are accepted once: TOTP time steps and passkey challenges.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { ulid } from 'ulidx';
import { Env } from '../../src/env';
import { AuthRepository } from '../../src/repositories/auth';
import { applyMigrations } from '../utils/migrations';

const env = rawEnv as unknown as Env;

async function seedUser(): Promise<string> {
  const id = ulid();
  await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').bind(id, `t_${id.slice(-10).toLowerCase()}`, 'x').run();
  return id;
}

describe('TOTP time steps are single-use', () => {
  let repo: AuthRepository;

  beforeAll(async () => {
    await applyMigrations(env);
    repo = new AuthRepository(env);
  });

  it('accepts a step once and refuses it, or any older step, afterwards', async () => {
    const user = await seedUser();
    expect(await repo.consumeTotpCounter(user, 1000)).toBe(true);
    expect(await repo.consumeTotpCounter(user, 1000)).toBe(false);
    expect(await repo.consumeTotpCounter(user, 999)).toBe(false);
    expect(await repo.consumeTotpCounter(user, 1001)).toBe(true);
  });

  it('keeps the marker per user', async () => {
    const a = await seedUser();
    const b = await seedUser();
    expect(await repo.consumeTotpCounter(a, 2000)).toBe(true);
    expect(await repo.consumeTotpCounter(b, 2000)).toBe(true);
  });

  it('disabling 2FA resets the marker', async () => {
    const user = await seedUser();
    await repo.updateUserTwoFactorSecret(user, 'enc', 1);
    expect(await repo.consumeTotpCounter(user, 3000)).toBe(true);
    await repo.updateUserTwoFactorSecret(user, 'enc', 1); // re-enable keeps it
    expect(await repo.consumeTotpCounter(user, 3000)).toBe(false);
    await repo.updateUserTwoFactorSecret(user, null, 0);
    expect(await repo.consumeTotpCounter(user, 3000)).toBe(true);
  });
});

describe('passkey login challenges are single-use', () => {
  it('a challenge can be spent once', async () => {
    const repo = new AuthRepository(env);
    const challenge = 'chal_' + ulid();
    expect(await repo.consumePasskeyChallenge(challenge)).toBe(true);
    expect(await repo.consumePasskeyChallenge(challenge)).toBe(false);
    expect(await repo.consumePasskeyChallenge('chal_' + ulid())).toBe(true);
  });
});
