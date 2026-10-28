// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { BaseService } from './base';
import { isValidId } from '../utils/validation';

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
  
  updateCustomRole(projectId: string, roleId: string, name: string, permissions: string[], includedRoles: string[]): Promise<boolean>;
  deleteCustomRole(projectId: string, roleId: string): Promise<boolean>;
  getRoleHolders(projectId: string, roleId: string): Promise<string[]>;
  getInvitationRoles(id: string, projectId: string): Promise<string[]>;
  
  getUserDetails(userId: string): Promise<{ email: string; username: string; email_verified?: number | null } | null>;
  getUserInvitations(email: string | null, username: string, emailVerified: boolean): Promise<any[]>;
  getInvitationByToken(token: string): Promise<{ username: string | null; email: string | null } | null>;
  createInvitation(id: string, projectId: string, email: string | null, username: string | null, roles: string[], token: string, expiresAt: string): Promise<void>;
  acceptInvitation(token: string, username: string, email: string | null, emailVerified: boolean, userId: string): Promise<any | null>;
  declineInvitation(token: string, username: string, email: string | null, emailVerified: boolean): Promise<boolean>;
  getProjectSessionTimeout(projectId: string): Promise<number | null>;
  getProjectName(projectId: string): Promise<string | null>;

  invalidateProjectRBAC(projectId: string): Promise<void>;
  invalidateUserRBAC(projectId: string, userId: string): Promise<void>;
  checkPermission(userId: string, projectId: string, requiredPermission: string): Promise<boolean>;
  getEffectivePermissions(userId: string, projectId: string): Promise<string[]>;
  resolveRolePermissions(projectId: string, roleIds: string[]): Promise<string[]>;
  isProjectMember(projectId: string, userId: string): Promise<boolean>;
}

import { DEFAULT_ROLES, isBuiltInRole } from '../config/rbac';

// Bump the version whenever the way permissions are computed changes: entries cached under the
// old rules (for 24h) would otherwise keep granting what the new rules no longer do. v2 dropped
// the legacy project_members.role source and scoped custom roles to their project.
const RBAC_CACHE_VERSION = 'v2';
export const rbacCacheKey = (projectId: string, userId: string) => `rbac:${RBAC_CACHE_VERSION}:${projectId}:${userId}`;

export class RbacRepository extends BaseService implements IRbacRepository {
  constructor(env: Env) {
    super(env);
  }

  async getProjectSessionTimeout(projectId: string): Promise<number | null> {
    if (!isValidId(projectId)) {
      return null;
    }
    const project = await this.db.prepare(
      'SELECT member_session_timeout FROM projects WHERE id = ?'
    ).bind(projectId).first<{ member_session_timeout: number | null }>();
    return project?.member_session_timeout ?? null;
  }

  async invalidateProjectRBAC(projectId: string): Promise<void> {
    if (!isValidId(projectId) || !this.env.SESSION_CACHE) return;
    
    // Get all members of the project to invalidate their cache keys directly
    const { results } = await this.db.prepare(`
      SELECT DISTINCT user_id FROM (
        SELECT user_id FROM project_member_roles WHERE project_id = ?
        UNION
        SELECT user_id FROM project_members WHERE project_id = ?
      )
    `).bind(projectId, projectId).all<{ user_id: string }>();

    if (results && results.length > 0) {
      await Promise.all(results.map(r => this.env.SESSION_CACHE!.delete(rbacCacheKey(projectId, r.user_id))));
    }
  }

  async invalidateUserRBAC(projectId: string, userId: string): Promise<void> {
    if (!isValidId(projectId) || !isValidId(userId) || !this.env.SESSION_CACHE) return;
    await this.env.SESSION_CACHE.delete(rbacCacheKey(projectId, userId));
  }

  async checkPermission(
    userId: string,
    projectId: string,
    requiredPermission: string
  ): Promise<boolean> {
    if (!isValidId(projectId) || !isValidId(userId)) {
      return false;
    }
    const permissions = await this.getEffectivePermissions(userId, projectId);
    return permissions.includes(requiredPermission);
  }

  async getEffectivePermissions(userId: string, projectId: string): Promise<string[]> {
    if (!isValidId(projectId) || !isValidId(userId)) {
      return [];
    }
    const cacheKey = rbacCacheKey(projectId, userId);
    
    if (this.env.SESSION_CACHE) {
      const cached = await this.env.SESSION_CACHE.get<{permissions: string[]}>(cacheKey, 'json');
      if (cached) {
        return cached.permissions;
      }
    }

    // Use a recursive CTE to get all role IDs for the user, including inherited ones up to depth 3.
    // project_member_roles is the only role source: the legacy project_members.role column is not
    // rewritten on every role change, so reading it would keep revoked privileges alive.
    const { results: roleResults } = await this.db.prepare(`
      WITH RECURSIVE
        user_roles AS (
          SELECT role_id FROM project_member_roles WHERE project_id = ?1 AND user_id = ?2
        ),
        role_hierarchy(role_id, depth) AS (
          SELECT role_id, 0 as depth FROM user_roles
          UNION ALL
          SELECT cri.child_role_id, rh.depth + 1
          FROM role_hierarchy rh
          JOIN custom_role_inheritance cri ON rh.role_id = cri.parent_role_id
          JOIN project_custom_roles pcr ON pcr.id = cri.parent_role_id AND pcr.project_id = ?1
          WHERE rh.depth < 3
        )
      SELECT DISTINCT role_id FROM role_hierarchy;
    `).bind(projectId, userId).all<{ role_id: string }>();

    if (!roleResults || roleResults.length === 0) {
      return [];
    }

    const permsArray = await this.permissionsForRoleIds(projectId, roleResults.map(r => r.role_id));
    // Cache for 24 hours. Will be actively invalidated on role/member changes.
    if (this.env.SESSION_CACHE) {
      await this.env.SESSION_CACHE.put(cacheKey, JSON.stringify({ permissions: permsArray }), { expirationTtl: 86400 });
    }

    return permsArray;
  }

