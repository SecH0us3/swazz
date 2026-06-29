import { DEFAULT_ROLES, PermissionKey } from '../config/rbac';
import { Env } from '../env';

export async function invalidateProjectRBAC(env: Env, projectId: string) {
  const prefix = `rbac:${projectId}:`;
  let cursor: string | undefined;
  do {
    const list = await env.SESSION_CACHE.list({ prefix, cursor });
    const keys = list.keys.map(k => k.name);
    if (keys.length > 0) {
      await Promise.all(keys.map(k => env.SESSION_CACHE.delete(k)));
    }
    cursor = list.cursor;
  } while (cursor);
}

export async function invalidateUserRBAC(env: Env, projectId: string, userId: string) {
  await env.SESSION_CACHE.delete(`rbac:${projectId}:${userId}`);
}

export async function checkPermission(
  env: Env,
  userId: string,
  projectId: string,
  requiredPermission: PermissionKey
): Promise<boolean> {
  const cacheKey = `rbac:${projectId}:${userId}`;
  
  const cached = await env.SESSION_CACHE.get<{permissions: string[]}>(cacheKey, 'json');
  if (cached) {
    return cached.permissions.includes(requiredPermission);
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
    await env.SESSION_CACHE.put(cacheKey, JSON.stringify({ permissions: [] }), { expirationTtl: 300 });
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

  // 2. Resolve custom roles in DB
  const placeholders = roleIds.map(() => '?').join(',');
  const query = `SELECT permission_key FROM custom_role_permissions WHERE role_id IN (${placeholders})`;
  const { results: permResults } = await env.DB.prepare(query).bind(...roleIds).all<{ permission_key: string }>();
  
  if (permResults) {
    permResults.forEach(r => permissions.add(r.permission_key));
  }

  const permsArray = Array.from(permissions);
  // Cache for 24 hours. Will be actively invalidated on role/member changes.
  await env.SESSION_CACHE.put(cacheKey, JSON.stringify({ permissions: permsArray }), { expirationTtl: 86400 });

  return permissions.has(requiredPermission);
}
