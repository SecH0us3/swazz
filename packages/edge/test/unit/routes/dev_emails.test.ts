// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../../src/index';
import { clearDevSentEmails, sendVerificationEmail, sendProjectInvitationEmail } from '../../../src/services/email';
import type { Env } from '../../../src/env';

describe('Dev Email Inspector Routes', () => {
  let mockEnv: Env;

  beforeEach(() => {
    clearDevSentEmails();
    mockEnv = {
      DB: {} as any,
      STORAGE: {} as any,
      COORDINATOR_DO: {} as any,
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test',
      SCAN_QUEUE: {} as any,
      FINDINGS_QUEUE: {} as any,
    };
  });

  it('retrieves sent emails in test environment', async () => {
    await sendVerificationEmail(mockEnv, {
      email: 'bob@example.com',
      token: 'tok-123',
      username: 'bob',
    });

    await sendProjectInvitationEmail(mockEnv, {
      to: 'carol@example.com',
      projectName: 'Secret App',
      inviteUrl: 'https://swazz.secmy.app/accept-invite?token=inv-456',
      roles: ['viewer'],
      expiresAt: '2026-10-01T00:00:00Z',
    });

    const res = await app.fetch(new Request('http://localhost/api/dev/emails'), mockEnv, {} as any);
    expect(res.status).toBe(200);

    const data = await res.json() as { emails: any[] };
    expect(data.emails).toHaveLength(2);
    expect(data.emails[0].to).toBe('bob@example.com');
    expect(data.emails[1].to).toBe('carol@example.com');
  });

  it('filters emails by recipient query parameter', async () => {
    await sendVerificationEmail(mockEnv, {
      email: 'user1@example.com',
      token: 'tok-1',
    });

    await sendVerificationEmail(mockEnv, {
      email: 'user2@example.com',
      token: 'tok-2',
    });

    const res = await app.fetch(new Request('http://localhost/api/dev/emails?recipient=user1'), mockEnv, {} as any);
    expect(res.status).toBe(200);

    const data = await res.json() as { emails: any[] };
    expect(data.emails).toHaveLength(1);
    expect(data.emails[0].to).toBe('user1@example.com');
  });

  it('clears sent emails via POST /api/dev/emails/clear', async () => {
    await sendVerificationEmail(mockEnv, {
      email: 'temp@example.com',
      token: 'tok-temp',
    });

    const clearRes = await app.fetch(
      new Request('http://localhost/api/dev/emails/clear', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'token-123',
          Cookie: 'csrf_token=token-123',
        },
      }),
      mockEnv,
      {} as any
    );
    expect(clearRes.status).toBe(200);

    const listRes = await app.fetch(new Request('http://localhost/api/dev/emails'), mockEnv, {} as any);
    const data = await listRes.json() as { emails: any[] };
    expect(data.emails).toHaveLength(0);
  });

  it('returns 403 in production when not in test mode', async () => {
    const prodEnv: Env = {
      ...mockEnv,
      NODE_ENV: 'production',
      JWT_SECRET: 'prod-ultra-secret-key-12345678901234567890',
    };

    const res = await app.fetch(new Request('http://localhost/api/dev/emails'), prodEnv, {} as any);
    expect(res.status).toBe(403);
  });
});
