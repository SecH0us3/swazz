import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthService } from '../../../src/services/auth';
import { IAuthRepository } from '../../../src/repositories/auth';
import { Env } from '../../../src/env';
import { Context } from 'hono';
import * as simplewebauthn from '@simplewebauthn/server';
import { verifyTurnstile, hashPassword, verifyPassword, hashApiKey, hashUsername, verifyDummyPassword } from '../../../src/utils/auth';
import { generateTOTPSecret, verifyTOTP, encryptTOTPSecret, decryptTOTPSecret } from '../../../src/utils/totp';

// Mock utils
vi.mock('../../../src/utils/auth', async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    hashPassword: vi.fn(),
    verifyPassword: vi.fn(),
    hashApiKey: vi.fn(),
    getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
    hashUsername: vi.fn(),
    verifyDummyPassword: vi.fn(),
    verifyTurnstile: vi.fn(),
    safeCompare: vi.fn((a, b) => a === b),
    deletionCache: new Set()
  };
});

vi.mock('../../../src/utils/totp', () => ({
  generateTOTPSecret: vi.fn(),
  verifyTOTP: vi.fn(),
  encryptTOTPSecret: vi.fn(),
  decryptTOTPSecret: vi.fn()
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn()
}));

describe('AuthService', () => {
  let mockRepo: Record<keyof IAuthRepository, any>;
  let mockEnv: Env;
  let service: AuthService;
  let mockContext: Context<{ Bindings: Env }>;

  beforeEach(() => {
    mockRepo = {
      getUserCount: vi.fn(),
      checkInvitationTokenValid: vi.fn(),
      checkUsernameExists: vi.fn(),
      createUser: vi.fn(),
      recordLoginHistory: vi.fn(),
      checkIpRateLimit: vi.fn().mockResolvedValue({ limited: false, remaining: 10, reset: 0 }),
      createLoginChallenge: vi.fn(),
      cleanupExpiredGuests: vi.fn().mockResolvedValue(undefined),
      getAndConsumeChallenge: vi.fn(),
      createGuestUser: vi.fn(),
      getUserById: vi.fn(),
      updateUserApiKey: vi.fn(),
      updateUserPublicKey: vi.fn(),
      checkLoginRateLimit: vi.fn().mockResolvedValue({ locked: false, retryAfter: 0 }),
      getUserByUsername: vi.fn(),
      recordFailedLogin: vi.fn(),
      resetLoginAttempts: vi.fn(),
      scheduleUserDeletion: vi.fn(),
      cancelUserDeletion: vi.fn(),
      updateUserTwoFactorSecret: vi.fn(),
      getPasskeysByUserId: vi.fn(),
      savePasskey: vi.fn(),
      getPasskeyByCredentialId: vi.fn(),
      updatePasskeyCounter: vi.fn(),
      deletePasskey: vi.fn().mockResolvedValue(true),
      updateUserPlan: vi.fn(),
      linkGithubUser: vi.fn(),
      getUserByGithubId: vi.fn(),
      getUserByEmail: vi.fn(),
      createGithubUser: vi.fn()
    };
    mockEnv = {
      JWT_SECRET: 'test-secret',
      BETA_MODE_ENABLED: 'false',
      TURNSTILE_SECRET: 'turnstile',
      GITHUB_CLIENT_ID: 'ghid',
      GITHUB_CLIENT_SECRET: 'ghsec',
      SESSION_CACHE: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn()
      },
      COORDINATOR_DO: {
        idFromName: vi.fn().mockReturnValue('doid'),
        get: vi.fn().mockReturnValue({ fetch: vi.fn() })
      }
    } as any;
    service = new AuthService(mockEnv, mockRepo as any);
    mockContext = {
      req: {
        header: vi.fn(),
        raw: { cf: {} }
      }
    } as any;

    vi.mocked(hashUsername).mockResolvedValue('userhash');
    vi.mocked(hashPassword).mockResolvedValue('passhash');
    vi.mocked(hashApiKey).mockResolvedValue('apihash');
    vi.mocked(verifyTurnstile).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('registers user successfully', async () => {
      mockRepo.checkUsernameExists.mockResolvedValue(false);
      mockRepo.createUser.mockResolvedValue({ id: 'u1' });

      const result = await service.register({ username: 'testuser', password: 'password123' }, undefined, undefined, mockContext);
      expect(result.status).toBe('ok');
      expect(result.id).toBe('u1');
      expect(result.token).toBeDefined();
    });

    it('handles beta limit exceeded without bypass', async () => {
      mockEnv.BETA_MODE_ENABLED = 'true';
      mockEnv.BETA_USER_LIMIT = '1';
      mockRepo.getUserCount.mockResolvedValue(1);
      
      await expect(service.register({ username: 'testuser', password: 'password123' }, undefined, undefined, mockContext)).rejects.toThrow(/Beta registration limit reached/);
    });

    it('handles beta limit bypassed with valid token', async () => {
      mockEnv.BETA_MODE_ENABLED = 'true';
      mockEnv.BETA_USER_LIMIT = '1';
      mockRepo.getUserCount.mockResolvedValue(1);
      mockRepo.checkInvitationTokenValid.mockResolvedValue(true);
      mockRepo.createUser.mockResolvedValue({ id: 'u1' });

      const result = await service.register({ username: 'testuser', password: 'password123', inviteCode: 'valid' }, undefined, undefined, mockContext);
      expect(result.status).toBe('ok');
    });

    it('fails if turnstile required and fails', async () => {
      mockEnv.JWT_SECRET = 'live-secret';
      mockEnv.TURNSTILE_SECRET = 'secret';
      vi.mocked(verifyTurnstile).mockResolvedValue(false);
      
      await expect(service.register({ username: 'test', password: 'password' }, 'badtoken', 'ip', mockContext)).rejects.toThrow('Turnstile verification failed|403');
    });

    it('fails if username exists', async () => {
      mockRepo.checkUsernameExists.mockResolvedValue(true);
      await expect(service.register({ username: 'test', password: 'pw' }, undefined, undefined, mockContext)).rejects.toThrow('Username already exists|400');
    });
    
    it('fails if db create throws unique constraint', async () => {
      mockRepo.checkUsernameExists.mockResolvedValue(false);
      mockRepo.createUser.mockRejectedValue(new Error('UNIQUE constraint failed'));
      await expect(service.register({ username: 'test', password: 'pw' }, undefined, undefined, mockContext)).rejects.toThrow('Username already exists|400');
    });
  });

  describe('getMe', () => {
    it('returns user info', async () => {
      mockRepo.getUserById.mockResolvedValue({ username: 'test', api_key: 'key', public_key: 'pk', is_guest: 0, delete_requested_at: null, two_factor_enabled: 0 });
      const result = await service.getMe('u1');
      expect(result.username).toBe('test');
    });

    it('generates api key if missing', async () => {
      mockRepo.getUserById.mockResolvedValue({ username: 'test', api_key: null, public_key: 'pk', is_guest: 0, delete_requested_at: null, two_factor_enabled: 0 });
      const result = await service.getMe('u1');
      expect(result.api_key).toContain('swazz_live_');
    });

    it('throws 404 if not found', async () => {
      mockRepo.getUserById.mockResolvedValue(null);
      await expect(service.getMe('u1')).rejects.toThrow('User not found|404');
    });
  });

  describe('updatePublicKey', () => {
    it('updates public key', async () => {
      await service.updatePublicKey('u1', 'PK');
      expect(mockRepo.updateUserPublicKey).toHaveBeenCalledWith('u1', 'pk');
    });
  });

  describe('regenerateApiKey', () => {
    it('regenerates key and updates cache', async () => {
      mockRepo.getUserById.mockResolvedValue({ api_key: 'old' });
      const res = await service.regenerateApiKey('u1', mockContext);
      expect(res.api_key).toContain('swazz_live_');
      expect(mockEnv.SESSION_CACHE!.put).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('logs in successfully in test env', async () => {
      mockRepo.getUserByUsername.mockResolvedValue({ id: 'u1', password_hash: 'hash', two_factor_enabled: 0 });
      vi.mocked(verifyPassword).mockResolvedValue(true);

      const res = await service.login({ username: 'test', password: 'pw' }, '127.0.0.1', undefined, undefined, mockContext);
      expect(res.status).toBe('ok');
      expect(res.token).toBeDefined();
    });

    it('fails if user locked', async () => {
      mockRepo.checkLoginRateLimit.mockResolvedValue({ locked: true, retryAfter: 60 });
      await expect(service.login({ username: 'test', password: 'pw' }, '127.0.0.1', undefined, undefined, mockContext))
        .rejects.toThrow('Account temporarily locked due to too many failed attempts|429|60');
    });

    it('fails if account is a non-interactive service account', async () => {
      mockRepo.getUserByUsername.mockResolvedValue({ id: 'u1', password_hash: 'hash', two_factor_enabled: 0, is_interactive: 0 });
      await expect(service.login({ username: 'test', password: 'pw' }, '127.0.0.1', undefined, undefined, mockContext))
        .rejects.toThrow('Interactive login is disabled for service accounts|403');
      expect(vi.mocked(verifyDummyPassword)).toHaveBeenCalled();
    });

    it('fails with invalid credentials', async () => {
      mockRepo.getUserByUsername.mockResolvedValue(null);
      await expect(service.login({ username: 'test', password: 'pw' }, '127.0.0.1', undefined, undefined, mockContext))
        .rejects.toThrow('Invalid credentials|401');
      expect(vi.mocked(verifyDummyPassword)).toHaveBeenCalled();
    });

    it('fails with wrong password', async () => {
      mockRepo.getUserByUsername.mockResolvedValue({ id: 'u1', password_hash: 'hash', two_factor_enabled: 0 });
      vi.mocked(verifyPassword).mockResolvedValue(false);
      await expect(service.login({ username: 'test', password: 'wrong' }, '127.0.0.1', undefined, undefined, mockContext))
        .rejects.toThrow('Invalid credentials|401');
      expect(mockRepo.recordFailedLogin).toHaveBeenCalledWith('test');
    });

    it('requires 2fa if enabled', async () => {
      mockRepo.getUserByUsername.mockResolvedValue({ id: 'u1', password_hash: 'hash', two_factor_enabled: 1 });
      vi.mocked(verifyPassword).mockResolvedValue(true);
      const res = await service.login({ username: 'test', password: 'pw' }, '127.0.0.1', undefined, undefined, mockContext);
      expect(res.status).toBe('2fa_required');
    });

    it('verifies 2fa code correctly', async () => {
      mockRepo.getUserByUsername.mockResolvedValue({ id: 'u1', password_hash: 'hash', two_factor_enabled: 1, two_factor_secret: 'enc' });
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(decryptTOTPSecret).mockResolvedValue('secret');
      vi.mocked(verifyTOTP).mockResolvedValue(true);

      const res = await service.login({ username: 'test', password: 'pw', two_factor_code: '123' }, '127.0.0.1', undefined, undefined, mockContext);
      expect(res.status).toBe('ok');
    });
    
    it('fails 2fa code correctly', async () => {
      mockRepo.getUserByUsername.mockResolvedValue({ id: 'u1', password_hash: 'hash', two_factor_enabled: 1, two_factor_secret: 'enc' });
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(decryptTOTPSecret).mockResolvedValue('secret');
      vi.mocked(verifyTOTP).mockResolvedValue(false);

      await expect(service.login({ username: 'test', password: 'pw', two_factor_code: 'bad' }, '127.0.0.1', undefined, undefined, mockContext)).rejects.toThrow('Invalid credentials|401');
    });
  });

  describe('2FA setup and verify', () => {
    it('setup2FA creates secret', async () => {
      mockRepo.getUserById.mockResolvedValue({ username: 'test', two_factor_enabled: 0 });
      mockRepo.getUserByUsername.mockResolvedValue({ password_hash: 'hash' });
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(generateTOTPSecret).mockReturnValue('secret');
      vi.mocked(encryptTOTPSecret).mockResolvedValue('enc');

      const res = await service.setup2FA('u1', { password: 'pw' });
      expect(res.status).toBe('ok');
      expect(res.secret).toBe('secret');
    });

    it('verify2FA validates code and enables', async () => {
      mockRepo.getUserById.mockResolvedValue({ username: 'test' });
      mockRepo.getUserByUsername.mockResolvedValue({ password_hash: 'hash', two_factor_secret: 'enc' });
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(decryptTOTPSecret).mockResolvedValue('secret');
      vi.mocked(verifyTOTP).mockResolvedValue(true);

      const res = await service.verify2FA('u1', { password: 'pw', code: '123' });
      expect(res.status).toBe('ok');
      expect(mockRepo.updateUserTwoFactorSecret).toHaveBeenCalledWith('u1', 'enc', 1);
    });

    it('disable2FA removes secret', async () => {
      mockRepo.getUserById.mockResolvedValue({ username: 'test' });
      mockRepo.getUserByUsername.mockResolvedValue({ password_hash: 'hash', two_factor_enabled: 1, two_factor_secret: 'enc' });
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(decryptTOTPSecret).mockResolvedValue('secret');
      vi.mocked(verifyTOTP).mockResolvedValue(true);

      const res = await service.disable2FA('u1', { password: 'pw', code: '123' });
      expect(res.status).toBe('ok');
      expect(mockRepo.updateUserTwoFactorSecret).toHaveBeenCalledWith('u1', null, 0);
    });
  });

  describe('deleteUser', () => {
    it('schedules deletion', async () => {
      const res = await service.deleteUser('u1', mockContext);
      expect(res.status).toBe('deletion_scheduled');
      expect(mockRepo.scheduleUserDeletion).toHaveBeenCalledWith('u1');
    });
    
    it('cancels deletion', async () => {
      const res = await service.cancelDeleteUser('u1');
      expect(res.status).toBe('deletion_cancelled');
      expect(mockRepo.cancelUserDeletion).toHaveBeenCalledWith('u1');
    });
  });

  describe('Guest features', () => {
    it('registerGuestStep1 returns challenge', async () => {
      const res = await service.registerGuestStep1('ip', 't', 'ip');
      expect(res.status).toBe('ok');
      expect(res.challenge).toBeDefined();
    });

    it('registerGuest creates guest user', async () => {
      mockRepo.getAndConsumeChallenge.mockResolvedValue({
        challenge: 'chal', difficulty: 0, expires_at: new Date(Date.now() + 100000).toISOString()
      });
      mockRepo.createGuestUser.mockResolvedValue({ id: 'u1' });
      const res = await service.registerGuest({ token: 't', nonce: '0' }, undefined, undefined, mockContext);
      expect(res.status).toBe('ok');
      expect(res.username).toContain('g_');
      expect(res.token).toBeDefined();
    });
  });

  describe('Passkeys', () => {
    it('generatePasskeyRegistrationOptions', async () => {
      mockRepo.getUserById.mockResolvedValue({ username: 'u' });
      mockRepo.getPasskeysByUserId.mockResolvedValue([]);
      vi.mocked(simplewebauthn.generateRegistrationOptions).mockResolvedValue({ challenge: 'c' } as any);
      
      const res = await service.generatePasskeyRegistrationOptions('u1', 'rp', mockContext);
      expect(res.challenge).toBe('c');
    });

    it('verifyPasskeyRegistration', async () => {
      vi.mocked(mockEnv.SESSION_CACHE!.get).mockResolvedValue('c');
      vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValue({
        verified: true,
        registrationInfo: { credential: { id: '1', publicKey: new Uint8Array(), counter: 0 }, credentialDeviceType: 'd', credentialBackedUp: false }
      } as any);

      const res = await service.verifyPasskeyRegistration('u1', { response: {} }, 'origin', 'rp', mockContext);
      expect(res.status).toBe('ok');
    });

    it('generatePasskeyLoginOptions', async () => {
      mockRepo.getUserByUsername.mockResolvedValue({ id: 'u1' });
      mockRepo.getPasskeysByUserId.mockResolvedValue([{ credential_id: '1', transports: '' }]);
      vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({ challenge: 'c' } as any);

      const res = await service.generatePasskeyLoginOptions({ username: 'u' }, 'ip', 'rp', mockContext);
      expect(res.challenge).toBe('c');
    });

    it('verifyPasskeyLogin', async () => {
      mockRepo.getPasskeyByCredentialId.mockResolvedValue({ user_id: 'u1', public_key: 'AAAA', counter: 0, transports: '' });
      vi.mocked(mockEnv.SESSION_CACHE!.get).mockResolvedValue('c');
      vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 }
      } as any);
      mockRepo.getUserById.mockResolvedValue({ username: 'u' });

      const res = await service.verifyPasskeyLogin({ id: '1' }, 'ip', 'origin', 'rp', mockContext);
      expect(res.status).toBe('ok');
      expect(res.token).toBeDefined();
    });

    it('getPasskeys and delete', async () => {
      mockRepo.getPasskeysByUserId.mockResolvedValue([]);
      const pks = await service.getPasskeys('u1');
      expect(pks).toEqual([]);

      const del = await service.deletePasskey('u1', '1');
      expect(del.status).toBe('ok');
    });
  });

  describe('updateAdminUserPlan', () => {
    it('updates plan successfully', async () => {
      mockRepo.updateUserPlan.mockResolvedValue(1);
      const res = await service.updateAdminUserPlan('admin', 'admin', { username: 'u', plan: 'Supporter Plan' });
      expect(res.status).toBe('ok');
    });
    
    it('fails if wrong secret', async () => {
      await expect(service.updateAdminUserPlan('admin', 'wrong', { username: 'u', plan: 'Free' })).rejects.toThrow('Unauthorized|401');
    });
  });

  describe('Github OAuth', () => {
    it('handleGithubLogin generates url', async () => {
      const url = await service.handleGithubLogin('u1', 'redirect');
      expect(url).toContain('https://github.com/login/oauth/authorize');
    });

    it('exchangeOauthToken handles missing token', async () => {
      vi.mocked(mockEnv.SESSION_CACHE!.get).mockResolvedValue(null);
      await expect(service.exchangeOauthToken({ code: 'code' }, mockContext)).rejects.toThrow('Invalid or expired exchange code|400');
    });

    it('exchangeOauthToken succeeds', async () => {
      vi.mocked(mockEnv.SESSION_CACHE!.get).mockResolvedValue('jwt');
      const res = await service.exchangeOauthToken({ code: 'code' }, mockContext);
      expect(res.status).toBe('ok');
      expect(res.token).toBe('jwt');
    });
    
    it('handleGithubCallback handles bad state payload', async () => {
      const res = await service.handleGithubCallback('code', 'badstate', 'http://front', mockContext);
      expect(res.redirectUrl).toContain('error');
    });

    it('handleGithubCallback handles full login flow', async () => {
      const { sign } = await import('hono/jwt');
      const state = await sign({ action: 'login', exp: Math.floor(Date.now() / 1000) + 60 * 10 }, 'test-secret');

      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ access_token: 'gh-token' })
      });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ id: 12345, login: 'ghuser', email: 'test@github.com' })
      });

      mockRepo.getUserByGithubId.mockResolvedValue(null);
      mockRepo.getUserByEmail.mockResolvedValue(null);
      mockRepo.checkUsernameExists.mockResolvedValue(false);
      mockRepo.createGithubUser.mockResolvedValue({ id: 'u1' });

      const res = await service.handleGithubCallback('code', state, 'http://front', mockContext);
      expect(res.redirectUrl).toContain('exchange_code');
      expect(mockRepo.createGithubUser).toHaveBeenCalled();
    });

    it('handleGithubCallback handles linking user', async () => {
      const { sign } = await import('hono/jwt');
      const state = await sign({ action: 'link', userId: 'u1', exp: Math.floor(Date.now() / 1000) + 60 * 10 }, 'test-secret');

      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ access_token: 'gh-token' })
      });
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ id: 12345, login: 'ghuser' })
      });
      mockFetch.mockResolvedValueOnce({
        json: async () => ([{ email: 'test@github.com', primary: true, verified: true }])
      });

      mockRepo.linkGithubUser.mockResolvedValue(true);

      const res = await service.handleGithubCallback('code', state, 'http://front', mockContext);
      expect(res.redirectUrl).toContain('status=github_linked');
      expect(mockRepo.linkGithubUser).toHaveBeenCalledWith('u1', '12345');
    });
  });
});
