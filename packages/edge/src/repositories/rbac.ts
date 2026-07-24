import { Env } from '../env';
import { BaseService } from './base';

export interface IRbacRepository {
  isGuestUser(userId: string): Promise<boolean>;
  getCustomRoles(projectId: string): Promise<any[]>;
  getCustomRolePermissions(roleIds: string[]): Promise<any[]>;
  getCustomRoleInheritance(roleIds: string[]): Promise<any[]>;
  checkCustomRolesExist(projectId: string, roleIds: string[]): Promise<string[]>;
  checkRoleNameExists(projectId: string, name: string, excludeRoleId?: string): Promise<boolean>;
  createCustomRole(roleId: string, projectId: string, name: string, permissions: string[], includedRoles: string[]): Promise<void>;
  
  getProjectMembers(projectId: string): Promise<any[]>;
  getPendingInvitations(projectId: string): Promise<any[]>;
  checkInvitationExists(id: string, projectId: string): Promise<boolean>;
  updateInvitationRoles(id: string, roles: string[]): Promise<void>;
  
  getMemberRoles(projectId: string, userId: string): Promise<string[]>;
  getProjectOwnersCount(projectId: string): Promise<number>;
  updateMemberRoles(projectId: string, userId: string, roles: string[]): Promise<void>;
  
  revokeInvitation(id: string): Promise<void>;
  removeProjectMember(projectId: string, userId: string): Promise<void>;
  
  updateCustomRole(roleId: string, name: string, permissions: string[], includedRoles: string[]): Promise<void>;
  deleteCustomRole(roleId: string): Promise<void>;
  
  getUserDetails(userId: string): Promise<{ email: string; username: string } | null>;
  getUserInvitations(email: string, username: string): Promise<any[]>;
  getInvitationByToken(token: string): Promise<{ username: string | null; email: string | null } | null>;
  createInvitation(id: string, projectId: string, email: string | null, username: string | null, roles: string[], token: string, expiresAt: string): Promise<void>;
  acceptInvitation(token: string, username: string, email: string, userId: string): Promise<any | null>;
  declineInvitation(token: string, username: string, email: string): Promise<boolean>;
  getProjectSessionTimeout(projectId: string): Promise<number | null>;

  invalidateProjectRBAC(projectId: string): Promise<void>;
  invalidateUserRBAC(projectId: string, userId: string): Promise<void>;
  checkPermission(userId: string, projectId: string, requiredPermission: string): Promise<boolean>;
}

import { DEFAULT_ROLES } from '../config/rbac';

export class RbacRepository extends BaseService implements IRbacRepository {
  constructor(env: Env) {
    super(env);
  }

  async getProjectSessionTimeout(projectId: string): Promise<number | null> {
    const project = await this.db.prepare(
      'SELECT member_session_timeout FROM projects WHERE id = ?'
    ).bind(projectId).first<{ member_session_timeout: number | null }>();
    return project?.member_session_timeout ?? null;
  }

  async invalidateProjectRBAC(projectId: string): Promise<void> {
    if (!this.env.SESSION_CACHE) return;
    
    // Get all members of the project to invalidate their cache keys directly
    const { results } = await this.db.prepare(`
      SELECT DISTINCT user_id FROM (
        SELECT user_id FROM project_member_roles WHERE project_id = ?
        UNION
        SELECT user_id FROM project_members WHERE project_id = ?
      )
    `).bind(projectId, projectId).all<{ user_id: string }>();

    if (results && results.length > 0) {
      await Promise.all(results.map(r => this.env.SESSION_CACHE!.delete(`rbac:${projectId}:${r.user_id}`)));
    }
  }

  async invalidateUserRBAC(projectId: string, userId: string): Promise<void> {
    if (this.env.SESSION_CACHE) {
      await this.env.SESSION_CACHE.delete(`rbac:${projectId}:${userId}`);
    }
  }

