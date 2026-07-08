import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogRepository } from '../../../src/repositories/auditLog';
import { Env } from '../../../src/env';

describe('AuditLogRepository', () => {
  let mockAll: any;
  let mockBind: any;
  let mockPrepare: any;
  let mockDB: any;
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAll = vi.fn();
    mockBind = vi.fn().mockReturnValue({
      all: mockAll,
      first: mockAll,
      run: mockAll
    });
    mockPrepare = vi.fn().mockReturnValue({
      bind: mockBind
    });
    mockDB = {
      prepare: mockPrepare
    };
    mockEnv = {
      DB: mockDB
    } as unknown as Env;
  });

  it('should create audit log with resolved actor username and project member role', async () => {
    // Return username on first call (users query) and role on second call (project_members query)
    mockAll
      .mockResolvedValueOnce({ username: 'alex_test' }) // users query
      .mockResolvedValueOnce({ role: 'admin' })         // project_members query
      .mockResolvedValueOnce({ success: true });        // insert run query

    const repo = new AuditLogRepository(mockEnv);
    await repo.createAuditLog(
      'proj-123',
      'user-456',
      'action-test',
      'label-test',
      'web',
      'details-test',
      '127.0.0.1'
    );

    // Verify prepare was called for user query, member query, and insert
    expect(mockPrepare).toHaveBeenCalledTimes(3);
    expect(mockPrepare).toHaveBeenNthCalledWith(1, 'SELECT username FROM users WHERE id = ?');
    expect(mockPrepare).toHaveBeenNthCalledWith(2, 'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?');
    expect(mockPrepare).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO audit_logs'));

    // Verify binds
    expect(mockBind).toHaveBeenNthCalledWith(1, 'user-456');
    expect(mockBind).toHaveBeenNthCalledWith(2, 'proj-123', 'user-456');
    
    // Verify insert bind values
    const insertBindCall = mockBind.mock.calls[2];
    expect(insertBindCall[1]).toBe('proj-123'); // project_id
    expect(insertBindCall[2]).toBe('user-456'); // user_id
    expect(insertBindCall[3]).toBe('alex_test'); // actor_username
    expect(insertBindCall[4]).toBe('admin'); // actor_role
    expect(insertBindCall[5]).toBe('action-test'); // action
    expect(insertBindCall[6]).toBe('label-test'); // action_label
    expect(insertBindCall[7]).toBe('web'); // source
    expect(insertBindCall[8]).toBe('details-test'); // details
    expect(insertBindCall[9]).toBe('127.0.0.1'); // ip_address
    
    // The first bind argument is the generated ULID
    expect(insertBindCall[0]).toBeDefined();
    expect(typeof insertBindCall[0]).toBe('string');
    expect(insertBindCall[0].length).toBeGreaterThan(0);
  });

  it('should handle anonymous audit logs without querying user or project member', async () => {
    mockAll.mockResolvedValue({ success: true }); // insert query

    const repo = new AuditLogRepository(mockEnv);
    // userId is null
    await repo.createAuditLog(
      'proj-123',
      null,
      'action-test',
      'label-test',
      'web',
      null,
      null
    );

    // Should only prepare the INSERT query, not the user/member selects
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'));

    const insertBindCall = mockBind.mock.calls[0];
    expect(insertBindCall[1]).toBe('proj-123');
    expect(insertBindCall[2]).toBeNull();
    expect(insertBindCall[3]).toBeNull();
    expect(insertBindCall[4]).toBeNull();
    expect(insertBindCall[5]).toBe('action-test');
    expect(insertBindCall[6]).toBe('label-test');
    expect(insertBindCall[7]).toBe('web');
    expect(insertBindCall[8]).toBeNull();
    expect(insertBindCall[9]).toBeNull();
  });

  it('should fall back to null if user query or member query returns null', async () => {
    mockAll
      .mockResolvedValueOnce(null) // users query returns null
      .mockResolvedValueOnce(null) // project_members query returns null
      .mockResolvedValueOnce({ success: true }); // insert

    const repo = new AuditLogRepository(mockEnv);
    await repo.createAuditLog(
      'proj-123',
      'user-456',
      'action-test',
      'label-test',
      'web',
      null,
      null
    );

    expect(mockPrepare).toHaveBeenCalledTimes(3);

    const insertBindCall = mockBind.mock.calls[2];
    expect(insertBindCall[1]).toBe('proj-123');
    expect(insertBindCall[2]).toBe('user-456');
    expect(insertBindCall[3]).toBeNull();
    expect(insertBindCall[4]).toBeNull();
  });
});
