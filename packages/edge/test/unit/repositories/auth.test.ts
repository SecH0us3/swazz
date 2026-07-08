import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRepository } from '../../../src/repositories/auth';
import { Env } from '../../../src/env';

vi.mock('../../../src/utils/cleanup', () => ({
  cleanupExpiredGuests: vi.fn().mockResolvedValue(undefined)
}));

describe('AuthRepository Unit Tests', () => {
  let mockAll: any;
  let mockBind: any;
  let mockPrepare: any;
  let mockBatch: any;
  let mockDB: any;
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAll = vi.fn();
    const mockStmt: any = {
      all: mockAll,
      first: mockAll,
      run: mockAll
    };
    mockBind = vi.fn().mockReturnValue(mockStmt);
    mockStmt.bind = mockBind;

    mockPrepare = vi.fn().mockReturnValue(mockStmt);
    mockBatch = vi.fn().mockResolvedValue([]);
    mockDB = {
      prepare: mockPrepare,
      batch: mockBatch
    };
    mockEnv = {
      DB: mockDB
    } as unknown as Env;
  });

  it('checkUsernameExists queries username registry', async () => {
    mockAll.mockResolvedValueOnce({ username_hash: 'hash' });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.checkUsernameExists('hash')).toBe(true);

    mockAll.mockResolvedValueOnce(undefined);
    expect(await repo.checkUsernameExists('hash')).toBe(false);
  });

  it('createUser executes batch register statements', async () => {
    const repo = new AuthRepository(mockEnv);
    const res = await repo.createUser('user1', 'u-hash', 'pwd-hash', 'email@test.com', 'api-key-hash');
    expect(mockBatch).toHaveBeenCalled();
    expect(res.id).toBeDefined();
    expect(res.projectId).toBeDefined();
  });

  it('createGuestUser executes batch guest insert', async () => {
    const repo = new AuthRepository(mockEnv);
    const res = await repo.createGuestUser('guest1', 'pwd-hash', 'api-key-hash');
    expect(mockBatch).toHaveBeenCalled();
    expect(res.id).toBeDefined();
  });

  it('createLoginChallenge inserts record', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.createLoginChallenge('tok1', 'user1', 'chall', 4, '2026-07-08');
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO login_challenges'));
  });

  it('getAndConsumeChallenge queries and deletes challenge', async () => {
    const repo = new AuthRepository(mockEnv);

    // 1. Expected username matching
    mockAll.mockResolvedValueOnce({ username: 'user1', challenge: 'chall' });
    const res = await repo.getAndConsumeChallenge('tok1', 'user1');
    expect(res).toEqual({ username: 'user1', challenge: 'chall' });
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM login_challenges'));

    // 2. No expected username passed
    mockAll.mockResolvedValueOnce({ username: 'user1', challenge: 'chall' });
    await repo.getAndConsumeChallenge('tok1');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT username, challenge, difficulty, expires_at FROM login_challenges WHERE token = ?');
  });

  it('getUserById queries users table', async () => {
    mockAll.mockResolvedValueOnce({ username: 'user1' });
    const repo = new AuthRepository(mockEnv);
    const res = await repo.getUserById('uid-123');
    expect(res).toEqual({ username: 'user1' });
  });

  it('getUserByUsername queries users table', async () => {
    mockAll.mockResolvedValueOnce({ id: 'uid-123' });
    const repo = new AuthRepository(mockEnv);
    const res = await repo.getUserByUsername('user1');
    expect(res).toEqual({ id: 'uid-123' });
  });

  it('updateUserApiKey runs update statement', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.updateUserApiKey('uid', 'new-key');
    expect(mockPrepare).toHaveBeenCalledWith('UPDATE users SET api_key = ? WHERE id = ?');
  });

  it('updateUserPublicKey runs update statement', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.updateUserPublicKey('uid', 'pub-key');
    expect(mockPrepare).toHaveBeenCalledWith('UPDATE users SET public_key = ? WHERE id = ?');
  });

  it('scheduleUserDeletion marks delete date and fails active scans', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.scheduleUserDeletion('uid');
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET delete_requested_at'));
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE scans'));
  });

  it('cancelUserDeletion resets deletion date', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.cancelUserDeletion('uid');
    expect(mockPrepare).toHaveBeenCalledWith('UPDATE users SET delete_requested_at = NULL WHERE id = ?');
  });

  it('updateUserTwoFactorSecret updates totp fields', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.updateUserTwoFactorSecret('uid', 'secret', 1);
    expect(mockPrepare).toHaveBeenCalledWith('UPDATE users SET two_factor_secret = ?, two_factor_enabled = ? WHERE id = ?');
  });

  it('getPasskeysByUserId lists passkeys', async () => {
    mockAll.mockResolvedValueOnce({ results: [{ credential_id: 'c1' }] });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.getPasskeysByUserId('uid')).toEqual([{ credential_id: 'c1' }]);
  });

  it('getPasskeyByCredentialId queries single passkey', async () => {
    mockAll.mockResolvedValueOnce({ public_key: 'pk' });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.getPasskeyByCredentialId('c1')).toEqual({ public_key: 'pk' });
  });

  it('savePasskey inserts passkey record', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.savePasskey('cred-1', 'uid', 'pk', 'web-uid', 10, 'usb', true, 'usb');
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO passkeys'));
  });

  it('updatePasskeyCounter updates counter', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.updatePasskeyCounter('cred-1', 20);
    expect(mockPrepare).toHaveBeenCalledWith('UPDATE passkeys SET counter = ? WHERE credential_id = ?');
  });

  it('deletePasskey deletes passkey record', async () => {
    mockAll.mockResolvedValueOnce({ success: true });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.deletePasskey('uid', 'cred-1')).toBe(true);
  });

  it('updateUserPlan updates plan and returns changes count', async () => {
    mockAll.mockResolvedValueOnce({ meta: { changes: 1 } });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.updateUserPlan('user1', 'Pro')).toBe(1);
  });

  it('linkGithubUser links account or returns false on conflict', async () => {
    const repo = new AuthRepository(mockEnv);

    // 1. Conflict case (another user linked)
    mockAll.mockResolvedValueOnce({ id: 'another-user' });
    expect(await repo.linkGithubUser('uid', 'gh-id')).toBe(false);

    // 2. Success case
    mockAll.mockResolvedValueOnce(undefined);
    expect(await repo.linkGithubUser('uid', 'gh-id')).toBe(true);
  });

  it('getUserByGithubId queries github_id', async () => {
    mockAll.mockResolvedValueOnce({ id: 'uid' });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.getUserByGithubId('gh-id')).toEqual({ id: 'uid' });
  });

  it('getUserByEmail queries email', async () => {
    mockAll.mockResolvedValueOnce({ id: 'uid' });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.getUserByEmail('test@email.com')).toEqual({ id: 'uid' });
  });

  it('createGithubUser runs batch registration', async () => {
    const repo = new AuthRepository(mockEnv);
    const res = await repo.createGithubUser('user1', 'u-hash', 'pwd-hash', 'test@email.com', 'api-key-hash', 'gh-id');
    expect(mockBatch).toHaveBeenCalled();
    expect(res.id).toBeDefined();
  });

  describe('checkIpRateLimit', () => {
    it('sets initial rate limit record', async () => {
      mockAll.mockResolvedValueOnce(undefined); // SELECT returns nothing
      const repo = new AuthRepository(mockEnv);
      const res = await repo.checkIpRateLimit('ip:1.1.1.1', 5, 60);
      expect(res.limited).toBe(false);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO rate_limits'));
    });

    it('resets rate limit record if expired', async () => {
      mockAll.mockResolvedValueOnce({ attempts: 3, reset_at: '2020-01-01 00:00:00' });
      const repo = new AuthRepository(mockEnv);
      const res = await repo.checkIpRateLimit('ip:1.1.1.1', 5, 60);
      expect(res.limited).toBe(false);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE rate_limits SET attempts = 1'));
    });

    it('returns limited true if max attempts exceeded', async () => {
      const future = new Date(Date.now() + 60000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      mockAll.mockResolvedValueOnce({ attempts: 5, reset_at: future });
      const repo = new AuthRepository(mockEnv);
      const res = await repo.checkIpRateLimit('ip:1.1.1.1', 5, 60);
      expect(res.limited).toBe(true);
    });

    it('increments attempts if within bounds and not expired', async () => {
      const future = new Date(Date.now() + 60000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      mockAll.mockResolvedValueOnce({ attempts: 3, reset_at: future });
      const repo = new AuthRepository(mockEnv);
      const res = await repo.checkIpRateLimit('ip:1.1.1.1', 5, 60);
      expect(res.limited).toBe(false);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE rate_limits SET attempts = attempts + 1'));
    });

    it('probabilistically cleans up rate limits', async () => {
      // Force random to trigger cleanup (< 0.01)
      vi.spyOn(Math, 'random').mockReturnValue(0.005);
      mockAll.mockResolvedValueOnce(undefined);
      const repo = new AuthRepository(mockEnv);
      await repo.checkIpRateLimit('ip:1.1.1.1', 5, 60);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM rate_limits'));
    });
  });

  describe('checkLoginRateLimit', () => {
    it('returns locked false if no login attempt record exists', async () => {
      mockAll.mockResolvedValueOnce(undefined);
      const repo = new AuthRepository(mockEnv);
      expect(await repo.checkLoginRateLimit('user1')).toEqual({ locked: false });
    });

    it('returns locked true if lockout is active', async () => {
      const future = new Date(Date.now() + 60000).toISOString().replace('Z', '');
      mockAll.mockResolvedValueOnce({ failed_count: 5, locked_until: future });
      const repo = new AuthRepository(mockEnv);
      const res = await repo.checkLoginRateLimit('user1');
      expect(res.locked).toBe(true);
      expect(res.retryAfter).toBe(future);
    });

    it('resets lockout count if lockout is expired', async () => {
      const past = new Date(Date.now() - 60000).toISOString().replace('Z', '');
      mockAll.mockResolvedValueOnce({ failed_count: 5, locked_until: past });
      const repo = new AuthRepository(mockEnv);
      const res = await repo.checkLoginRateLimit('user1');
      expect(res.locked).toBe(false);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE login_attempts SET failed_count = 0'));
    });
  });

  it('recordFailedLogin increments login attempts', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.recordFailedLogin('user1');
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO login_attempts'));
  });

  it('resetLoginAttempts deletes attempts record', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.resetLoginAttempts('user1');
    expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM login_attempts WHERE username = ?');
  });

  describe('recordLoginHistory', () => {
    it('inserts login history successfully', async () => {
      const repo = new AuthRepository(mockEnv);
      await repo.recordLoginHistory('uid', 'success', 'password', true, {
        ipAddress: '1.1.1.1',
        userAgent: 'UA',
        cfRay: 'ray',
        country: 'US',
        city: 'NY',
        region: 'NY',
        timezone: 'UTC'
      });
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_login_history'));
    });

    it('catches database error silently', async () => {
      const repo = new AuthRepository(mockEnv);
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('history db error');
      });
      const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await repo.recordLoginHistory('uid', 'success', 'password', true, {} as any);
      expect(spyConsoleError).toHaveBeenCalled();
      spyConsoleError.mockRestore();
    });
  });

  it('cleanupExpiredGuests delegates call', async () => {
    const repo = new AuthRepository(mockEnv);
    await repo.cleanupExpiredGuests();
    const { cleanupExpiredGuests: mockCleanup } = await import('../../../src/utils/cleanup');
    expect(mockCleanup).toHaveBeenCalled();
  });

  describe('verifyApiKey', () => {
    it('returns userId if hashedToken matches api_key', async () => {
      mockAll.mockResolvedValueOnce({ id: 'uid' });
      const repo = new AuthRepository(mockEnv);
      expect(await repo.verifyApiKey('hash', 'plain')).toBe('uid');
    });

    it('updates to hashedToken if plainToken matches and returns userId', async () => {
      mockAll.mockResolvedValueOnce(undefined); // hashedToken fails
      mockAll.mockResolvedValueOnce({ id: 'uid' }); // plainToken succeeds
      const repo = new AuthRepository(mockEnv);
      expect(await repo.verifyApiKey('hash', 'plain')).toBe('uid');
      expect(mockPrepare).toHaveBeenCalledWith('UPDATE users SET api_key = ? WHERE id = ?');
    });
  });

  it('getUserDeleteRequestedAt queries users table', async () => {
    mockAll.mockResolvedValueOnce({ delete_requested_at: 'date' });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.getUserDeleteRequestedAt('uid')).toBe('date');
  });

  it('getUserCount returns count', async () => {
    mockAll.mockResolvedValueOnce({ count: 100 });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.getUserCount()).toBe(100);

    mockAll.mockResolvedValueOnce(undefined);
    expect(await repo.getUserCount()).toBe(0);
  });

  it('checkInvitationTokenValid queries token', async () => {
    mockAll.mockResolvedValueOnce({ id: 'inv-1' });
    const repo = new AuthRepository(mockEnv);
    expect(await repo.checkInvitationTokenValid('tok-1')).toBe(true);

    mockAll.mockResolvedValueOnce(undefined);
    expect(await repo.checkInvitationTokenValid('tok-1')).toBe(false);
  });
});