  async checkPermission(
    userId: string,
    projectId: string,
    requiredPermission: string
  ): Promise<boolean> {
    const cacheKey = `rbac:${projectId}:${userId}`;
    
    if (this.env.SESSION_CACHE) {
      const cached = await this.env.SESSION_CACHE.get<{permissions: string[]}>(cacheKey, 'json');
      if (cached) {
        return cached.permissions.includes(requiredPermission);
      }
    }

    // Use a recursive CTE to get all role IDs for the user, including inherited ones up to depth 3
    const { results: roleResults } = await this.db.prepare(`
      WITH RECURSIVE
        user_roles AS (
          SELECT role_id FROM project_member_roles WHERE project_id = ?1 AND user_id = ?2
          UNION
          SELECT role as role_id FROM project_members WHERE project_id = ?1 AND user_id = ?2
        ),
        role_hierarchy(role_id, depth) AS (
          SELECT role_id, 0 as depth FROM user_roles
          UNION ALL
          SELECT cri.child_role_id, rh.depth + 1
          FROM role_hierarchy rh
          JOIN custom_role_inheritance cri ON rh.role_id = cri.parent_role_id
          WHERE rh.depth < 3
        )
      SELECT DISTINCT role_id FROM role_hierarchy;
    `).bind(projectId, userId).all<{ role_id: string }>();

    if (!roleResults || roleResults.length === 0) {
      if (this.env.SESSION_CACHE) {
        await this.env.SESSION_CACHE.put(cacheKey, JSON.stringify({ permissions: [] }), { expirationTtl: 300 });
      }
      return false;
    }

    const roleIds = roleResults.map(r => r.role_id);
    const permissions = new Set<string>();

    // 1. Resolve default roles in memory
    for (const rid of roleIds) {
      if (DEFAULT_ROLES[rid]) {
        DEFAULT_ROLES[rid].permissions.forEach((p: string) => permissions.add(p));
      }
    }

    // 2. Resolve custom roles in DB only if there are custom role IDs
    const defaultRoles = ['owner', 'editor', 'viewer', 'runner'];
    const customRoleIds = roleIds.filter(rid => !defaultRoles.includes(rid));

    if (customRoleIds.length > 0) {
      const placeholders = customRoleIds.map(() => '?').join(',');
      const query = `SELECT permission_key FROM custom_role_permissions WHERE role_id IN (${placeholders})`;
      const { results: permResults } = await this.db.prepare(query).bind(...customRoleIds).all<{ permission_key: string }>();
      
      if (permResults) {
        permResults.forEach(r => permissions.add(r.permission_key));
      }
    }

    const permsArray = Array.from(permissions);
    // Cache for 24 hours. Will be actively invalidated on role/member changes.
    if (this.env.SESSION_CACHE) {
      await this.env.SESSION_CACHE.put(cacheKey, JSON.stringify({ permissions: permsArray }), { expirationTtl: 86400 });
    }

    return permissions.has(requiredPermission);
  }

  async isGuestUser(userId: string): Promise<boolean> {
    const user = await this.db.prepare('SELECT is_guest FROM users WHERE id = ?')
      .bind(userId)
      .first<{ is_guest: number | null }>();
    return user ? user.is_guest === 1 : false;
  }

  async getCustomRoles(projectId: string): Promise<any[]> {
    const { results } = await this.db.prepare(
      'SELECT id, name, created_at FROM project_custom_roles WHERE project_id = ?'
    ).bind(projectId).all();
    return results || [];
  }

  async getCustomRolePermissions(roleIds: string[]): Promise<any[]> {
    if (roleIds.length === 0) return [];
    const placeholders = roleIds.map(() => '?').join(',');
    const { results } = await this.db.prepare(
      `SELECT role_id, permission_key FROM custom_role_permissions WHERE role_id IN (${placeholders})`
    ).bind(...roleIds).all();
    return results || [];
  }

  async getCustomRoleInheritance(roleIds: string[]): Promise<any[]> {
    if (roleIds.length === 0) return [];
    const placeholders = roleIds.map(() => '?').join(',');
    const { results } = await this.db.prepare(
      `SELECT parent_role_id, child_role_id FROM custom_role_inheritance WHERE parent_role_id IN (${placeholders})`
    ).bind(...roleIds).all();
    return results || [];
  }

  async checkCustomRolesExist(projectId: string, roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const placeholders = roleIds.map(() => '?').join(',');
    const { results } = await this.db.prepare(
      `SELECT id FROM project_custom_roles WHERE project_id = ? AND id IN (${placeholders})`
    ).bind(projectId, ...roleIds).all<{ id: string }>();
    return (results || []).map(r => r.id);
  }

