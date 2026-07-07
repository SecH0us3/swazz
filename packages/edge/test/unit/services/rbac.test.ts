import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RbacService } from '../../../src/services/rbac';
import { Env } from '../../../src/env';

describe('RbacService', () => {
  let mockEnv: Env;
  let mockRepo: any;
  let service: RbacService;

  beforeEach(() => {
    mockEnv = {} as Env;
    mockRepo = {
      isGuestUser: vi.fn().mockResolvedValue(false),
      getCustomRoles: vi.fn().mockResolvedValue([]),
      getCustomRolePermissions: vi.fn().mockResolvedValue([]),
      getCustomRoleInheritance: vi.fn().mockResolvedValue([]),
      checkCustomRolesExist: vi.fn().mockResolvedValue([]),
      checkRoleNameExists: vi.fn().mockResolvedValue(false),
      createCustomRole: vi.fn().mockResolvedValue(undefined),
      invalidateProjectRBAC: vi.fn().mockResolvedValue(undefined),
      getProjectMembers: vi.fn().mockResolvedValue([]),
      getPendingInvitations: vi.fn().mockResolvedValue([]),
      getMemberRoles: vi.fn().mockResolvedValue([]),
      updateMemberRoles: vi.fn().mockResolvedValue(undefined),
      removeMember: vi.fn().mockResolvedValue(undefined),
      deleteCustomRole: vi.fn().mockResolvedValue(undefined),
      clearRoleFromMembers: vi.fn().mockResolvedValue(undefined),
      clearRoleFromInheritance: vi.fn().mockResolvedValue(undefined),
      clearRoleFromInvitations: vi.fn().mockResolvedValue(undefined),
      updateCustomRole: vi.fn().mockResolvedValue(undefined),
      getUserInvitations: vi.fn().mockResolvedValue([]),
      checkExistingInvitation: vi.fn().mockResolvedValue(false),
      checkIsMember: vi.fn().mockResolvedValue(false),
      createInvitation: vi.fn().mockResolvedValue(undefined),
      getInvitationById: vi.fn().mockResolvedValue(null),
      deleteInvitation: vi.fn().mockResolvedValue(undefined),
      deleteInvitationsForUserInProject: vi.fn().mockResolvedValue(undefined),
      checkInvitationExists: vi.fn().mockResolvedValue(false),
      revokeInvitation: vi.fn().mockResolvedValue(undefined),
      getUserDetails: vi.fn().mockResolvedValue({ id: 'u1' }),
      invalidateUserRBAC: vi.fn().mockResolvedValue(undefined),
      getProjectOwnersCount: vi.fn().mockResolvedValue(1),
      removeProjectMember: vi.fn().mockResolvedValue(undefined),
      acceptInvitation: vi.fn().mockResolvedValue({ id: 'inv1', project_id: 'p1' }),
      declineInvitation: vi.fn().mockResolvedValue(true),
      checkExistingInvitationByEmailOrUsername: vi.fn().mockResolvedValue(null),
    };
    service = new RbacService(mockEnv, mockRepo);
  });

  describe('getPermissions', () => {
    it('returns permissions', () => {
      const perms = service.getPermissions();
      expect(perms.permissions).toBeDefined();
    });
  });

  describe('getRoles', () => {
    it('returns default roles and custom roles', async () => {
      mockRepo.getCustomRoles.mockResolvedValue([{ id: 'c_1', name: 'Custom Role' }]);
      mockRepo.getCustomRolePermissions.mockResolvedValue([{ role_id: 'c_1', permission_key: 'get:/api/projects/:id' }]);
      mockRepo.getCustomRoleInheritance.mockResolvedValue([{ parent_role_id: 'c_1', child_role_id: 'viewer' }]);

      const res = await service.getRoles('p1');
      expect(res.roles.length).toBeGreaterThan(0);
      const custom = res.roles.find(r => r.id === 'c_1');
      expect(custom).toBeDefined();
      expect(custom?.permissions).toEqual(['get:/api/projects/:id']);
      expect(custom?.included_roles).toEqual(['viewer']);
    });
  });

  describe('createCustomRole', () => {
    it('throws if guest', async () => {
      mockRepo.isGuestUser.mockResolvedValue(true);
      await expect(service.createCustomRole('p1', 'u1', { name: 'Test' })).rejects.toThrow('Forbidden: Guest accounts cannot modify members or roles.|403');
    });

    it('throws if invalid name', async () => {
      await expect(service.createCustomRole('p1', 'u1', { name: '' })).rejects.toThrow('Role name is required and must be a non-empty string|400');
    });

    it('throws if unknown permission', async () => {
      await expect(service.createCustomRole('p1', 'u1', { name: 'Test', permissions: ['fake:perm'] })).rejects.toThrow(/Unknown permission keys: fake:perm/);
    });

    it('throws if unknown included role', async () => {
      await expect(service.createCustomRole('p1', 'u1', { name: 'Test', permissions: [], included_roles: ['c_unknown'] })).rejects.toThrow(/Unknown role IDs: c_unknown/);
    });

    it('throws if name exists', async () => {
      mockRepo.checkRoleNameExists.mockResolvedValue(true);
      await expect(service.createCustomRole('p1', 'u1', { name: 'Test', permissions: [] })).rejects.toThrow('A role with this name already exists|400');
    });

    it('creates custom role', async () => {
      const res = await service.createCustomRole('p1', 'u1', { name: 'Test', permissions: ['get:/api/projects/:id'] });
      expect(res.status).toBe('created');
      expect(mockRepo.createCustomRole).toHaveBeenCalled();
      expect(mockRepo.invalidateProjectRBAC).toHaveBeenCalledWith('p1');
    });
  });

  describe('getMembers', () => {
    it('returns members and invites', async () => {
      mockRepo.getProjectMembers.mockResolvedValue([
        { id: 'u1', username: 'u1', email: 'u1@', role_id: 'admin', two_factor_enabled: 1, github_id: 'gh' }
      ]);
      mockRepo.getPendingInvitations.mockResolvedValue([
        { id: 'inv1', username: 'u2', email: 'u2@', target_role_ids: '["viewer"]' }
      ]);
      const res = await service.getMembers('p1');
      expect(res.members).toHaveLength(2);
      expect(res.members[0].roles).toEqual(['admin']);
      expect(res.members[1].is_pending).toBe(true);
    });
  });

  describe('updateMemberRoles', () => {
    it('throws if guest', async () => {
      mockRepo.isGuestUser.mockResolvedValue(true);
      await expect(service.updateMemberRoles('p1', 'u1', 'm1', { roles: ['viewer'] })).rejects.toThrow('Forbidden: Guest accounts cannot modify members or roles.|403');
    });

    it('throws if removing last owner', async () => {
      mockRepo.getMemberRoles.mockResolvedValue(['owner']);
      mockRepo.getProjectOwnersCount.mockResolvedValue(1);
      await expect(service.updateMemberRoles('p1', 'u1', 'm1', { roles: ['viewer'] })).rejects.toThrow('Cannot remove the owner role from the last owner|400');
    });

    it('updates member roles', async () => {
      mockRepo.getProjectMembers.mockResolvedValue([
        { id: 'm1', role_id: 'viewer' }
      ]);
      mockRepo.getMemberRoles.mockResolvedValue(['viewer']);
      const res = await service.updateMemberRoles('p1', 'u1', 'm1', { roles: ['editor'] });
      expect(res.status).toBe('updated');
      expect(mockRepo.updateMemberRoles).toHaveBeenCalledWith('p1', 'm1', ['editor']);
    });
  });

  describe('removeMember', () => {
    it('throws if removing last owner', async () => {
      mockRepo.getMemberRoles.mockResolvedValue(['owner']);
      mockRepo.getProjectOwnersCount.mockResolvedValue(1);
      await expect(service.removeMember('p1', 'u1', 'm1')).rejects.toThrow('Cannot remove the last owner of the project|400');
    });

    it('removes member', async () => {
      mockRepo.getMemberRoles.mockResolvedValue(['viewer']);
      const res = await service.removeMember('p1', 'u1', 'm1');
      expect(res.status).toBe('removed');
      expect(mockRepo.removeProjectMember).toHaveBeenCalledWith('p1', 'm1');
    });
  });

  describe('updateCustomRole', () => {
    it('throws if default role', async () => {
      await expect(service.updateCustomRole('p1', 'u1', 'owner', { name: 'Test' })).rejects.toThrow('Default roles cannot be edited|400');
    });

    it('updates custom role', async () => {
      mockRepo.checkCustomRolesExist.mockResolvedValue(['c_1']);
      const res = await service.updateCustomRole('p1', 'u1', 'c_1', { name: 'Test', permissions: ['get:/api/projects/:id'] });
      expect(res.status).toBe('updated');
    });
  });

  describe('deleteCustomRole', () => {
    it('throws if default role', async () => {
      await expect(service.deleteCustomRole('p1', 'u1', 'owner')).rejects.toThrow('Default roles cannot be deleted|400');
    });

    it('deletes custom role', async () => {
      mockRepo.checkCustomRolesExist.mockResolvedValue(['c_1']);
      const res = await service.deleteCustomRole('p1', 'u1', 'c_1');
      expect(res.status).toBe('deleted');
    });
  });

  describe('Invitations', () => {
    it('getInvitations', async () => {
      mockRepo.getUserInvitations.mockResolvedValue([{ id: 'inv1' }]);
      const res = await service.getInvitations('u1');
      expect(res.invitations).toHaveLength(1);
    });

    it('createInvitation creates token', async () => {
      mockRepo.checkIsMember.mockResolvedValue(false);
      const res = await service.createInvitation('p1', 'u1', { email: 'u2@test', roles: ['viewer'] });
      expect(res.status).toBe('created');
      expect(res.token).toBeDefined();
    });

    it('acceptInvitation throws if not found', async () => {
      mockRepo.acceptInvitation.mockResolvedValue(null);
      mockRepo.getInvitationByToken = vi.fn().mockResolvedValue(null);
      await expect(service.acceptInvitation('u1', { token: 'tok' })).rejects.toThrow('Invalid or expired invitation|400');
    });

    it('acceptInvitation accepts and adds member', async () => {
      mockRepo.acceptInvitation.mockResolvedValue({ id: 'inv1', project_id: 'p1' });
      const res = await service.acceptInvitation('u1', { token: 'tok' });
      expect(res.status).toBe('accepted');
      expect(mockRepo.acceptInvitation).toHaveBeenCalled();
    });

    it('declineInvitation declines', async () => {
      mockRepo.declineInvitation.mockResolvedValue(true);
      const res = await service.declineInvitation('u1', { token: 'tok' });
      expect(res.status).toBe('declined');
      expect(mockRepo.declineInvitation).toHaveBeenCalled();
    });
  });
});
