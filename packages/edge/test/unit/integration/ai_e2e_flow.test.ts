// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../../src/index';
import { clearDevSentEmails, getDevSentEmails } from '../../../src/services/email';
import type { Env } from '../../../src/env';
import { sign } from 'hono/jwt';

describe('Workers AI End-to-End Workflow', () => {
  let mockEnv: Env;
  let d1Users: Map<string, any>;
  let d1Projects: Map<string, any>;
  let d1Scans: Map<string, any>;
  let d1Findings: Map<string, any>;
  let kvStore: Map<string, string>;

  beforeEach(() => {
    clearDevSentEmails();
    d1Users = new Map();
    d1Projects = new Map();
    d1Scans = new Map();
    d1Findings = new Map();
    kvStore = new Map();

    const mockD1 = {
      prepare: (sql: string) => {
        return {
          bind: (...args: any[]) => ({
            first: async <T = any>() => {
              if (sql.includes('FROM users WHERE id = ?')) {
                return (d1Users.get(args[0]) || null) as T;
              }
              if (sql.includes('SELECT f.*, s.project_id, s.user_id FROM findings f JOIN scans s')) {
                const findingId = args[0];
                const f = d1Findings.get(findingId);
                if (!f) return null;
                const s = d1Scans.get(f.scan_id);
                return {
                  ...f,
                  project_id: s?.project_id,
                  user_id: s?.user_id,
                } as T;
              }
              if (sql.includes('FROM scans WHERE id = ?')) {
                return (d1Scans.get(args[0]) || null) as T;
              }
              if (sql.includes('SELECT users.email, users.email_verified')) {
                const userId = args[1] || args[0];
                const u = d1Users.get(userId);
                if (!u) return null;
                return {
                  email: u.email,
                  email_verified: u.email_verified,
                  project_name: 'AI Test Project',
                } as T;
              }
              return null;
            },
            run: async () => {
              if (sql.includes('UPDATE findings SET')) {
                const findingId = args[args.length - 1];
                const existing = d1Findings.get(findingId);
                if (existing) {
                  d1Findings.set(findingId, {
                    ...existing,
                    ai_status: 'completed',
                    ai_explanation: args[1],
                    ai_remediation: args[2],
                    ai_relevance: args[3],
                    ai_confidence: args[4],
                    ai_proposed_patch: args[5],
                  });
                }
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
            all: async () => ({ results: [] }),
          }),
        };
      },
      batch: async () => [],
    };

    const mockKv = {
      get: async (key: string, type?: string) => {
        const val = kvStore.get(key) || null;
        if (type === 'json' && val) return JSON.parse(val);
        return val;
      },
      put: async (key: string, val: string) => {
        kvStore.set(key, val);
      },
      delete: async (key: string) => {
        kvStore.delete(key);
      },
    };

    mockEnv = {
      DB: mockD1 as any,
      STORAGE: {} as any,
      SESSION_CACHE: mockKv as any,
      COORDINATOR_DO: {} as any,
      SCAN_QUEUE: {} as any,
      FINDINGS_QUEUE: {} as any,
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test',
      AUTH_ENABLED: 'true',
      AI: {
        run: async () => ({
          response: JSON.stringify({
            summary: 'Critical vulnerability detected in cloud payment API. Immediate patching required.',
            risk_level: 'critical',
            key_recommendations: ['Remediate critical vulnerabilities immediately', 'Enable WAF virtual patch'],
          }),
        }),
      },
    };
  });

  it('executes full finding triage cycle and embeds AI briefing in scan completion email', async () => {
    // 1. Seed user, project, scan, and a vulnerability finding
    const userId = 'u_ai_user';
    const projectId = 'p_ai_project';
    const scanId = 'scan_ai_1';
    const findingId = 'finding_sqli_1';

    d1Users.set(userId, {
      id: userId,
      username: 'sec_engineer',
      email: 'engineer@secmy.app',
      email_verified: 1,
      delete_requested_at: null,
    });

    d1Projects.set(projectId, {
      id: projectId,
      name: 'Cloud Payment API',
    });

    d1Scans.set(scanId, {
      id: scanId,
      project_id: projectId,
      user_id: userId,
      target_url: 'https://payment.secmy.app/api/v1/charge',
      status: 'running',
    });

    d1Findings.set(findingId, {
      id: findingId,
      scan_id: scanId,
      rule_id: 'swazz/sqli-error',
      level: 'critical',
      message: 'Unsanitized SQL input detected in charge_id parameter',
      evidence: "SELECT * FROM charges WHERE id = '100' OR '1'='1'",
      ai_status: 'none',
    });

    // Generate JWT for auth
    const token = await sign(
      { sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
      'test-secret'
    );

    // Seed RBAC permissions in cache
    kvStore.set(`rbac:${projectId}:${userId}`, JSON.stringify({
      permissions: ['get:/api/projects/:id/scans', 'post:/api/projects/:id/scans']
    }));

    // 2. Trigger AI Analysis via POST /api/scans/:id/findings/:findingId/ai-analyze
    const analyzeReq = new Request(
      `http://localhost/api/scans/${scanId}/findings/${findingId}/ai-analyze`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code_context: 'SELECT * FROM charges WHERE id = $charge_id',
        }),
      }
    );

    const analyzeRes = await app.fetch(analyzeReq, mockEnv, {} as any);
    expect(analyzeRes.status).toBe(200);

    const analyzeBody = (await analyzeRes.json()) as any;
    expect(analyzeBody.success).toBe(true);
    expect(analyzeBody.analysis).toBeDefined();
    expect(analyzeBody.analysis.explanation).toContain('SQL Injection');
    expect(analyzeBody.analysis.remediation).toContain('parameterized queries');
    expect(analyzeBody.analysis.proposed_patch).toBeDefined();
    expect(analyzeBody.analysis.relevance).toBe(true);
    expect(analyzeBody.analysis.confidence).toBeGreaterThanOrEqual(80);

    // 3. Verify KV rate limit key was recorded
    expect(kvStore.get(`ratelimit:ai_analyze:${userId}`)).toBe('1');

    // 4. Verify Finding in D1 was updated to completed state
    const updatedFinding = d1Findings.get(findingId);
    expect(updatedFinding.ai_status).toBe('completed');

    // 5. Complete Scan and verify AI executive briefing appears in digest email
    const { ScansRepository } = await import('../../../src/repositories/scans');
    const scansRepo = new ScansRepository(mockEnv);

    // Set scan status to completed
    d1Scans.set(scanId, {
      ...d1Scans.get(scanId),
      status: 'completed',
      completed_at: new Date().toISOString(),
      summary_stats: JSON.stringify({
        total_findings: 1,
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
      }),
    });

    await scansRepo.updateScanStatus(scanId, 'completed', null);

    // 6. Inspect sent transactional emails
    const sentEmails = getDevSentEmails();
    expect(sentEmails.length).toBeGreaterThan(0);

    const digestEmail = sentEmails[sentEmails.length - 1];
    expect(digestEmail.to).toBe('engineer@secmy.app');
    expect(digestEmail.subject).toContain('[Scan Completed]');
    expect(digestEmail.html).toContain('AI Executive Risk Briefing');
    expect(digestEmail.html).toContain('Remediate critical vulnerabilities immediately');
  });

  it('enforces KV rate limiting to protect daily Neurons quota', async () => {
    const userId = 'u_rate_limit_user';
    const projectId = 'p_proj_rl';
    const scanId = 'scan_rl_1';
    const findingId = 'finding_rl_1';

    d1Users.set(userId, {
      id: userId,
      username: 'rate_limited_dev',
      email: 'dev@secmy.app',
      email_verified: 1,
      delete_requested_at: null,
    });

    d1Projects.set(projectId, { id: projectId, name: 'Rate Limit Project' });
    d1Scans.set(scanId, { id: scanId, project_id: projectId, user_id: userId, status: 'running' });
    d1Findings.set(findingId, { id: findingId, scan_id: scanId, rule_id: 'xss', level: 'high' });

    // Pre-seed KV with 50 previous requests
    kvStore.set(`ratelimit:ai_analyze:${userId}`, '50');
    kvStore.set(`rbac:${projectId}:${userId}`, JSON.stringify({
      permissions: ['get:/api/projects/:id/scans', 'post:/api/projects/:id/scans']
    }));

    const token = await sign(
      { sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
      'test-secret'
    );

    const req = new Request(
      `http://localhost/api/scans/${scanId}/findings/${findingId}/ai-analyze`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      }
    );

    const res = await app.fetch(req, mockEnv, {} as any);
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error).toContain('AI analysis rate limit exceeded');
  });
});