  async checkRoleNameExists(projectId: string, name: string, excludeRoleId?: string): Promise<boolean> {
    if (excludeRoleId) {
      const existing = await this.db.prepare(
        'SELECT 1 FROM project_custom_roles WHERE project_id = ? AND name = ? AND id != ?'
      ).bind(projectId, name, excludeRoleId).first();
      return !!existing;
    }
    const existing = await this.db.prepare(
      'SELECT 1 FROM project_custom_roles WHERE project_id = ? AND name = ?'
    ).bind(projectId, name).first();
    return !!existing;
  }

  async createCustomRole(
    roleId: string,
    projectId: string,
    name: string,
    permissions: string[],
    includedRoles: string[]
  ): Promise<void> {
    const stmts = [
      this.db.prepare('INSERT INTO project_custom_roles (id, project_id, name) VALUES (?, ?, ?)').bind(roleId, projectId, name)
    ];

    permissions.forEach((perm: string) => {
      stmts.push(this.db.prepare('INSERT INTO custom_role_permissions (role_id, permission_key) VALUES (?, ?)').bind(roleId, perm));
    });

    includedRoles.forEach((childId: string) => {
      stmts.push(this.db.prepare('INSERT INTO custom_role_inheritance (parent_role_id, child_role_id) VALUES (?, ?)').bind(roleId, childId));
    });

    await this.db.batch(stmts);
  }

  async getProjectMembers(projectId: string): Promise<any[]> {
    const { results } = await this.db.prepare(`
      SELECT u.id, u.username, u.email, u.two_factor_enabled, u.github_id, u.gitlab_id, m.role_id 
      FROM project_member_roles m 
      JOIN users u ON m.user_id = u.id 
      WHERE m.project_id = ?
    `).bind(projectId).all();
    return results || [];
  }

  async getPendingInvitations(projectId: string): Promise<any[]> {
    const { results } = await this.db.prepare(`
      SELECT id, email, username, target_role_ids, expires_at 
      FROM project_invitations 
      WHERE project_id = ? AND status = 'Pending' AND strftime('%s', expires_at) > strftime('%s', 'now')
    `).bind(projectId).all();
    return results || [];
  }

  async checkInvitationExists(id: string, projectId: string): Promise<boolean> {
    const isInvite = await this.db.prepare(
      'SELECT 1 FROM project_invitations WHERE id = ? AND project_id = ?'
    ).bind(id, projectId).first();
    return !!isInvite;
  }

  async updateInvitationRoles(id: string, roles: string[]): Promise<void> {
    await this.db.prepare(
      'UPDATE project_invitations SET target_role_ids = ? WHERE id = ?'
    ).bind(JSON.stringify(roles), id).run();
  }

  async getMemberRoles(projectId: string, userId: string): Promise<string[]> {
    const { results } = await this.db.prepare(
      'SELECT role_id FROM project_member_roles WHERE project_id = ? AND user_id = ?'
    ).bind(projectId, userId).all<{ role_id: string }>();
    return (results || []).map(r => r.role_id);
  }

