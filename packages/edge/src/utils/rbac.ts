import { DEFAULT_ROLES, PermissionKey } from '../config/rbac';
import { Env } from '../env';

export async function invalidateProjectRBAC(env: Env, projectId: string) {
  if (!env.SESSION_CACHE) return;
  
  // Get all members of the project to invalidate their cache keys directly
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM project_member_roles WHERE project_id = ?
      UNION
      SELECT user_id FROM project_members WHERE project_id = ?
    )
  `).bind(projectId, projectId).all<{ user_id: string }>();

  if (results && results.length > 0) {
    await Promise.all(results.map(r => env.SESSION_CACHE!.delete(`rbac:${projectId}:${r.user_id}`)));
  }
}

export async function invalidateUserRBAC(env: Env, projectId: string, userId: string) {
  if (env.SESSION_CACHE) {
    await env.SESSION_CACHE!.delete(`rbac:${projectId}:${userId}`);
  }
}

export async function checkPermission(
  env: Env,
  userId: string,
  projectId: string,
  requiredPermission: PermissionKey
): Promise<boolean> {
  const cacheKey = `rbac:${projectId}:${userId}`;
  
  if (env.SESSION_CACHE) {
    const cached = await env.SESSION_CACHE!.get<{permissions: string[]}>(cacheKey, 'json');
    if (cached) {
      return cached.permissions.includes(requiredPermission);
    }
  }

  // Use a recursive CTE to get all role IDs for the user, including inherited ones up to depth 3
  const { results: roleResults } = await env.DB.prepare(`
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
    if (env.SESSION_CACHE) {
      await env.SESSION_CACHE!.put(cacheKey, JSON.stringify({ permissions: [] }), { expirationTtl: 300 });
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
    const { results: permResults } = await env.DB.prepare(query).bind(...customRoleIds).all<{ permission_key: string }>();
    
    if (permResults) {
      permResults.forEach(r => permissions.add(r.permission_key));
    }
  }

  const permsArray = Array.from(permissions);
  // Cache for 24 hours. Will be actively invalidated on role/member changes.
  if (env.SESSION_CACHE) {
    await env.SESSION_CACHE!.put(cacheKey, JSON.stringify({ permissions: permsArray }), { expirationTtl: 86400 });
  }

  return permissions.has(requiredPermission);
}
