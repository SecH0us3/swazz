import { Env } from '../env';
import { IRbacRepository } from '../repositories/rbac';
import { PERMISSIONS, DEFAULT_ROLES } from '../config/rbac';

import { ulid } from 'ulidx';

export interface IRbacService {
  getPermissions(): { permissions: Record<string, string> };
  getRoles(projectId: string): Promise<{ roles: any[] }>;
  createCustomRole(projectId: string, userId: string | null, body: any): Promise<{ status: string; id: string }>;
  getMembers(projectId: string): Promise<{ members: any[] }>;
  updateMemberRoles(projectId: string, userId: string | null, memberId: string, body: any): Promise<{ status: string }>;
  removeMember(projectId: string, userId: string | null, memberId: string): Promise<{ status: string }>;
  updateCustomRole(projectId: string, userId: string | null, roleId: string, body: any): Promise<{ status: string }>;
  deleteCustomRole(projectId: string, userId: string | null, roleId: string): Promise<{ status: string }>;
  
  getInvitations(userId: string | null): Promise<{ invitations: any[] }>;
  createInvitation(projectId: string, userId: string | null, body: any): Promise<{ status: string; token: string; invitation_url: string }>;
  acceptInvitation(userId: string | null, body: any): Promise<{ status: string; project_id: string }>;
  declineInvitation(userId: string | null, body: any): Promise<{ status: string }>;
}

export class RbacService implements IRbacService {
  constructor(private env: Env, private rbacRepo: IRbacRepository) {}

  private async assertNotGuest(userId: string | null): Promise<void> {
    if (!userId) return;
    const isGuest = await this.rbacRepo.isGuestUser(userId);
    if (isGuest) {
      throw new Error('Forbidden: Guest accounts cannot modify members or roles.|403');
    }
  }

  getPermissions() {
    return { permissions: PERMISSIONS };
  }

  async getRoles(projectId: string) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    const customRoles = await this.rbacRepo.getCustomRoles(projectId);

    let allCustomPermissions: { role_id: string; permission_key: string }[] = [];
    let allInheritance: { parent_role_id: string; child_role_id: string }[] = [];

    if (customRoles.length > 0) {
      const customRoleIds = customRoles.map(r => r.id);
      allCustomPermissions = await this.rbacRepo.getCustomRolePermissions(customRoleIds);
      allInheritance = await this.rbacRepo.getCustomRoleInheritance(customRoleIds);
    }

    const custom = customRoles.map(r => ({
      id: r.id,
      name: r.name,
      is_default: false,
      permissions: allCustomPermissions.filter(p => p.role_id === r.id).map(p => p.permission_key),
      included_roles: allInheritance.filter(i => i.parent_role_id === r.id).map(i => i.child_role_id)
    }));

    const defaults = Object.keys(DEFAULT_ROLES).map(id => ({
      id,
      name: DEFAULT_ROLES[id].name,
      is_default: true,
      permissions: DEFAULT_ROLES[id].permissions,
      included_roles: []
    }));

