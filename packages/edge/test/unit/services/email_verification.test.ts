// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../../src/services/auth';
import type { IAuthRepository } from '../../../src/repositories/auth';
import type { Env } from '../../../src/env';
import { clearDevSentEmails, getDevSentEmails } from '../../../src/services/email';

describe('Email Verification Flow', () => {
  let authService: AuthService;
  let mockRepo: Record<keyof IAuthRepository, any>;
  let mockEnv: Env;
  let kvStore: Map<string, string>;

  beforeEach(() => {
    clearDevSentEmails();
    kvStore = new Map();

    mockRepo = {
      checkUsernameExists: vi.fn(),
      createUser: vi.fn(),
      createGuestUser: vi.fn(),
      createLoginChallenge: vi.fn(),
      getAndConsumeChallenge: vi.fn(),
      getUserById: vi.fn(),
      getUserByUsername: vi.fn(),
      updateUserApiKey: vi.fn(),
      updateUserPublicKey: vi.fn(),
      scheduleUserDeletion: vi.fn(),
      cancelUserDeletion: vi.fn(),
      updateUserTwoFactorSecret: vi.fn(),
      getPasskeysByUserId: vi.fn(),
      getPasskeyByCredentialId: vi.fn(),
      savePasskey: vi.fn(),
      updatePasskeyCounter: vi.fn(),
      deletePasskey: vi.fn(),
      updateUserPlan: vi.fn(),
      getLicenseKey: vi.fn(),
      setLicenseKey: vi.fn(),
      getTrialClaimedAt: vi.fn(),
      setTrialClaimedAt: vi.fn(),
      linkGithubUser: vi.fn(),
      getUserByGithubId: vi.fn(),
      linkGitlabUser: vi.fn(),
      getUserByGitlabId: vi.fn(),
      getUserByEmail: vi.fn(),
      verifyUserEmail: vi.fn(),
      isUserEmailVerified: vi.fn(),
      createGithubUser: vi.fn(),
      createGitlabUser: vi.fn(),
      checkIpRateLimit: vi.fn().mockResolvedValue({ limited: false }),
      checkLoginRateLimit: vi.fn().mockResolvedValue({ locked: false }),
      recordFailedLogin: vi.fn(),
      resetLoginAttempts: vi.fn(),
    } as any;

    mockEnv = {
      DB: {} as any,
      STORAGE: {} as any,
      COORDINATOR_DO: {} as any,
      JWT_SECRET: 'test-secret',
      TURNSTILE_SECRET: 'turnstile-test-secret',
      SCAN_QUEUE: {} as any,
      FINDINGS_QUEUE: {} as any,
      SESSION_CACHE: {
        get: vi.fn(async (key: string) => kvStore.get(key) || null),
        put: vi.fn(async (key: string, val: string) => {
          kvStore.set(key, val);
        }),
        delete: vi.fn(async (key: string) => {
          kvStore.delete(key);
        }),
      } as any,
    };

    authService = new AuthService(mockEnv, mockRepo);
  });

  describe('createEmailVerificationToken & verifyEmail', () => {
    it('creates token, stores in KV, and verifies successfully', async () => {
      const token = await authService.createEmailVerificationToken('u123', 'alice@example.com');
      expect(token).toBeDefined();

      const verifyResult = await authService.verifyEmail(token);
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.email).toBe('alice@example.com');
      expect(mockRepo.verifyUserEmail).toHaveBeenCalledWith('u123');

      // Token should now be consumed
      await expect(authService.verifyEmail(token)).rejects.toThrow('Invalid or expired verification token');
    });

    it('rejects invalid or expired token', async () => {
      await expect(authService.verifyEmail('nonexistent-token')).rejects.toThrow('Invalid or expired verification token|400');
    });

    it('rejects empty token', async () => {
      await expect(authService.verifyEmail('')).rejects.toThrow('Invalid verification token|400');
    });
  });

  describe('resendVerificationEmail', () => {
    it('resends verification email with valid user', async () => {
      mockRepo.getUserById.mockResolvedValue({
        id: 'u123',
        username: 'alice',
        email: 'alice@example.com',
        email_verified: 0,
      });

      const res = await authService.resendVerificationEmail('u123');
      expect(res.status).toBe('sent');
      expect(res.cooldownSeconds).toBe(300);

      const devEmails = getDevSentEmails();
      expect(devEmails).toHaveLength(1);
      expect(devEmails[0].to).toBe('alice@example.com');
      expect(devEmails[0].subject).toContain('Verify your email');
    });

    it('blocks resend if cooldown is active in KV', async () => {
      mockRepo.getUserById.mockResolvedValue({
        id: 'u123',
        username: 'alice',
        email: 'alice@example.com',
        email_verified: 0,
      });

      // Put active cooldown
      kvStore.set('email_verify_cooldown:u123', '1');

      await expect(authService.resendVerificationEmail('u123')).rejects.toThrow('Verification email was sent recently');
    });

    it('rejects if email is already verified', async () => {
      mockRepo.getUserById.mockResolvedValue({
        id: 'u123',
        username: 'alice',
        email: 'alice@example.com',
        email_verified: 1,
      });

      await expect(authService.resendVerificationEmail('u123')).rejects.toThrow('Email is already verified|400');
    });

    it('rejects if user has no email', async () => {
      mockRepo.getUserById.mockResolvedValue({
        id: 'u123',
        username: 'alice',
        email: null,
        email_verified: 0,
      });

      await expect(authService.resendVerificationEmail('u123')).rejects.toThrow('No email registered for this account|400');
    });
  });
});
