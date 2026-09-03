// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Env } from '../../src/env';
import { splitSql } from '../../src/splitSql';
import { generateTestKeyPair, signLicenseToken } from '../utils/license';

const env = rawEnv as unknown as Env;

describe('Trial License Integration', () => {
  let app: any;
  let testKeyPair: { pubKeyHex: string; privKeyHex: string };

  beforeAll(async () => {
    // Generate test keypair and set in env
    testKeyPair = await generateTestKeyPair();
    (env as any).SWAZZ_LICENSE_PUBKEY = testKeyPair.pubKeyHex;
    (env as any).SWAZZ_LICENSE_PRIVKEY = testKeyPair.privKeyHex;
    (env as any).JWT_SECRET = 'test-secret';
    (env as any).AUTH_ENABLED = 'true';

    // Apply migrations
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

    const indexModule = await import('../../src/index');
    app = (indexModule as any).default || indexModule;
  });

  async function getCsrf(): Promise<string> {
    const infoRes = await app.fetch(new Request('http://localhost/api/info'), env);
    return infoRes.headers.get('X-CSRF-Token') || 'test-csrf';
  }

  async function registerUser(username: string): Promise<{ token: string; userId: string; csrfToken: string }> {
    const csrf = await getCsrf();
    const res = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'Cookie': `csrf_token=${csrf}`,
        },
        body: JSON.stringify({ username, password: 'Password123!' }),
      }),
      env
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    return { token: data.token, userId: data.id, csrfToken: csrf };
  }

  it('allows a registered user to check trial status and claim a 14-day trial', async () => {
    const username = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    const { token, csrfToken } = await registerUser(username);

    // 1. Initial trial status should be unclaimed
    const statusRes1 = await app.fetch(
      new Request('http://localhost/api/user/trial-status', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }),
      env
    );
    expect(statusRes1.status).toBe(200);
    const statusData1 = await statusRes1.json();
    expect(statusData1.claimed).toBe(false);
    expect(statusData1.claimed_at).toBeNull();
    expect(statusData1.can_claim).toBe(true);

    // 2. Claim trial license
    const claimRes = await app.fetch(
      new Request('http://localhost/api/user/trial-license', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-CSRF-Token': csrfToken,
          'Cookie': `csrf_token=${csrfToken}`,
          'Content-Type': 'application/json',
        },
      }),
      env
    );
    expect(claimRes.status).toBe(200);
    const claimData = await claimRes.json();
    expect(claimData.status).toBe('ok');
    expect(claimData.license.company).toBe(`${username} (14-Day Trial)`);
    expect(claimData.license.features).toEqual(['*']);
    expect(claimData.license.max_users).toBe(1);
    expect(claimData.license.max_concurrency).toBe(1000);
    expect(typeof claimData.token).toBe('string');
    expect(claimData.token.split('.').length).toBe(3);

    // 3. Trial status should now be claimed and on cooldown
    const statusRes2 = await app.fetch(
      new Request('http://localhost/api/user/trial-status', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }),
      env
    );
    expect(statusRes2.status).toBe(200);
    const statusData2 = await statusRes2.json();
    expect(statusData2.claimed).toBe(true);
    expect(statusData2.claimed_at).toBeTruthy();
    expect(statusData2.can_claim).toBe(false);
    expect(statusData2.cooldown_remaining_ms).toBeGreaterThan(0);

    // 4. Regular license status should now report active
    const licRes = await app.fetch(
      new Request('http://localhost/api/user/license', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }),
      env
    );
    expect(licRes.status).toBe(200);
    const licData = await licRes.json();
    expect(licData.status).toBe('active');
    expect(licData.license.company).toBe(`${username} (14-Day Trial)`);

    // 5. Attempt duplicate claim within cooldown -> 429
    const dupRes = await app.fetch(
      new Request('http://localhost/api/user/trial-license', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-CSRF-Token': csrfToken,
          'Cookie': `csrf_token=${csrfToken}`,
          'Content-Type': 'application/json',
        },
      }),
      env
    );
    expect(dupRes.status).toBe(429);
    const dupData = await dupRes.json();
    expect(dupData.error).toContain('once every 24 hours');
  });

  it('rejects unauthenticated requests to trial endpoints', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/user/trial-status', {
        method: 'GET',
      }),
      env
    );
    expect(res.status).toBe(401);
  });

  it('verifies license tokens via public POST /api/license/verify without auth', async () => {
    const csrfToken = await getCsrf();

    // 1. Missing body or license_key -> 400
    const badRes = await app.fetch(
      new Request('http://localhost/api/license/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'Cookie': `csrf_token=${csrfToken}`,
        },
        body: JSON.stringify({}),
      }),
      env
    );
    expect(badRes.status).toBe(400);

    // 2. Invalid signature token -> 400 with valid: false
    const invalidRes = await app.fetch(
      new Request('http://localhost/api/license/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'Cookie': `csrf_token=${csrfToken}`,
        },
        body: JSON.stringify({ license_key: 'eyJhbGciOiJFZERTQTEyMyJ9.eyJjb21wYW55IjoiVGVzdCJ9.d3Jvbmdfc2lnbmF0dXJlX2J5dGVzX3Nob3VsZF9iZV82NF9ieXRlc19sb25nX2hlcmVfMTIzNDU2' }),
      }),
      env
    );
    expect(invalidRes.status).toBe(400);
    const invalidData = await invalidRes.json();
    expect(invalidData.valid).toBe(false);

    // 3. Valid signed token -> 200 with valid: true
    const validToken = await signLicenseToken(testKeyPair.privKeyHex, {
      company: 'Acme Corp',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      features: ['*'],
    });
    const validRes = await app.fetch(
      new Request('http://localhost/api/license/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'Cookie': `csrf_token=${csrfToken}`,
        },
        body: JSON.stringify({ license_key: validToken }),
      }),
      env
    );
    expect(validRes.status).toBe(200);
    const validData = await validRes.json();
    expect(validData.valid).toBe(true);
    expect(validData.license.company).toBe('Acme Corp');
  });
});
