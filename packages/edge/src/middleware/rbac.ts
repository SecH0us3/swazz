import { Context, Next } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest } from '../utils/auth';
import { checkPermission } from '../utils/rbac';
import { PermissionKey } from '../config/rbac';

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

    const hasAccess = await checkPermission(c.env.DB, userId, projectId, permission);
    if (!hasAccess) {
      return c.json({ error: 'Forbidden: Missing permission ' + permission }, 403);
    }

    await next();
  };
};