  async getProjectOwnersCount(projectId: string): Promise<number> {
    const ownersCount = await this.db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM (
        SELECT user_id FROM project_member_roles WHERE project_id = ? AND role_id = 'owner'
        UNION
        SELECT user_id FROM project_members WHERE project_id = ? AND role = 'owner'
      )
    `).bind(projectId, projectId).first<{ count: number }>();
    return ownersCount ? ownersCount.count : 0;
  }

  async updateMemberRoles(projectId: string, userId: string, roles: string[]): Promise<void> {
    const stmts = [
      this.db.prepare('DELETE FROM project_member_roles WHERE project_id = ? AND user_id = ?').bind(projectId, userId)
    ];

    roles.forEach((r: string) => {
      stmts.push(this.db.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)').bind(projectId, userId, r));
    });

    await this.db.batch(stmts);
  }

  async revokeInvitation(id: string): Promise<void> {
    await this.db.prepare("UPDATE project_invitations SET status = 'Revoked' WHERE id = ?").bind(id).run();
  }

  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM project_member_roles WHERE project_id = ? AND user_id = ?').bind(projectId, userId),
      this.db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId)
    ]);
  }

  async updateCustomRole(
    roleId: string,
    name: string,
    permissions: string[],
    includedRoles: string[]
  ): Promise<void> {
    const stmts = [
      this.db.prepare('UPDATE project_custom_roles SET name = ? WHERE id = ?').bind(name, roleId),
      this.db.prepare('DELETE FROM custom_role_permissions WHERE role_id = ?').bind(roleId),
      this.db.prepare('DELETE FROM custom_role_inheritance WHERE parent_role_id = ?').bind(roleId)
    ];

    permissions.forEach(p => stmts.push(this.db.prepare('INSERT INTO custom_role_permissions (role_id, permission_key) VALUES (?, ?)').bind(roleId, p)));
    includedRoles.forEach(child => stmts.push(this.db.prepare('INSERT INTO custom_role_inheritance (parent_role_id, child_role_id) VALUES (?, ?)').bind(roleId, child)));

    await this.db.batch(stmts);
  }

  async deleteCustomRole(roleId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM project_custom_roles WHERE id = ?').bind(roleId),
      this.db.prepare('DELETE FROM custom_role_permissions WHERE role_id = ?').bind(roleId),
      this.db.prepare('DELETE FROM custom_role_inheritance WHERE parent_role_id = ? OR child_role_id = ?').bind(roleId, roleId),
      this.db.prepare('DELETE FROM project_member_roles WHERE role_id = ?').bind(roleId)
    ]);
  }

  async getUserDetails(userId: string): Promise<{ email: string; username: string } | null> {
    const user = await this.db.prepare('SELECT email, username FROM users WHERE id = ?').bind(userId).first<{ email: string; username: string }>();
    return user || null;
  }

  async getUserInvitations(email: string, username: string): Promise<any[]> {
    const { results } = await this.db.prepare(`
      SELECT i.id, i.token, i.project_id, p.name as project_name, i.expires_at 
      FROM project_invitations i
      JOIN projects p ON i.project_id = p.id
      WHERE i.status = 'Pending' 
        AND strftime('%s', i.expires_at) > strftime('%s', 'now')
        AND (i.email = ?1 OR i.username = ?2)
    `).bind(email, username).all();
    return results || [];
  }

  async getInvitationByToken(token: string): Promise<{ username: string | null; email: string | null } | null> {
    const existing = await this.db.prepare(
      "SELECT username, email FROM project_invitations WHERE token = ? AND status = 'Pending'"
    ).bind(token).first<{ username: string | null; email: string | null }>();
    return existing || null;
  }

  async createInvitation(
    id: string,
    projectId: string,
    email: string | null,
    username: string | null,
    roles: string[],
    token: string,
    expiresAt: string
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO project_invitations (id, project_id, email, username, target_role_ids, status, token, expires_at)
      VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)
    `).bind(id, projectId, email, username, JSON.stringify(roles), token, expiresAt).run();
  }

  async acceptInvitation(token: string, username: string, email: string, userId: string): Promise<any | null> {
    const inv = await this.db.prepare(`
      UPDATE project_invitations 
      SET status = 'Accepted' 
      WHERE token = ?1 
        AND status = 'Pending' 
        AND strftime('%s', expires_at) > strftime('%s', 'now')
        AND (username IS NULL OR username = ?2)
        AND (email IS NULL OR email = ?3)
      RETURNING *
    `).bind(token, username, email).first<any>();

    if (!inv) return null;

    const roles = JSON.parse(inv.target_role_ids);
    const stmts: any[] = [];

    roles.forEach((r: string) => {
      stmts.push(this.db.prepare('INSERT OR IGNORE INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)').bind(inv.project_id, userId, r));
    });
    stmts.push(this.db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'viewer')").bind(inv.project_id, userId));

    await this.db.batch(stmts);
    return inv;
  }

  async declineInvitation(token: string, username: string, email: string): Promise<boolean> {
    const res = await this.db.prepare(`
      UPDATE project_invitations 
      SET status = 'Revoked' 
      WHERE token = ?1 
        AND status = 'Pending' 
        AND (username IS NULL OR username = ?2)
        AND (email IS NULL OR email = ?3)
    `).bind(token, username, email).run();
    return res.meta.changes > 0;
  }
}
