import { DEFAULT_ROLES, PermissionKey } from '../config/rbac';

export async function checkPermission(
  db: D1Database,
  userId: string,
  projectId: string,
  requiredPermission: PermissionKey
): Promise<boolean> {
  // Use a recursive CTE to get all role IDs for the user, including inherited ones up to depth 3
  const { results: roleResults } = await db.prepare(`
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
    return false;
  }

  const roleIds = roleResults.map(r => r.role_id);
  
  // Now resolve permissions for these roles
  // 1. Check default roles in memory
  for (const rid of roleIds) {
    if (DEFAULT_ROLES[rid] && DEFAULT_ROLES[rid].permissions.includes(requiredPermission)) {
      return true;
    }
  }

  // 2. Check custom roles in DB
  const placeholders = roleIds.map(() => '?').join(',');
  const query = `
    SELECT 1 FROM custom_role_permissions 
    WHERE role_id IN (${placeholders}) AND permission_key = ?
    LIMIT 1
  `;
  const { results: permResults } = await db.prepare(query).bind(...roleIds, requiredPermission).all();
  
  return permResults && permResults.length > 0;
}
