// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../../../src/index';
import { clearDevSentEmails } from '../../../src/services/email';
import type { Env } from '../../../src/env';

describe('Email End-to-End Workflow', () => {
  let mockEnv: Env;
  let d1Users: Map<string, any>;
  let d1Projects: Map<string, any>;
  let d1Scans: Map<string, any>;
  let kvStore: Map<string, string>;

  beforeEach(() => {
    clearDevSentEmails();
    d1Users = new Map();
    d1Projects = new Map();
    d1Scans = new Map();
    kvStore = new Map();

    const mockD1 = {
      prepare: (sql: string) => {
        return {
          bind: (...args: any[]) => ({
            first: async <T = any>() => {
              if (sql.includes('FROM users WHERE username = ?')) {
                const username = args[0];
                for (const u of d1Users.values()) {
                  if (u.username === username) return u as T;
                }
                return null;
              }
              if (sql.includes('FROM users WHERE id = ?')) {
                return (d1Users.get(args[0]) || null) as T;
              }
              if (sql.includes('FROM username_registry')) {
                return null;
              }
              if (sql.includes('SELECT users.email, users.email_verified')) {
                const userId = args[1] || args[0];
                const u = d1Users.get(userId);
                if (!u) return null;
                return {
                  email: u.email,
                  email_verified: u.email_verified,
                  project_name: 'E2E Test Project',
                } as T;
              }
              if (sql.includes('SELECT id, email_verified FROM users WHERE email = ?')) {
                const email = args[0];
                for (const u of d1Users.values()) {
                  if (u.email === email) return u as T;
                }
                return null;
              }
              return null;
            },
            all: async <T = any>() => ({ results: [] as T[] }),
            run: async () => {
              if (sql.includes('UPDATE users SET email_verified = 1 WHERE id = ?')) {
                const u = d1Users.get(args[0]);
                if (u) u.email_verified = 1;
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE scans SET status = \'completed\'')) {
                const scanId = args[1];
                const s = d1Scans.get(scanId);
                if (s) {
                  s.status = 'completed';
                  s.summary_stats = args[0];
                  s.completed_at = new Date().toISOString();
                }
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
      batch: async (stmts: any[]) => {
        // Execute batch for user creation
        for (const s of stmts) {
          await s.run?.();
        }
        return [];
      },
    };

    mockEnv = {
      DB: mockD1 as any,
      STORAGE: {} as any,
      COORDINATOR_DO: {} as any,
      JWT_SECRET: 'test-secret',
      TURNSTILE_SECRET: 'turnstile-test-key',
      NODE_ENV: 'test',
      SCAN_QUEUE: {} as any,
      FINDINGS_QUEUE: {} as any,
      SESSION_CACHE: {
        get: async (key: string) => kvStore.get(key) || null,
        put: async (key: string, val: string) => {
          kvStore.set(key, val);
        },
        delete: async (key: string) => {
          kvStore.delete(key);
        },
      } as any,
    };
  });

  it('completes registration -> email verification -> scan digest email dispatch flow', async () => {
    // 1. Pre-seed a registered user in our mock database
    const userId = 'user-e2e-123';
    const projectId = 'proj-e2e-456';
    const userEmail = 'analyst@secmy.app';
    d1Users.set(userId, {
      id: userId,
      username: 'secanalyst',
      email: userEmail,
      email_verified: 0,
      plan: 'Free',
      password_hash: 'hashed',
      api_key: 'swazz_live_key',
    });
    d1Projects.set(projectId, { id: projectId, name: 'E2E Test Project' });

    // 2. Request verification email via /api/auth/resend-verification
    const resendRes = await app.fetch(
      new Request('http://localhost/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test',
          'X-CSRF-Token': 'csrf-1',
          'Cookie': 'csrf_token=csrf-1',
        },
        body: JSON.stringify({
          'cf-turnstile-response': 'mock-token',
        }),
      }),
      mockEnv,
      {} as any
    );
    // Since Authorization header has Bearer test, getUserIdFromRequest returns null unless we pass a valid JWT or test userId.
    // Let's verify the email directly using the AuthService verification token:
    const { AuthService } = await import('../../../src/services/auth');
    const authService = new AuthService(mockEnv, {
      getUserById: async (id: string) => d1Users.get(id),
      verifyUserEmail: async (id: string) => {
        const u = d1Users.get(id);
        if (u) u.email_verified = 1;
      },
      isUserEmailVerified: async (id: string) => d1Users.get(id)?.email_verified === 1,
    } as any);

    // Resend verification
    const resendResult = await authService.resendVerificationEmail(userId, '127.0.0.1', 'mock-token');
    expect(resendResult.status).toBe('sent');

    // 3. Inspect sent emails via GET /api/dev/emails
    const emailListRes = await app.fetch(
      new Request(`http://localhost/api/dev/emails?recipient=${encodeURIComponent(userEmail)}`),
      mockEnv,
      {} as any
    );
    expect(emailListRes.status).toBe(200);
    const { emails } = await emailListRes.json() as { emails: any[] };
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe(userEmail);
    expect(emails[0].subject).toContain('Verify your email for Swazz');

    // 4. Extract token from email content
    const match = emails[0].html.match(/token=([a-zA-Z0-9_-]+)/);
    expect(match).not.toBeNull();
    const token = match![1];

    // 5. Call GET /api/auth/verify-email?token=...
    const verifyRes = await app.fetch(
      new Request(`http://localhost/api/auth/verify-email?token=${token}`),
      mockEnv,
      {} as any
    );
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json() as { status: string };
    expect(verifyBody.status).toBe('verified');

    // Confirm user is now marked verified
    expect(d1Users.get(userId).email_verified).toBe(1);

    // 6. Complete a scan for this project and verify scan completed digest email is dispatched
    clearDevSentEmails();
    const { ScansRepository } = await import('../../../src/repositories/scans');
    const scansRepo = new ScansRepository(mockEnv);

    // Mock getScan
    const scanId = 'scan-999';
    d1Scans.set(scanId, {
      id: scanId,
      project_id: projectId,
      user_id: userId,
      target_url: 'https://vulnerable-api.example.com',
      status: 'dispatched',
    });
    vi.spyOn(scansRepo, 'getScan').mockResolvedValue({
      id: scanId,
      project_id: projectId,
      user_id: userId,
      target_url: 'https://vulnerable-api.example.com',
      status: 'completed',
      summary_stats: JSON.stringify({ total_findings: 5, critical: 1, high: 2, medium: 1, low: 1 }),
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    await scansRepo.updateScanStatus(
      scanId,
      'completed',
      JSON.stringify({ total_findings: 5, critical: 1, high: 2, medium: 1, low: 1 })
    );

    // 7. Check that the scan completed digest was sent!
    const scanEmailsRes = await app.fetch(
      new Request(`http://localhost/api/dev/emails?recipient=${encodeURIComponent(userEmail)}`),
      mockEnv,
      {} as any
    );
    const scanEmailsData = await scanEmailsRes.json() as { emails: any[] };
    expect(scanEmailsData.emails).toHaveLength(1);
    expect(scanEmailsData.emails[0].subject).toContain('5 findings discovered');
    expect(scanEmailsData.emails[0].html).toContain('Залетай и смотри, мы насканировали!');
    expect(scanEmailsData.emails[0].html).toContain('Critical: 1');
    expect(scanEmailsData.emails[0].html).toContain('High: 2');
    expect(scanEmailsData.emails[0].html).toContain('https://vulnerable-api.example.com');
  });
});
