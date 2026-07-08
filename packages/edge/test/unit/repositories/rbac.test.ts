import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RbacRepository } from '../../../src/repositories/rbac';
import { Env } from '../../../src/env';

describe('RbacRepository Unit Tests', () => {
  let mockAll: any;
  let mockBind: any;
  let mockPrepare: any;
  let mockBatch: any;
  let mockDB: any;
  let mockKV: any;
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
    mockBatch = vi.fn();
    mockDB = {
      prepare: mockPrepare,
      batch: mockBatch
    };
    mockKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };
    mockEnv = {
      DB: mockDB,
      SESSION_CACHE: mockKV
    } as unknown as Env;
  });

  it('getProjectSessionTimeout returns timeout', async () => {
    mockAll.mockResolvedValue({ member_session_timeout: 3600 });
    const repo = new RbacRepository(mockEnv);
    const timeout = await repo.getProjectSessionTimeout('proj-123');
    expect(timeout).toBe(3600);
    expect(mockPrepare).toHaveBeenCalledWith('SELECT member_session_timeout FROM projects WHERE id = ?');
    expect(mockBind).toHaveBeenCalledWith('proj-123');
  });

  it('invalidateProjectRBAC deletes cache keys for all project members', async () => {
    mockAll.mockResolvedValue({
      results: [{ user_id: 'u1' }, { user_id: 'u2' }]
    });

    const repo = new RbacRepository(mockEnv);
    await repo.invalidateProjectRBAC('proj-123');

    expect(mockKV.delete).toHaveBeenCalledTimes(2);
    expect(mockKV.delete).toHaveBeenCalledWith('rbac:proj-123:u1');
    expect(mockKV.delete).toHaveBeenCalledWith('rbac:proj-123:u2');
  });

  it('invalidateUserRBAC deletes single user cache key', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.invalidateUserRBAC('proj-123', 'u1');
    expect(mockKV.delete).toHaveBeenCalledWith('rbac:proj-123:u1');
  });

  describe('checkPermission', () => {
    it('returns true on cache hit containing permission', async () => {
      mockKV.get.mockResolvedValue({ permissions: ['read:project', 'write:project'] });

      const repo = new RbacRepository(mockEnv);
      const hasPerm = await repo.checkPermission('u1', 'proj-123', 'write:project');

      expect(hasPerm).toBe(true);
      expect(mockKV.get).toHaveBeenCalledWith('rbac:proj-123:u1', 'json');
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('returns false and caches empty list on cache miss with no user roles', async () => {
      mockKV.get.mockResolvedValue(null);
      mockAll.mockResolvedValue({ results: [] }); // No roles found

      const repo = new RbacRepository(mockEnv);
      const hasPerm = await repo.checkPermission('u1', 'proj-123', 'write:project');

      expect(hasPerm).toBe(false);
      expect(mockKV.put).toHaveBeenCalledWith(
        'rbac:proj-123:u1',
        JSON.stringify({ permissions: [] }),
        { expirationTtl: 300 }
      );
    });

    it('resolves permission via default owner role on cache miss', async () => {
      mockKV.get.mockResolvedValue(null);
      // Returns role hierarchy containing 'owner'
      mockAll.mockResolvedValueOnce({
        results: [{ role_id: 'owner' }]
      });

      const repo = new RbacRepository(mockEnv);
      const hasPerm = await repo.checkPermission('u1', 'proj-123', 'post:/api/projects/:id/invitations');

      expect(hasPerm).toBe(true);
      // Verify resolved permissions are cached for 24h (86400)
      expect(mockKV.put).toHaveBeenCalledWith(
        'rbac:proj-123:u1',
        expect.stringContaining('post:/api/projects/:id/invitations'),
        { expirationTtl: 86400 }
      );
    });

    it('resolves permission via custom role on cache miss', async () => {
      mockKV.get.mockResolvedValue(null);
      // 1. Role hierarchy queries (returns custom-role)
      mockAll.mockResolvedValueOnce({
        results: [{ role_id: 'custom-role' }]
      });
      // 2. Custom role permissions query (returns permission)
      mockAll.mockResolvedValueOnce({
        results: [{ permission_key: 'custom:access' }]
      });

      const repo = new RbacRepository(mockEnv);
      const hasPerm = await repo.checkPermission('u1', 'proj-123', 'custom:access');

      expect(hasPerm).toBe(true);
      expect(mockPrepare).toHaveBeenNthCalledWith(2, 'SELECT permission_key FROM custom_role_permissions WHERE role_id IN (?)');
      expect(mockBind).toHaveBeenNthCalledWith(2, 'custom-role');
    });
  });

  it('isGuestUser returns user guest status', async () => {
    mockAll.mockResolvedValueOnce({ is_guest: 1 });
    const repo = new RbacRepository(mockEnv);
    expect(await repo.isGuestUser('u1')).toBe(true);

    mockAll.mockResolvedValueOnce(null);
    expect(await repo.isGuestUser('u2')).toBe(false);
  });

  it('getCustomRoles returns all custom roles', async () => {
    const mockRoles = [{ id: 'r1', name: 'Role 1' }];
    mockAll.mockResolvedValue({ results: mockRoles });

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getCustomRoles('proj-123')).toBe(mockRoles);
  });

  it('getCustomRolePermissions returns custom roles permissions', async () => {
    const mockPerms = [{ role_id: 'r1', permission_key: 'p1' }];
    mockAll.mockResolvedValue({ results: mockPerms });

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getCustomRolePermissions(['r1'])).toBe(mockPerms);
    expect(await repo.getCustomRolePermissions([])).toEqual([]);
  });

  it('getCustomRoleInheritance returns role hierarchy inheritance', async () => {
    const mockInheritance = [{ parent_role_id: 'r1', child_role_id: 'r2' }];
    mockAll.mockResolvedValue({ results: mockInheritance });

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getCustomRoleInheritance(['r1'])).toBe(mockInheritance);
    expect(await repo.getCustomRoleInheritance([])).toEqual([]);
  });

  it('checkCustomRolesExist returns intersection of existing custom roles', async () => {
    mockAll.mockResolvedValue({ results: [{ id: 'r1' }] });
    const repo = new RbacRepository(mockEnv);
    expect(await repo.checkCustomRolesExist('proj-123', ['r1', 'r2'])).toEqual(['r1']);
    expect(await repo.checkCustomRolesExist('proj-123', [])).toEqual([]);
  });

  it('checkRoleNameExists queries DB for role names', async () => {
    mockAll.mockResolvedValueOnce({ 1: 1 });
    const repo = new RbacRepository(mockEnv);
    expect(await repo.checkRoleNameExists('proj-123', 'Admin')).toBe(true);

    mockAll.mockResolvedValueOnce(null);
    expect(await repo.checkRoleNameExists('proj-123', 'Admin', 'exclude-1')).toBe(false);
  });

  it('createCustomRole prepares and runs a batch transaction to insert role detail, perms, and inheritance', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.createCustomRole('r1', 'proj-123', 'RoleName', ['perm1'], ['child1']);

    expect(mockPrepare).toHaveBeenCalledTimes(3);
    expect(mockBatch).toHaveBeenCalled();
  });

  it('getProjectMembers returns project member details', async () => {
    const mockMembers = [{ id: 'u1', username: 'alex' }];
    mockAll.mockResolvedValue({ results: mockMembers });

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getProjectMembers('proj-123')).toBe(mockMembers);
  });

  it('getPendingInvitations returns pending project invites', async () => {
    const mockInvites = [{ id: 'i1', email: 'a@b.com' }];
    mockAll.mockResolvedValue({ results: mockInvites });

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getPendingInvitations('proj-123')).toBe(mockInvites);
  });

  it('checkInvitationExists checks if invitation token is registered', async () => {
    mockAll.mockResolvedValueOnce({ 1: 1 });
    const repo = new RbacRepository(mockEnv);
    expect(await repo.checkInvitationExists('inv-1', 'proj-123')).toBe(true);
  });

  it('updateInvitationRoles updates roles in invitation target JSON', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.updateInvitationRoles('inv-1', ['role1']);
    expect(mockBind).toHaveBeenCalledWith(JSON.stringify(['role1']), 'inv-1');
  });

  it('getMemberRoles returns direct member role IDs', async () => {
    mockAll.mockResolvedValue({ results: [{ role_id: 'r1' }] });
    const repo = new RbacRepository(mockEnv);
    expect(await repo.getMemberRoles('proj-123', 'u1')).toEqual(['r1']);
  });

  it('getProjectOwnersCount calculates distinct project owners', async () => {
    mockAll.mockResolvedValueOnce({ count: 3 });
    const repo = new RbacRepository(mockEnv);
    expect(await repo.getProjectOwnersCount('proj-123')).toBe(3);
  });

  it('updateMemberRoles deletes old member roles and inserts new ones via batch transaction', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.updateMemberRoles('proj-123', 'u1', ['role1', 'role2']);

    expect(mockPrepare).toHaveBeenCalledTimes(3); // 1 delete + 2 inserts
    expect(mockBatch).toHaveBeenCalled();
  });

  it('revokeInvitation updates invitation status to Revoked', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.revokeInvitation('inv-1');
    expect(mockPrepare).toHaveBeenCalledWith("UPDATE project_invitations SET status = 'Revoked' WHERE id = ?");
  });

  it('removeProjectMember deletes member and associated roles via batch transaction', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.removeProjectMember('proj-123', 'u1');

    expect(mockPrepare).toHaveBeenCalledTimes(2);
    expect(mockBatch).toHaveBeenCalled();
  });

  it('updateCustomRole updates role detail and resets perms/inheritance in batch transaction', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.updateCustomRole('r1', 'NewName', ['p1'], ['child1']);

    expect(mockPrepare).toHaveBeenCalledTimes(5); // update + delete_perms + delete_inh + insert_perm + insert_inh
    expect(mockBatch).toHaveBeenCalled();
  });

  it('deleteCustomRole removes role and cascading permissions/inheritance in batch transaction', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.deleteCustomRole('r1');

    expect(mockPrepare).toHaveBeenCalledTimes(4);
    expect(mockBatch).toHaveBeenCalled();
  });

  it('getUserDetails returns profile username and email', async () => {
    const details = { email: 'a@b.com', username: 'alex' };
    mockAll.mockResolvedValue(details);

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getUserDetails('u1')).toBe(details);
  });

  it('getUserInvitations returns pending invitations matching email or username', async () => {
    const invites = [{ id: 'inv-1' }];
    mockAll.mockResolvedValue({ results: invites });

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getUserInvitations('a@b.com', 'alex')).toBe(invites);
  });

  it('getInvitationByToken returns invitation email and username', async () => {
    const inv = { username: 'alex', email: 'a@b.com' };
    mockAll.mockResolvedValue(inv);

    const repo = new RbacRepository(mockEnv);
    expect(await repo.getInvitationByToken('token-123')).toBe(inv);
  });

  it('createInvitation inserts new invitation row', async () => {
    const repo = new RbacRepository(mockEnv);
    await repo.createInvitation('inv-1', 'proj-123', 'a@b.com', 'alex', ['role1'], 'token-123', '2026-07-08T18:00:00Z');

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO project_invitations'));
    expect(mockBind).toHaveBeenCalledWith(
      'inv-1',
      'proj-123',
      'a@b.com',
      'alex',
      JSON.stringify(['role1']),
      'token-123',
      '2026-07-08T18:00:00Z'
    );
  });

  describe('acceptInvitation', () => {
    it('returns null if invitation not found or expired', async () => {
      mockAll.mockResolvedValue(null);

      const repo = new RbacRepository(mockEnv);
      const res = await repo.acceptInvitation('token-1', 'alex', 'a@b.com', 'u1');

      expect(res).toBeNull();
    });

    it('updates invitation status and runs batch to assign member roles', async () => {
      const invitation = {
        project_id: 'proj-123',
        target_role_ids: JSON.stringify(['role1', 'role2'])
      };

      mockAll.mockResolvedValueOnce(invitation); // update invitation RETURNING *

      const repo = new RbacRepository(mockEnv);
      const res = await repo.acceptInvitation('token-1', 'alex', 'a@b.com', 'u1');

      expect(res).toBe(invitation);
      expect(mockPrepare).toHaveBeenCalledTimes(4); // 1 update + 2 role inserts + 1 member insert
      expect(mockBatch).toHaveBeenCalled();
    });
  });

  it('declineInvitation updates status and returns true if changed', async () => {
    mockAll.mockResolvedValue({ meta: { changes: 1 } });
    const repo = new RbacRepository(mockEnv);
    expect(await repo.declineInvitation('token-1', 'alex', 'a@b.com')).toBe(true);

    mockAll.mockResolvedValue({ meta: { changes: 0 } });
    expect(await repo.declineInvitation('token-1', 'alex', 'a@b.com')).toBe(false);
  });
});
