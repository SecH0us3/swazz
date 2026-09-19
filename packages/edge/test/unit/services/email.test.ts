// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendTransactionalEmail,
  sendVerificationEmail,
  sendProjectInvitationEmail,
  sendScanCompletedDigestEmail,
  sendSecurityAlertEmail,
  getDevSentEmails,
  clearDevSentEmails,
  renderVerificationEmail,
  renderProjectInvitationEmail,
  renderScanCompletedDigestEmail,
  renderSecurityAlertEmail,
} from '../../../src/services/email';
import type { Env } from '../../../src/env';

describe('Email Service', () => {
  let mockEnv: Env;
  let mockSendEmail: { send: ReturnType<typeof vi.fn> };
  let mockSessionCache: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clearDevSentEmails();
    mockSendEmail = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    mockSessionCache = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    };

    mockEnv = {
      DB: {} as any,
      STORAGE: {} as any,
      SESSION_CACHE: mockSessionCache as any,
      COORDINATOR_DO: {} as any,
      JWT_SECRET: 'test-secret',
      SCAN_QUEUE: {} as any,
      FINDINGS_QUEUE: {} as any,
      SEND_EMAIL: mockSendEmail as any,
    };
  });

  describe('sendTransactionalEmail', () => {
    it('dispatches email via env.SEND_EMAIL in production', async () => {
      mockEnv.NODE_ENV = 'production';

      const result = await sendTransactionalEmail(mockEnv, {
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello World</p>',
        text: 'Hello World',
      });

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(false);
      expect(mockSendEmail.send).toHaveBeenCalledTimes(1);

      const callArg = mockSendEmail.send.mock.calls[0][0];
      expect(callArg.to).toBe('user@example.com');
      expect(callArg.subject).toBe('Test Subject');
      expect(callArg.html).toBe('<p>Hello World</p>');
      expect(callArg.text).toBe('Hello World');
      expect(callArg.from).toContain('secmy.app');
      expect(callArg.headers['Auto-Submitted']).toBe('auto-generated');
      expect(callArg.headers['List-Unsubscribe']).toBeDefined();
    });

    it('simulates dispatch and stores in devSentEmails when SEND_EMAIL is missing', async () => {
      delete mockEnv.SEND_EMAIL;

      const result = await sendTransactionalEmail(mockEnv, {
        to: 'dev@example.com',
        subject: 'Dev Subject',
        html: '<p>Dev Mode</p>',
      });

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(mockSendEmail.send).not.toHaveBeenCalled();

      const devEmails = getDevSentEmails();
      expect(devEmails).toHaveLength(1);
      expect(devEmails[0].to).toBe('dev@example.com');
      expect(devEmails[0].subject).toBe('Dev Subject');
    });

    it('enforces rate-limiting cooldown via SESSION_CACHE', async () => {
      mockSessionCache.get.mockResolvedValueOnce('1'); // Cooldown active

      const result = await sendTransactionalEmail(mockEnv, {
        to: 'victim@example.com',
        subject: 'Spam Subject',
        html: '<p>Spam</p>',
        category: 'invitation',
        cooldownSeconds: 600,
      });

      expect(result.success).toBe(false);
      expect(result.rateLimited).toBe(true);
      expect(result.error).toContain('Rate limit');
      expect(mockSendEmail.send).not.toHaveBeenCalled();
    });

    it('sets cooldown in SESSION_CACHE when email is sent', async () => {
      mockEnv.NODE_ENV = 'production';

      const result = await sendTransactionalEmail(mockEnv, {
        to: 'user@example.com',
        subject: 'Verification',
        html: '<p>Verify</p>',
        category: 'verification',
        cooldownSeconds: 300,
      });

      expect(result.success).toBe(true);
      expect(mockSessionCache.put).toHaveBeenCalledWith(
        expect.stringContaining('ratelimit:email:verification:user@example.com'),
        '1',
        { expirationTtl: 300 }
      );
    });
  });

  describe('Template Rendering & Helper Functions', () => {
    it('renders and sends verification email with magic link', async () => {
      mockEnv.NODE_ENV = 'production';

      const result = await sendVerificationEmail(mockEnv, {
        email: 'newuser@example.com',
        token: 'verify-token-12345',
        username: 'alice',
      });

      expect(result.success).toBe(true);
      expect(mockSendEmail.send).toHaveBeenCalledTimes(1);

      const call = mockSendEmail.send.mock.calls[0][0];
      expect(call.to).toBe('newuser@example.com');
      expect(call.subject).toContain('Verify your email');
      expect(call.html).toContain('verify-token-12345');
      expect(call.html).toContain('alice');
      expect(call.text).toContain('verify-token-12345');
    });

    it('renders and sends project invitation email', async () => {
      mockEnv.NODE_ENV = 'production';

      const result = await sendProjectInvitationEmail(mockEnv, {
        to: 'colleague@example.com',
        projectName: 'Acme API Gateway',
        inviterName: 'Bob',
        inviteUrl: 'https://swazz.secmy.app/accept-invite?token=invite-999',
        roles: ['editor', 'runner'],
        expiresAt: '2026-09-26T00:00:00Z',
      });

      expect(result.success).toBe(true);
      const call = mockSendEmail.send.mock.calls[0][0];
      expect(call.to).toBe('colleague@example.com');
      expect(call.subject).toContain('Acme API Gateway');
      expect(call.html).toContain('Bob');
      expect(call.html).toContain('invite-999');
      expect(call.html).toContain('editor');
    });

    it('renders and sends scan completed digest email', async () => {
      mockEnv.NODE_ENV = 'production';

      const result = await sendScanCompletedDigestEmail(mockEnv, {
        to: 'owner@example.com',
        projectName: 'Production Backend',
        targetUrl: 'https://api.example.com',
        scanId: 'scan-123',
        reportUrl: 'https://swazz.secmy.app/projects/p1/scans/scan-123',
        totalFindings: 7,
        criticalCount: 2,
        highCount: 3,
        mediumCount: 1,
        lowCount: 1,
        completedAt: '2026-09-19T23:45:00Z',
      });

      expect(result.success).toBe(true);
      const call = mockSendEmail.send.mock.calls[0][0];
      expect(call.to).toBe('owner@example.com');
      expect(call.subject).toContain('Production Backend');
      expect(call.html).toContain('7');
      expect(call.html).toContain('Critical');
      expect(call.html).toContain('scan-123');
      expect(call.html).toContain('https://api.example.com');
    });

    it('renders security alert email', async () => {
      mockEnv.NODE_ENV = 'production';

      const result = await sendSecurityAlertEmail(mockEnv, {
        to: 'admin@example.com',
        title: 'New Runner Connected',
        description: 'A new public runner was successfully connected to your project.',
        details: {
          Runner: 'runner-spot-1',
          Project: 'Acme Project',
        },
      });

      expect(result.success).toBe(true);
      const call = mockSendEmail.send.mock.calls[0][0];
      expect(call.to).toBe('admin@example.com');
      expect(call.subject).toContain('Security Alert');
      expect(call.html).toContain('New Runner Connected');
      expect(call.html).toContain('runner-spot-1');
    });
  });
});
