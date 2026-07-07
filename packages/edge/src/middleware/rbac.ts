import { Context, Next } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, getSessionIat } from '../utils/auth';
import { PermissionKey } from '../config/rbac';
import { RbacRepository } from '../repositories/rbac';

export const requirePermission = (permission: PermissionKey) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const projectId = c.req.param('id');
    if (!projectId) {
      return c.json({ error: 'Project ID is required in the path' }, 400);
    }

    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const rbacRepo = new RbacRepository(c.env);
    
    try {
      const memberSessionTimeout = await rbacRepo.getProjectSessionTimeout(projectId);

      if (memberSessionTimeout && memberSessionTimeout > 0) {
        const iat = await getSessionIat(c);
        if (iat) {
          const elapsed = Math.floor(Date.now() / 1000) - iat;
          if (elapsed > memberSessionTimeout) {
            return c.json({ error: 'Session expired: Project requires re-authentication' }, 401);
          }
        }
      }
    } catch (err) {
      console.error("Failed to check project session timeout in requirePermission:", err);
    }

    const hasAccess = await rbacRepo.checkPermission(userId, projectId, permission);
    if (!hasAccess) {
      return c.json({ error: 'Forbidden: Missing permission ' + permission }, 403);
    }

    await next();
  };
};
