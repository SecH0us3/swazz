import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunnersRepository } from '../../../src/repositories/runners';
import { Env } from '../../../src/env';

describe('RunnersRepository Unit Tests', () => {
  let mockAll: any;
  let mockBind: any;
  let mockPrepare: any;
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
    mockDB = {
      prepare: mockPrepare
    };
    mockEnv = {
      DB: mockDB
    } as unknown as Env;
  });

  it('getUserByPublicKey should prepare query and return user object or null', async () => {
    const repo = new RunnersRepository(mockEnv);

    // 1. Success case returning user
    mockAll.mockResolvedValueOnce({ id: 'user-1' });
    const user = await repo.getUserByPublicKey('pubkey-123');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT id FROM users WHERE public_key = ?');
    expect(mockBind).toHaveBeenCalledWith('pubkey-123');
    expect(user).toEqual({ id: 'user-1' });

    // 2. Null case
    mockAll.mockResolvedValueOnce(undefined);
    const nullUser = await repo.getUserByPublicKey('pubkey-123');
    expect(nullUser).toBeNull();
  });

  it('getUserByApiKey should prepare query and return user object or null', async () => {
    const repo = new RunnersRepository(mockEnv);

    mockAll.mockResolvedValueOnce({ id: 'user-2' });
    const user = await repo.getUserByApiKey('hash-123');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT id FROM users WHERE api_key = ?');
    expect(mockBind).toHaveBeenCalledWith('hash-123');
    expect(user).toEqual({ id: 'user-2' });

    mockAll.mockResolvedValueOnce(undefined);
    const nullUser = await repo.getUserByApiKey('hash-123');
    expect(nullUser).toBeNull();
  });

  it('updateUserApiKey should run update statement', async () => {
    const repo = new RunnersRepository(mockEnv);

    await repo.updateUserApiKey('user-1', 'new-hash');
    expect(mockPrepare).toHaveBeenCalledWith('UPDATE users SET api_key = ? WHERE id = ?');
    expect(mockBind).toHaveBeenCalledWith('new-hash', 'user-1');
  });

  it('getDeleteRequestedAt should prepare query and return date or null', async () => {
    const repo = new RunnersRepository(mockEnv);

    mockAll.mockResolvedValueOnce({ delete_requested_at: '2026-07-08' });
    const date = await repo.getDeleteRequestedAt('user-1');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT delete_requested_at FROM users WHERE id = ?');
    expect(mockBind).toHaveBeenCalledWith('user-1');
    expect(date).toBe('2026-07-08');

    mockAll.mockResolvedValueOnce(undefined);
    const nullDate = await repo.getDeleteRequestedAt('user-1');
    expect(nullDate).toBeNull();
  });

  it('getUserPublicKey should prepare query and return public key or null', async () => {
    const repo = new RunnersRepository(mockEnv);

    mockAll.mockResolvedValueOnce({ public_key: 'pub-key' });
    const key = await repo.getUserPublicKey('user-1');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT public_key FROM users WHERE id = ?');
    expect(mockBind).toHaveBeenCalledWith('user-1');
    expect(key).toBe('pub-key');

    mockAll.mockResolvedValueOnce(undefined);
    const nullKey = await repo.getUserPublicKey('user-1');
    expect(nullKey).toBeNull();
  });

  it('createScanRecord should prepare insert query and run it', async () => {
    const repo = new RunnersRepository(mockEnv);

    await repo.createScanRecord('run-1', 'proj-1', 'https://target.com', 'profile-1', 'running', 'user-1');
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO scans'));
    expect(mockBind).toHaveBeenCalledWith('run-1', 'proj-1', 'https://target.com', 'profile-1', 'running', 'user-1');
  });

  it('getScanDetails should prepare query and return scan details or null', async () => {
    const repo = new RunnersRepository(mockEnv);

    mockAll.mockResolvedValueOnce({ project_id: 'proj-1', user_id: 'user-1' });
    const details = await repo.getScanDetails('scan-1');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT project_id, user_id FROM scans WHERE id = ?');
    expect(mockBind).toHaveBeenCalledWith('scan-1');
    expect(details).toEqual({ project_id: 'proj-1', user_id: 'user-1' });

    mockAll.mockResolvedValueOnce(undefined);
    const nullDetails = await repo.getScanDetails('scan-1');
    expect(nullDetails).toBeNull();
  });
});