    return { roles: [...defaults, ...custom] };
  }

  async createCustomRole(projectId: string, userId: string | null, body: any) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    await this.assertNotGuest(userId);

    const roleId = 'c_' + ulid();
    const permissions: string[] = body.permissions || [];
    const includedRoles: string[] = body.included_roles || [];

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      throw new Error('Role name is required and must be a non-empty string|400');
    }
    const roleName = body.name.trim();

    // Validate permission keys
    const validKeys = Object.keys(PERMISSIONS);
    const invalidPerms = permissions.filter(p => !validKeys.includes(p));
    if (invalidPerms.length > 0) {
      throw new Error(`Unknown permission keys: ${invalidPerms.join(', ')}|400`);
    }

    // Validate included roles
    if (includedRoles.length > 0) {
      const defaultRoleIds = Object.keys(DEFAULT_ROLES);
      const customCandidates = includedRoles.filter(id => !defaultRoleIds.includes(id));
      if (customCandidates.length > 0) {
        const foundIds = await this.rbacRepo.checkCustomRolesExist(projectId, customCandidates);
        const missing = customCandidates.filter(id => !foundIds.includes(id));
        if (missing.length > 0) {
          throw new Error(`Unknown role IDs: ${missing.join(', ')}|400`);
        }
      }
      if (includedRoles.includes(roleId)) {
        throw new Error('A role cannot include itself|400');
      }
    }

    const nameExists = await this.rbacRepo.checkRoleNameExists(projectId, roleName);
    if (nameExists) {
      throw new Error('A role with this name already exists|400');
    }

    await this.rbacRepo.createCustomRole(roleId, projectId, roleName, permissions, includedRoles);
    await this.rbacRepo.invalidateProjectRBAC(projectId);

    return { status: 'created', id: roleId };
  }

  async getMembers(projectId: string) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    const results = await this.rbacRepo.getProjectMembers(projectId);

    const usersMap = new Map();
    results.forEach(r => {
      if (!usersMap.has(r.id)) {
        usersMap.set(r.id, {
          id: r.id,
          username: r.username,
          email: r.email,
          two_factor_enabled: r.two_factor_enabled === 1,
          auth_method: r.github_id ? 'github' : r.gitlab_id ? 'gitlab' : 'password',
          roles: []
        });
      }
      usersMap.get(r.id).roles.push(r.role_id);
    });

    const invites = await this.rbacRepo.getPendingInvitations(projectId);
    const pendingMembers = invites.map(inv => ({
      id: inv.id,
      username: inv.username || '',
      email: inv.email || '',
      roles: JSON.parse(inv.target_role_ids),
      is_pending: true
    }));

    return {
      members: [
        ...Array.from(usersMap.values()).map(m => ({ ...m, is_pending: false })),
        ...pendingMembers
      ]
    };
  }

  async updateMemberRoles(projectId: string, userId: string | null, memberId: string, body: any) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    if (!memberId || typeof memberId !== 'string' || memberId.trim() === '') throw new Error('Invalid member ID|400');
    await this.assertNotGuest(userId);

    if (memberId === userId) {
      throw new Error('You cannot modify your own roles|400');
    }

    if (!body.roles || !Array.isArray(body.roles) || body.roles.length === 0) {
      throw new Error('At least one role must be specified|400');
    }

    // Validate roles exist
    const defaultRoles = ['owner', 'editor', 'viewer', 'runner'];
    const customRoles = body.roles.filter((r: string) => !defaultRoles.includes(r));
    if (customRoles.length > 0) {
      const foundIds = await this.rbacRepo.checkCustomRolesExist(projectId, customRoles);
      const missing = customRoles.filter((r: string) => !foundIds.includes(r));
      if (missing.length > 0) {
        throw new Error(`Invalid role(s): ${missing.join(', ')}|400`);
      }
    }

    // Check if invitation
    const isInvite = await this.rbacRepo.checkInvitationExists(memberId, projectId);
    if (isInvite) {
      await this.rbacRepo.updateInvitationRoles(memberId, body.roles);
      return { status: 'updated' };
    }

    // Update active member roles
    const currentRoles = await this.rbacRepo.getMemberRoles(projectId, memberId);
    const hasOwner = currentRoles.includes('owner');

    if (hasOwner && !body.roles.includes('owner')) {
      const count = await this.rbacRepo.getProjectOwnersCount(projectId);
      if (count <= 1) {
        throw new Error('Cannot remove the owner role from the last owner|400');
      }
    }

    await this.rbacRepo.updateMemberRoles(projectId, memberId, body.roles);
    await this.rbacRepo.invalidateUserRBAC(projectId, memberId);

    return { status: 'updated' };
  }

  async removeMember(projectId: string, userId: string | null, memberId: string) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    if (!memberId || typeof memberId !== 'string' || memberId.trim() === '') throw new Error('Invalid member ID|400');
    await this.assertNotGuest(userId);

    if (memberId === userId) {
      throw new Error('You cannot remove yourself from the project|400');
    }

    const isInvite = await this.rbacRepo.checkInvitationExists(memberId, projectId);
    if (isInvite) {
      await this.rbacRepo.revokeInvitation(memberId);
      return { status: 'revoked' };
    }

    const currentRoles = await this.rbacRepo.getMemberRoles(projectId, memberId);
    const hasOwner = currentRoles.includes('owner');

    if (hasOwner) {
      const count = await this.rbacRepo.getProjectOwnersCount(projectId);
      if (count <= 1) {
        throw new Error('Cannot remove the last owner of the project|400');
      }
    }

    await this.rbacRepo.removeProjectMember(projectId, memberId);
    await this.rbacRepo.invalidateUserRBAC(projectId, memberId);

    return { status: 'removed' };
  }

  async updateCustomRole(projectId: string, userId: string | null, roleId: string, body: any) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    if (!roleId || typeof roleId !== 'string' || roleId.trim() === '') throw new Error('Invalid role ID|400');
    await this.assertNotGuest(userId);

    if (roleId.startsWith('owner') || roleId.startsWith('editor') || roleId.startsWith('viewer')) {
      throw new Error('Default roles cannot be edited|400');
    }

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      throw new Error('Role name is required and must be a non-empty string|400');
    }
    const roleName = body.name.trim();

    const nameExists = await this.rbacRepo.checkRoleNameExists(projectId, roleName, roleId);
    if (nameExists) {
      throw new Error('A role with this name already exists|400');
    }

    const permissions: string[] = body.permissions || [];
    const includedRoles: string[] = body.included_roles || [];

    const validKeys = Object.keys(PERMISSIONS);
    const invalidPerms = permissions.filter(p => !validKeys.includes(p));
    if (invalidPerms.length > 0) {
      throw new Error(`Unknown permission keys: ${invalidPerms.join(', ')}|400`);
    }

    if (includedRoles.length > 0) {
      const defaultRoleIds = Object.keys(DEFAULT_ROLES);
      const customCandidates = includedRoles.filter(id => !defaultRoleIds.includes(id));
      if (customCandidates.length > 0) {
        const foundIds = await this.rbacRepo.checkCustomRolesExist(projectId, customCandidates);
        const missing = customCandidates.filter(id => !foundIds.includes(id));
        if (missing.length > 0) {
          throw new Error(`Unknown role IDs: ${missing.join(', ')}|400`);
        }
      }
      if (includedRoles.includes(roleId)) {
        throw new Error('A role cannot include itself|400');
      }
    }

    await this.rbacRepo.updateCustomRole(roleId, roleName, permissions, includedRoles);
    await this.rbacRepo.invalidateProjectRBAC(projectId);

    return { status: 'updated' };
  }

  async deleteCustomRole(projectId: string, userId: string | null, roleId: string) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    if (!roleId || typeof roleId !== 'string' || roleId.trim() === '') throw new Error('Invalid role ID|400');
    await this.assertNotGuest(userId);

    if (roleId.startsWith('owner') || roleId.startsWith('editor') || roleId.startsWith('viewer')) {
      throw new Error('Default roles cannot be deleted|400');
    }

    await this.rbacRepo.deleteCustomRole(roleId);
    await this.rbacRepo.invalidateProjectRBAC(projectId);

    return { status: 'deleted' };
  }

  async getInvitations(userId: string | null) {
    if (!userId) throw new Error('Unauthorized|401');

    const user = await this.rbacRepo.getUserDetails(userId);
    if (!user) throw new Error('User not found|404');

    const invitations = await this.rbacRepo.getUserInvitations(user.email, user.username);
    return { invitations };
  }

  async createInvitation(projectId: string, userId: string | null, body: any) {
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') throw new Error('Invalid project ID|400');
    await this.assertNotGuest(userId);

    if ((!body.email || typeof body.email !== 'string' || body.email.trim() === '') &&
        (!body.username || typeof body.username !== 'string' || body.username.trim() === '')) {
      throw new Error('Either email or username must be specified|400');
    }

    if (!body.roles || !Array.isArray(body.roles) || body.roles.length === 0) {
      throw new Error('At least one role must be specified|400');
    }

    // Validate roles exist
    const defaultRoles = ['owner', 'editor', 'viewer', 'runner'];
    const customRoles = body.roles.filter((r: string) => !defaultRoles.includes(r));
    if (customRoles.length > 0) {
      const foundIds = await this.rbacRepo.checkCustomRolesExist(projectId, customRoles);
      const missing = customRoles.filter((r: string) => !foundIds.includes(r));
      if (missing.length > 0) {
        throw new Error(`Invalid role(s): ${missing.join(', ')}|400`);
      }
    }

    const id = ulid();
    const token = ulid() + ulid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await this.rbacRepo.createInvitation(id, projectId, body.email || null, body.username || null, body.roles, token, expiresAt);

    return { status: 'created', token, invitation_url: '/accept-invite?token=' + token };
  }

  async acceptInvitation(userId: string | null, body: any) {
    if (!body || typeof body.token !== 'string') throw new TypeError('body.token must be a string');
    if (body.token.trim() === '') throw new Error('Invalid invitation token|400');
    if (!userId) throw new Error('Unauthorized|401');

    const user = await this.rbacRepo.getUserDetails(userId);
    if (!user) throw new Error('User not found|404');

    const inv = await this.rbacRepo.acceptInvitation(body.token, user.username, user.email, userId);

    if (!inv) {
      const existing = await this.rbacRepo.getInvitationByToken(body.token);
      if (existing) {
        if (existing.username && existing.username !== user.username) {
          throw new Error('Invitation is for a different username|403');
        }
        if (existing.email && existing.email !== user.email) {
          throw new Error('Invitation is for a different email|403');
        }
      }
      throw new Error('Invalid or expired invitation|400');
    }

    await this.rbacRepo.invalidateUserRBAC(inv.project_id, userId);

    return { status: 'accepted', project_id: inv.project_id };
  }

  async declineInvitation(userId: string | null, body: any) {
    if (!body || typeof body.token !== 'string') throw new TypeError('body.token must be a string');
    if (body.token.trim() === '') throw new Error('Invalid invitation token|400');
    if (!userId) throw new Error('Unauthorized|401');

    const user = await this.rbacRepo.getUserDetails(userId);
    if (!user) throw new Error('User not found|404');

    const success = await this.rbacRepo.declineInvitation(body.token, user.username, user.email);
    if (!success) {
      throw new Error('Invalid or expired invitation|400');
    }

    return { status: 'declined' };
  }
}