  /** Every permission the given roles carry in this project, following custom-role inheritance. */
  async resolveRolePermissions(projectId: string, roleIds: string[]): Promise<string[]> {
    if (!isValidId(projectId) || roleIds.length === 0) {
      return [];
    }
    const { results } = await this.db.prepare(`
      WITH RECURSIVE
        role_hierarchy(role_id, depth) AS (
          SELECT value, 0 as depth FROM json_each(?2)
          UNION ALL
          SELECT cri.child_role_id, rh.depth + 1
          FROM role_hierarchy rh
          JOIN custom_role_inheritance cri ON rh.role_id = cri.parent_role_id
          JOIN project_custom_roles pcr ON pcr.id = cri.parent_role_id AND pcr.project_id = ?1
          WHERE rh.depth < 3
        )
      SELECT DISTINCT role_id FROM role_hierarchy;
    `).bind(projectId, JSON.stringify(roleIds)).all<{ role_id: string }>();

    return this.permissionsForRoleIds(projectId, (results || []).map(r => r.role_id));
  }

  async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    const row = await this.db.prepare(
      'SELECT 1 FROM project_member_roles WHERE project_id = ? AND user_id = ? LIMIT 1'
    ).bind(projectId, userId).first();
    return !!row;
  }

  private async permissionsForRoleIds(projectId: string, roleIds: string[]): Promise<string[]> {
    const permissions = new Set<string>();

    // 1. Resolve default roles in memory
    for (const rid of roleIds) {
      if (DEFAULT_ROLES[rid]) {
        DEFAULT_ROLES[rid].permissions.forEach((p: string) => permissions.add(p));
      }
    }

    // 2. Resolve custom roles in DB only if there are custom role IDs
    const customRoleIds = roleIds.filter(rid => !isBuiltInRole(rid));

    if (customRoleIds.length > 0) {
      const placeholders = customRoleIds.map(() => '?').join(',');
      // Only roles owned by this project grant permissions here, so a role row of another
      // project can never widen access even if it was assigned or inherited by mistake.
      const query = `SELECT crp.permission_key FROM custom_role_permissions crp
        JOIN project_custom_roles pcr ON pcr.id = crp.role_id
        WHERE pcr.project_id = ? AND crp.role_id IN (${placeholders})`;
      const { results: permResults } = await this.db.prepare(query).bind(projectId, ...customRoleIds).all<{ permission_key: string }>();
      
      if (permResults) {
        permResults.forEach(r => permissions.add(r.permission_key));
      }
    }

    return Array.from(permissions);
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
      SELECT COUNT(DISTINCT user_id) as count FROM project_member_roles WHERE project_id = ? AND role_id = 'owner'
    `).bind(projectId).first<{ count: number }>();
    return ownersCount ? ownersCount.count : 0;
  }

  async updateMemberRoles(projectId: string, userId: string, roles: string[]): Promise<void> {
    const stmts = [
      this.db.prepare('DELETE FROM project_member_roles WHERE project_id = ? AND user_id = ?').bind(projectId, userId)
    ];

    roles.forEach((r: string) => {
      stmts.push(this.db.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)').bind(projectId, userId, r));
    });

    // Keep the legacy single-role column (still read for audit logs) in step with the real roles.
    const legacyRole = roles.includes('owner') ? 'owner' : roles.includes('editor') ? 'editor' : 'viewer';
    stmts.push(this.db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').bind(legacyRole, projectId, userId));

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
    projectId: string,
    roleId: string,
    name: string,
    permissions: string[],
    includedRoles: string[]
  ): Promise<boolean> {
    // Every statement re-checks that the role belongs to the project inside the same batch, so
    // nothing is written through a role of another project, or one deleted meanwhile.
    const owned = 'EXISTS (SELECT 1 FROM project_custom_roles WHERE id = ? AND project_id = ?)';
    const stmts = [
      this.db.prepare('UPDATE project_custom_roles SET name = ? WHERE id = ? AND project_id = ?').bind(name, roleId, projectId),
      this.db.prepare(`DELETE FROM custom_role_permissions WHERE role_id = ? AND ${owned}`).bind(roleId, roleId, projectId),
      this.db.prepare(`DELETE FROM custom_role_inheritance WHERE parent_role_id = ? AND ${owned}`).bind(roleId, roleId, projectId)
    ];

    permissions.forEach(p => stmts.push(this.db.prepare(`INSERT INTO custom_role_permissions (role_id, permission_key) SELECT ?, ? WHERE ${owned}`).bind(roleId, p, roleId, projectId)));
    includedRoles.forEach(child => stmts.push(this.db.prepare(`INSERT INTO custom_role_inheritance (parent_role_id, child_role_id) SELECT ?, ? WHERE ${owned}`).bind(roleId, child, roleId, projectId)));

    const results = await this.db.batch(stmts);
    return ((results?.[0] as any)?.meta?.changes ?? 0) > 0;
  }

  async deleteCustomRole(projectId: string, roleId: string): Promise<boolean> {
    // Dependent rows go first, each guarded by the role still belonging to the project; the role
    // row itself goes last, and its change count says whether anything was deleted.
    const owned = 'EXISTS (SELECT 1 FROM project_custom_roles WHERE id = ? AND project_id = ?)';
    const results = await this.db.batch([
      this.db.prepare(`DELETE FROM custom_role_permissions WHERE role_id = ? AND ${owned}`).bind(roleId, roleId, projectId),
      this.db.prepare(`DELETE FROM custom_role_inheritance WHERE (parent_role_id = ? OR child_role_id = ?) AND ${owned}`).bind(roleId, roleId, roleId, projectId),
      this.db.prepare('DELETE FROM project_member_roles WHERE role_id = ? AND project_id = ?').bind(roleId, projectId),
      this.db.prepare('DELETE FROM project_custom_roles WHERE id = ? AND project_id = ?').bind(roleId, projectId)
    ]);
    return ((results?.[3] as any)?.meta?.changes ?? 0) > 0;
  }

  async getRoleHolders(projectId: string, roleId: string): Promise<string[]> {
    const { results } = await this.db.prepare(
      'SELECT DISTINCT user_id FROM project_member_roles WHERE project_id = ? AND role_id = ?'
    ).bind(projectId, roleId).all<{ user_id: string }>();
    return (results || []).map(r => r.user_id);
  }

  async getInvitationRoles(id: string, projectId: string): Promise<string[]> {
    const row = await this.db.prepare(
      'SELECT target_role_ids FROM project_invitations WHERE id = ? AND project_id = ?'
    ).bind(id, projectId).first<{ target_role_ids: string }>();
    if (!row) return [];
    try {
      const roles = JSON.parse(row.target_role_ids);
      return Array.isArray(roles) ? roles.filter((r: unknown): r is string => typeof r === 'string') : [];
    } catch {
      return [];
    }
  }

  async getUserDetails(userId: string): Promise<{ email: string; username: string; email_verified?: number | null } | null> {
    const user = await this.db.prepare('SELECT email, username, email_verified FROM users WHERE id = ?').bind(userId)
      .first<{ email: string; username: string; email_verified: number | null }>();
    return user || null;
  }

  // An email address only identifies a user once they have proven they own it: anyone can
  // register, or have an account provisioned, with an arbitrary unverified address.
  async getUserInvitations(email: string | null, username: string, emailVerified: boolean): Promise<any[]> {
    const { results } = await this.db.prepare(`
      SELECT i.id, i.token, i.project_id, p.name as project_name, i.expires_at 
      FROM project_invitations i
      JOIN projects p ON i.project_id = p.id
      WHERE i.status = 'Pending' 
        AND strftime('%s', i.expires_at) > strftime('%s', 'now')
        AND (
          (i.email IS NOT NULL AND ?3 = 1 AND lower(i.email) = lower(?1))
          OR (i.username IS NOT NULL AND i.username = ?2)
        )
    `).bind(email, username, emailVerified ? 1 : 0).all();
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

  async acceptInvitation(token: string, username: string, email: string | null, emailVerified: boolean, userId: string): Promise<any | null> {
    const inv = await this.db.prepare(`
      UPDATE project_invitations 
      SET status = 'Accepted' 
      WHERE token = ?1 
        AND status = 'Pending' 
        AND strftime('%s', expires_at) > strftime('%s', 'now')
        AND (username IS NULL OR username = ?2)
        AND (email IS NULL OR (?4 = 1 AND lower(email) = lower(?3)))
      RETURNING *
    `).bind(token, username, email, emailVerified ? 1 : 0).first<any>();

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

  async declineInvitation(token: string, username: string, email: string | null, emailVerified: boolean): Promise<boolean> {
    const res = await this.db.prepare(`
      UPDATE project_invitations 
      SET status = 'Revoked' 
      WHERE token = ?1 
        AND status = 'Pending' 
        AND (username IS NULL OR username = ?2)
        AND (email IS NULL OR (?4 = 1 AND lower(email) = lower(?3)))
    `).bind(token, username, email, emailVerified ? 1 : 0).run();
    return res.meta.changes > 0;
  }

  async getProjectName(projectId: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first<{ name: string }>();
    return row?.name || null;
  }
}
