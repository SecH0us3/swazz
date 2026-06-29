import { DEFAULT_ROLES, PermissionKey } from '../config/rbac';

export async function checkPermission(
  db: D1Database,
  userId: string,
  projectId: string,
  requiredPermission: PermissionKey
): Promise<boolean> {
  // 1. Get all roles for the user in this project
  const { results: userRoles } = await db.prepare(
    'SELECT role_id FROM project_member_roles WHERE project_id = ? AND user_id = ?'
  ).bind(projectId, userId).all<{ role_id: string }>();

  if (!userRoles || userRoles.length === 0) {
    // If not in project_member_roles, check legacy project_members fallback
    const legacy = await db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(projectId, userId).first<{ role: string }>();
    
    if (!legacy) return false;
    userRoles.push({ role_id: legacy.role });
  }

  const roleQueue = userRoles.map(r => ({ id: r.role_id, depth: 0 }));
  const resolvedPermissions = new Set<string>();
  const visitedRoles = new Set<string>();

  // Fetch all custom roles for the project upfront for fast resolving
  const { results: customRoles } = await db.prepare(
    'SELECT id, name FROM project_custom_roles WHERE project_id = ?'
  ).bind(projectId).all<{ id: string; name: string }>();

  const customRoleIds = customRoles ? customRoles.map(r => r.id) : [];
  
  let allCustomPermissions: { role_id: string; permission_key: string }[] = [];
  let allInheritance: { parent_role_id: string; child_role_id: string }[] = [];
  
  if (customRoleIds.length > 0) {
    const placeholders = customRoleIds.map(() => '?').join(',');
    const permQuery = `SELECT role_id, permission_key FROM custom_role_permissions WHERE role_id IN (${placeholders})`;
    allCustomPermissions = (await db.prepare(permQuery).bind(...customRoleIds).all<{role_id: string, permission_key: string}>()).results || [];
    
    const inheritQuery = `SELECT parent_role_id, child_role_id FROM custom_role_inheritance WHERE parent_role_id IN (${placeholders})`;
    allInheritance = (await db.prepare(inheritQuery).bind(...customRoleIds).all<{parent_role_id: string, child_role_id: string}>()).results || [];
  }

  // 2. Resolve permissions using BFS (max depth 3)
  while (roleQueue.length > 0) {
    const current = roleQueue.shift()!;
    if (visitedRoles.has(current.id)) continue;
    visitedRoles.add(current.id);

    // If it's a default role
    if (DEFAULT_ROLES[current.id]) {
      DEFAULT_ROLES[current.id].permissions.forEach(p => resolvedPermissions.add(p));
    } else {
      // It's a custom role
      const rolePerms = allCustomPermissions.filter(p => p.role_id === current.id);
      rolePerms.forEach(p => resolvedPermissions.add(p.permission_key));
      
      // Inheritance (only up to depth 3)
      if (current.depth < 3) {
        const children = allInheritance.filter(i => i.parent_role_id === current.id);
        children.forEach(c => {
          roleQueue.push({ id: c.child_role_id, depth: current.depth + 1 });
        });
      }
    }
    
    // Early exit if permission is found
    if (resolvedPermissions.has(requiredPermission)) {
      return true;
    }
  }

  return false;
}
