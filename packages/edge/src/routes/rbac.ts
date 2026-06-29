import { Hono } from 'hono';
import { Env } from '../env';
import { requirePermission } from '../middleware/rbac';
import { PERMISSIONS, DEFAULT_ROLES, PermissionKey } from '../config/rbac';
import { ulid } from 'ulidx';
import { getUserIdFromRequest } from '../utils/auth';

export function registerRbacRoutes(app: Hono<{ Bindings: Env }>) {
  
  app.get('/api/projects/:id/permissions', requirePermission('get:/api/projects/:id'), async (c) => {
    return c.json({ permissions: PERMISSIONS });
  });

  app.get('/api/projects/:id/roles', requirePermission('get:/api/projects/:id/roles'), async (c) => {
    const projectId = c.req.param('id');
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
    const projectId = c.req.param('id');
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
    return c.json({ status: 'created', id: roleId });
  });

  app.get('/api/projects/:id/members', requirePermission('get:/api/projects/:id/members'), async (c) => {
    const projectId = c.req.param('id');
    
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

    return c.json({ members: Array.from(usersMap.values()) });
  });

  app.post('/api/projects/:id/invitations', requirePermission('post:/api/projects/:id/invitations'), async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json(); // { username, email, roles: [] }
    
    if (!body.roles || !Array.isArray(body.roles) || body.roles.length === 0) {
      return c.json({ error: 'At least one role must be specified' }, 400);
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

    // Atomically claim the token if it's valid and not expired
    const inv = await c.env.DB.prepare(`
      UPDATE project_invitations 
      SET status = 'Accepted' 
      WHERE token = ? AND status = 'Pending' AND strftime('%s', expires_at) > strftime('%s', 'now')
      RETURNING *
    `).bind(body.token).first<any>();

    if (!inv) return c.json({ error: 'Invalid or expired invitation' }, 400);

    // Ensure it matches the user if username/email was specified
    const user = await c.env.DB.prepare('SELECT email, username FROM users WHERE id = ?').bind(userId).first<{email: string, username: string}>();
    if (inv.username && inv.username !== user?.username) {
      // Revert if mismatch
      await c.env.DB.prepare("UPDATE project_invitations SET status = 'Pending' WHERE id = ?").bind(inv.id).run();
      return c.json({ error: 'Invitation is for a different username' }, 403);
    }
    if (inv.email && inv.email !== user?.email) {
      // Revert if mismatch
      await c.env.DB.prepare("UPDATE project_invitations SET status = 'Pending' WHERE id = ?").bind(inv.id).run();
      return c.json({ error: 'Invitation is for a different email' }, 403);
    }

    const roles = JSON.parse(inv.target_role_ids);
    const stmts: any[] = [];

    roles.forEach((r: string) => {
      stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)').bind(inv.project_id, userId, r));
    });
    // Add to legacy project_members just in case for other endpoints
    stmts.push(c.env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'viewer')").bind(inv.project_id, userId));

    await c.env.DB.batch(stmts);
    return c.json({ status: 'accepted', project_id: inv.project_id });
  });
}
