import { Hono } from 'hono';
import { Env } from '../env';
import { requirePermission } from '../middleware/rbac';
import { PERMISSIONS, DEFAULT_ROLES, PermissionKey } from '../config/rbac';
import { ulid } from 'ulidx';
import { getUserIdFromRequest } from '../utils/auth';
import { invalidateUserRBAC, invalidateProjectRBAC } from '../utils/rbac';

export function registerRbacRoutes(app: Hono<{ Bindings: Env }>) {
  
  app.get('/api/projects/:id/permissions', requirePermission('get:/api/projects/:id'), async (c) => {
    return c.json({ permissions: PERMISSIONS });
  });

  app.get('/api/projects/:id/roles', requirePermission('get:/api/projects/:id/roles'), async (c) => {
    const projectId = (c.req.param('id') as string);
    const { results: customRoles } = await c.env.DB.prepare(
      'SELECT id, name, created_at FROM project_custom_roles WHERE project_id = ?'
    ).bind(projectId).all();

    let allCustomPermissions: { role_id: string; permission_key: string }[] = [];
    let allInheritance: { parent_role_id: string; child_role_id: string }[] = [];
    
    if (customRoles && customRoles.length > 0) {
      const customRoleIds = customRoles.map((r: any) => r.id);
      const placeholders = customRoleIds.map(() => '?').join(',');
      allCustomPermissions = (await c.env.DB.prepare(`SELECT role_id, permission_key FROM custom_role_permissions WHERE role_id IN (${placeholders})`).bind(...customRoleIds).all<{role_id: string, permission_key: string}>()).results || [];
      allInheritance = (await c.env.DB.prepare(`SELECT parent_role_id, child_role_id FROM custom_role_inheritance WHERE parent_role_id IN (${placeholders})`).bind(...customRoleIds).all<{parent_role_id: string, child_role_id: string}>()).results || [];
    }

    const custom = customRoles?.map((r: any) => ({
      id: r.id,
      name: r.name,
      is_default: false,
      permissions: allCustomPermissions.filter(p => p.role_id === r.id).map(p => p.permission_key),
      included_roles: allInheritance.filter(i => i.parent_role_id === r.id).map(i => i.child_role_id)
    })) || [];

    const defaults = Object.keys(DEFAULT_ROLES).map(id => ({
      id,
      name: DEFAULT_ROLES[id].name,
      is_default: true,
      permissions: DEFAULT_ROLES[id].permissions,
      included_roles: []
    }));

    return c.json({ roles: [...defaults, ...custom] });
  });

  app.post('/api/projects/:id/roles', requirePermission('post:/api/projects/:id/roles'), async (c) => {
    const projectId = (c.req.param('id') as string);
    const body = await c.req.json();
    const roleId = 'c_' + ulid();

    const permissions: string[] = body.permissions || [];
    const includedRoles: string[] = body.included_roles || [];
    
    // Validate role name: required, string, non-whitespace
    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'Role name is required and must be a non-empty string' }, 400);
    }
    const roleName = body.name.trim();

    // Validate permission keys against known permissions
    const validKeys = Object.keys(PERMISSIONS);
    const invalidPerms = permissions.filter(p => !validKeys.includes(p));
    if (invalidPerms.length > 0) {
      return c.json({ error: `Unknown permission keys: ${invalidPerms.join(', ')}` }, 400);
    }

    // Validate included_roles exist (must be default roles or custom roles in this project)
    if (includedRoles.length > 0) {
      const defaultRoleIds = Object.keys(DEFAULT_ROLES);
      const customCandidates = includedRoles.filter(id => !defaultRoleIds.includes(id));
      if (customCandidates.length > 0) {
        const placeholders = customCandidates.map(() => '?').join(',');
        const { results: found } = await c.env.DB.prepare(
          `SELECT id FROM project_custom_roles WHERE project_id = ? AND id IN (${placeholders})`
        ).bind(projectId, ...customCandidates).all<{ id: string }>();
        const foundIds = new Set((found || []).map(r => r.id));
        const missing = customCandidates.filter(id => !foundIds.has(id));
        if (missing.length > 0) {
          return c.json({ error: `Unknown role IDs: ${missing.join(', ')}` }, 400);
        }
      }

      // Circular inheritance check: ensure none of the included roles
      // would transitively include the new role (which doesn't exist yet, so
      // we only need to check that included roles don't form a cycle among themselves).
      // Since the new role has no parents yet, a cycle is impossible on creation.
      // However, we still guard against self-inclusion.
      if (includedRoles.includes(roleId)) {
        return c.json({ error: 'A role cannot include itself' }, 400);
      }
    }

    const existingRole = await c.env.DB.prepare(
      'SELECT id FROM project_custom_roles WHERE project_id = ? AND name = ?'
    ).bind(projectId, roleName).first();
    if (existingRole) {
      return c.json({ error: 'A role with this name already exists' }, 400);
    }

    const stmts = [
      c.env.DB.prepare('INSERT INTO project_custom_roles (id, project_id, name) VALUES (?, ?, ?)').bind(roleId, projectId, roleName)
    ];

    permissions.forEach((perm: string) => {
      stmts.push(c.env.DB.prepare('INSERT INTO custom_role_permissions (role_id, permission_key) VALUES (?, ?)').bind(roleId, perm));
    });

    includedRoles.forEach((childId: string) => {
      stmts.push(c.env.DB.prepare('INSERT INTO custom_role_inheritance (parent_role_id, child_role_id) VALUES (?, ?)').bind(roleId, childId));
    });

    await c.env.DB.batch(stmts);
    
    // Invalidate project RBAC cache
    await invalidateProjectRBAC(c.env, projectId);

    return c.json({ status: 'created', id: roleId });
  });

  app.get('/api/projects/:id/members', requirePermission('get:/api/projects/:id/members'), async (c) => {
    const projectId = (c.req.param('id') as string);
    
    const { results } = await c.env.DB.prepare(`
      SELECT u.id, u.username, u.email, m.role_id 
      FROM project_member_roles m 
      JOIN users u ON m.user_id = u.id 
      WHERE m.project_id = ?
    `).bind(projectId).all<{ id: string; username: string; email: string; role_id: string }>();

    // Group by user
    const usersMap = new Map();
    (results || []).forEach(r => {
      if (!usersMap.has(r.id)) {
        usersMap.set(r.id, { id: r.id, username: r.username, email: r.email, roles: [] });
      }
      usersMap.get(r.id).roles.push(r.role_id);
    });

    const { results: invites } = await c.env.DB.prepare(`
      SELECT id, email, username, target_role_ids, expires_at 
      FROM project_invitations 
      WHERE project_id = ? AND status = 'Pending' AND strftime('%s', expires_at) > strftime('%s', 'now')
    `).bind(projectId).all<{ id: string; email: string | null; username: string | null; target_role_ids: string; expires_at: string }>();

    const pendingMembers = (invites || []).map(inv => ({
      id: inv.id,
      username: inv.username || '',
      email: inv.email || '',
      roles: JSON.parse(inv.target_role_ids),
      is_pending: true
    }));

    return c.json({ 
      members: [
        ...Array.from(usersMap.values()).map(m => ({ ...m, is_pending: false })),
        ...pendingMembers
      ]
    });
  });

  app.put('/api/projects/:id/members/:user_id', requirePermission('put:/api/projects/:id/members/:user_id'), async (c) => {
    const projectId = (c.req.param('id') as string);
    const memberId = (c.req.param('user_id') as string);
    const body = await c.req.json(); // { roles: [] }

    const userId = await getUserIdFromRequest(c);
    if (memberId === userId) {
      return c.json({ error: 'You cannot modify your own roles' }, 400);
    }

    if (!body.roles || !Array.isArray(body.roles) || body.roles.length === 0) {
      return c.json({ error: 'At least one role must be specified' }, 400);
    }

    // Validate roles exist
    const defaultRoles = ['owner', 'editor', 'viewer', 'runner'];
    const customRoles = body.roles.filter((r: string) => !defaultRoles.includes(r));
    if (customRoles.length > 0) {
      const placeholders = customRoles.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM project_custom_roles WHERE project_id = ? AND id IN (${placeholders})`
      ).bind(projectId, ...customRoles).all<{id: string}>();
      const foundRoles = new Set((results || []).map(r => r.id));
      const missing = customRoles.filter((r: string) => !foundRoles.has(r));
      if (missing.length > 0) {
        return c.json({ error: `Invalid role(s): ${missing.join(', ')}` }, 400);
      }
    }

    // Check if invitation
    const isInvite = await c.env.DB.prepare('SELECT 1 FROM project_invitations WHERE id = ? AND project_id = ?').bind(memberId, projectId).first();
    if (isInvite) {
      await c.env.DB.prepare('UPDATE project_invitations SET target_role_ids = ? WHERE id = ?').bind(JSON.stringify(body.roles), memberId).run();
      return c.json({ status: 'updated' });
    }

    // Update active member roles atomically
    const stmts = [
      c.env.DB.prepare('DELETE FROM project_member_roles WHERE project_id = ? AND user_id = ?').bind(projectId, memberId)
    ];

    body.roles.forEach((r: string) => {
      stmts.push(c.env.DB.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)').bind(projectId, memberId, r));
    });

    try {
      await c.env.DB.batch(stmts);
    } catch (e: any) {
      if (e.message && e.message.includes('Cannot remove the last owner')) {
        return c.json({ error: 'Cannot remove the owner role from the last owner' }, 400);
      }
      throw e;
    }
    
    // Invalidate user RBAC cache
    await(invalidateUserRBAC(c.env, projectId, memberId));

    return c.json({ status: 'updated' });
  });

  app.delete('/api/projects/:id/members/:user_id', requirePermission('delete:/api/projects/:id/members/:user_id'), async (c) => {
    const projectId = (c.req.param('id') as string);
    const memberId = (c.req.param('user_id') as string);

    const userId = await getUserIdFromRequest(c);
    if (memberId === userId) {
      return c.json({ error: 'You cannot remove yourself from the project' }, 400);
    }

    const isInvite = await c.env.DB.prepare('SELECT 1 FROM project_invitations WHERE id = ? AND project_id = ?').bind(memberId, projectId).first();
    if (isInvite) {
      await c.env.DB.prepare("UPDATE project_invitations SET status = 'Revoked' WHERE id = ?").bind(memberId).run();
      return c.json({ status: 'revoked' });
    }

    try {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM project_member_roles WHERE project_id = ? AND user_id = ?').bind(projectId, memberId),
        c.env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, memberId)
      ]);
    } catch (e: any) {
      if (e.message && e.message.includes('Cannot remove the last owner')) {
        return c.json({ error: 'Cannot remove the last owner of the project' }, 400);
      }
      throw e;
    }

    // Invalidate user RBAC cache
    await(invalidateUserRBAC(c.env, projectId, memberId));

    return c.json({ status: 'removed' });
  });

  app.put('/api/projects/:id/roles/:role_id', requirePermission('put:/api/projects/:id/roles/:role_id'), async (c) => {
    const projectId = (c.req.param('id') as string);
    const roleId = c.req.param('role_id') as string;
    const body = await c.req.json(); // { name, permissions: [], included_roles: [] }

    if (roleId.startsWith('owner') || roleId.startsWith('editor') || roleId.startsWith('viewer')) {
      return c.json({ error: 'Default roles cannot be edited' }, 400);
    }

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'Role name is required and must be a non-empty string' }, 400);
    }
    const roleName = body.name.trim();

    const existing = await c.env.DB.prepare('SELECT 1 FROM project_custom_roles WHERE project_id = ? AND name = ? AND id != ?').bind(projectId, roleName, roleId).first();
    if (existing) {
      return c.json({ error: 'A role with this name already exists' }, 400);
    }

    const permissions: string[] = body.permissions || [];
    const includedRoles: string[] = body.included_roles || [];

    const validKeys = Object.keys(PERMISSIONS);
    const invalidPerms = permissions.filter(p => !validKeys.includes(p));
    if (invalidPerms.length > 0) {
      return c.json({ error: `Unknown permission keys: ${invalidPerms.join(', ')}` }, 400);
    }

    if (includedRoles.length > 0) {
      const defaultRoleIds = Object.keys(DEFAULT_ROLES);
      const customCandidates = includedRoles.filter(id => !defaultRoleIds.includes(id));
      if (customCandidates.length > 0) {
        const placeholders = customCandidates.map(() => '?').join(',');
        const { results: found } = await c.env.DB.prepare(
          `SELECT id FROM project_custom_roles WHERE project_id = ? AND id IN (${placeholders})`
        ).bind(projectId, ...customCandidates).all<{ id: string }>();
        const foundIds = new Set((found || []).map(r => r.id));
        const missing = customCandidates.filter(id => !foundIds.has(id));
        if (missing.length > 0) {
          return c.json({ error: `Unknown role IDs: ${missing.join(', ')}` }, 400);
        }
      }
      if (includedRoles.includes(roleId)) {
        return c.json({ error: 'A role cannot include itself' }, 400);
      }
    }

    const stmts = [
      c.env.DB.prepare('UPDATE project_custom_roles SET name = ? WHERE id = ?').bind(roleName, roleId),
      c.env.DB.prepare('DELETE FROM custom_role_permissions WHERE role_id = ?').bind(roleId),
      c.env.DB.prepare('DELETE FROM custom_role_inheritance WHERE parent_role_id = ?').bind(roleId)
    ];

    permissions.forEach(p => stmts.push(c.env.DB.prepare('INSERT INTO custom_role_permissions (role_id, permission_key) VALUES (?, ?)').bind(roleId, p)));
    includedRoles.forEach(child => stmts.push(c.env.DB.prepare('INSERT INTO custom_role_inheritance (parent_role_id, child_role_id) VALUES (?, ?)').bind(roleId, child)));

    await c.env.DB.batch(stmts);
    
    // Invalidate project RBAC cache since role definition changed
    await invalidateProjectRBAC(c.env, projectId);

    return c.json({ status: 'updated' });
  });

  app.delete('/api/projects/:id/roles/:role_id', requirePermission('delete:/api/projects/:id/roles/:role_id'), async (c) => {
    const projectId = (c.req.param('id') as string);
    const roleId = c.req.param('role_id') as string;

    if (roleId.startsWith('owner') || roleId.startsWith('editor') || roleId.startsWith('viewer')) {
      return c.json({ error: 'Default roles cannot be deleted' }, 400);
    }

    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM project_custom_roles WHERE id = ?').bind(roleId),
      c.env.DB.prepare('DELETE FROM custom_role_permissions WHERE role_id = ?').bind(roleId),
      c.env.DB.prepare('DELETE FROM custom_role_inheritance WHERE parent_role_id = ? OR child_role_id = ?').bind(roleId, roleId),
      c.env.DB.prepare('DELETE FROM project_member_roles WHERE role_id = ?').bind(roleId)
    ]);

    // Invalidate project RBAC cache since a role was deleted
    await invalidateProjectRBAC(c.env, projectId);

    return c.json({ status: 'deleted' });
  });

  app.get('/api/auth/invitations', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const user = await c.env.DB.prepare('SELECT email, username FROM users WHERE id = ?').bind(userId).first<{email: string, username: string}>();
    if (!user) return c.json({ error: 'User not found' }, 404);

    const { results } = await c.env.DB.prepare(`
      SELECT i.id, i.token, i.project_id, p.name as project_name, i.expires_at 
      FROM project_invitations i
      JOIN projects p ON i.project_id = p.id
      WHERE i.status = 'Pending' 
        AND strftime('%s', i.expires_at) > strftime('%s', 'now')
        AND (i.email = ?1 OR i.username = ?2)
    `).bind(user.email, user.username).all<{ id: string; token: string; project_id: string; project_name: string; expires_at: string }>();

    return c.json({ invitations: results || [] });
  });


  app.post('/api/projects/:id/invitations', requirePermission('post:/api/projects/:id/invitations'), async (c) => {
    const projectId = (c.req.param('id') as string);
    const body = await c.req.json(); // { username, email, roles: [] }
    
    if (!body.roles || !Array.isArray(body.roles) || body.roles.length === 0) {
      return c.json({ error: 'At least one role must be specified' }, 400);
    }

    // Validate roles exist
    const defaultRoles = ['owner', 'editor', 'viewer', 'runner'];
    const customRoles = body.roles.filter((r: string) => !defaultRoles.includes(r));
    if (customRoles.length > 0) {
      const placeholders = customRoles.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM project_custom_roles WHERE project_id = ? AND id IN (${placeholders})`
      ).bind(projectId, ...customRoles).all<{id: string}>();
      const foundRoles = new Set((results || []).map(r => r.id));
      const missing = customRoles.filter((r: string) => !foundRoles.has(r));
      if (missing.length > 0) {
        return c.json({ error: `Invalid role(s): ${missing.join(', ')}` }, 400);
      }
    }

    const id = ulid();
    const token = ulid() + ulid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    await c.env.DB.prepare(`
      INSERT INTO project_invitations (id, project_id, email, username, target_role_ids, status, token, expires_at)
      VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)
    `).bind(id, projectId, body.email || null, body.username || null, JSON.stringify(body.roles), token, expiresAt).run();

    // In a real app we would send an email here.
    return c.json({ status: 'created', token, invitation_url: '/accept-invite?token=' + token });
  });

  app.post('/api/auth/invitations/accept', async (c) => {
    const body = await c.req.json(); // { token }
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const user = await c.env.DB.prepare('SELECT email, username FROM users WHERE id = ?').bind(userId).first<{email: string, username: string}>();
    if (!user) return c.json({ error: 'User not found' }, 404);

    // Atomically claim the token if it's valid, not expired, and matches user (or is open)
    const inv = await c.env.DB.prepare(`
      UPDATE project_invitations 
      SET status = 'Accepted' 
      WHERE token = ?1 
        AND status = 'Pending' 
        AND strftime('%s', expires_at) > strftime('%s', 'now')
        AND (username IS NULL OR username = ?2)
        AND (email IS NULL OR email = ?3)
      RETURNING *
    `).bind(body.token, user.username, user.email).first<any>();

    if (!inv) {
      // Check why it failed to provide better error
      const existing = await c.env.DB.prepare("SELECT username, email FROM project_invitations WHERE token = ? AND status = 'Pending'").bind(body.token).first<{username: string|null, email: string|null}>();
      if (existing) {
        if (existing.username && existing.username !== user.username) return c.json({ error: 'Invitation is for a different username' }, 403);
        if (existing.email && existing.email !== user.email) return c.json({ error: 'Invitation is for a different email' }, 403);
      }
      return c.json({ error: 'Invalid or expired invitation' }, 400);
    }

    const roles = JSON.parse(inv.target_role_ids);
    const stmts: any[] = [];

    roles.forEach((r: string) => {
      stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)').bind(inv.project_id, userId, r));
    });
    // Add to legacy project_members just in case for other endpoints
    stmts.push(c.env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'viewer')").bind(inv.project_id, userId));

    await c.env.DB.batch(stmts);
    await invalidateUserRBAC(c.env, inv.project_id, userId);

    return c.json({ status: 'accepted', project_id: inv.project_id });
  });
}
