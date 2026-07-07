import { Hono } from 'hono';
import { Env } from '../env';
import { requirePermission } from '../middleware/rbac';
import { auditLog } from '../middleware/auditLog';
import { getUserIdFromRequest } from '../utils/auth';
import { IRbacRepository, RbacRepository } from '../repositories/rbac';
import { IRbacService, RbacService } from '../services/rbac';

export function registerRbacRoutes(
  app: Hono<{ Bindings: Env; Variables: { auditDetails: any } }>,
  rbacServicesFactory: (env: Env) => IRbacService = (env) => new RbacService(env, new RbacRepository(env))
) {
  
  app.get('/api/projects/:id/permissions', requirePermission('get:/api/projects/:id'), async (c) => {
    const services = rbacServicesFactory(c.env);
    return c.json(services.getPermissions());
  });

  app.get('/api/projects/:id/roles', requirePermission('get:/api/projects/:id/roles'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    try {
      const result = await services.getRoles(projectId);
      return c.json(result);
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.post('/api/projects/:id/roles', requirePermission('post:/api/projects/:id/roles'), auditLog('post:/api/projects/:id/roles', 'Created custom role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    const userId = await getUserIdFromRequest(c);
    const body = await c.req.json();

    try {
      const result = await services.createCustomRole(projectId, userId, body);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.get('/api/projects/:id/members', requirePermission('get:/api/projects/:id/members'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    try {
      const result = await services.getMembers(projectId);
      return c.json(result);
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.put('/api/projects/:id/members/:user_id', requirePermission('put:/api/projects/:id/members/:user_id'), auditLog('put:/api/projects/:id/members/:user_id', 'Updated member role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    const memberId = (c.req.param('user_id') as string);
    const userId = await getUserIdFromRequest(c);
    const body = await c.req.json();

    try {
      const result = await services.updateMemberRoles(projectId, userId, memberId, body);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.delete('/api/projects/:id/members/:user_id', requirePermission('delete:/api/projects/:id/members/:user_id'), auditLog('delete:/api/projects/:id/members/:user_id', 'Removed a member'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    const memberId = (c.req.param('user_id') as string);
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.removeMember(projectId, userId, memberId);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.put('/api/projects/:id/roles/:role_id', requirePermission('put:/api/projects/:id/roles/:role_id'), auditLog('put:/api/projects/:id/roles/:role_id', 'Updated custom role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    const roleId = c.req.param('role_id') as string;
    const userId = await getUserIdFromRequest(c);
    const body = await c.req.json();

    try {
      const result = await services.updateCustomRole(projectId, userId, roleId, body);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.delete('/api/projects/:id/roles/:role_id', requirePermission('delete:/api/projects/:id/roles/:role_id'), auditLog('delete:/api/projects/:id/roles/:role_id', 'Deleted custom role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    const roleId = c.req.param('role_id') as string;
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.deleteCustomRole(projectId, userId, roleId);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.get('/api/auth/invitations', async (c) => {
    const services = rbacServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.getInvitations(userId);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post('/api/projects/:id/invitations', requirePermission('post:/api/projects/:id/invitations'), auditLog('post:/api/projects/:id/invitations', 'Invited a member'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    const userId = await getUserIdFromRequest(c);
    const body = await c.req.json();

    try {
      const result = await services.createInvitation(projectId, userId, body);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post('/api/auth/invitations/accept', async (c) => {
    const services = rbacServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);
    const body = await c.req.json();

    try {
      const result = await services.acceptInvitation(userId, body);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post('/api/auth/invitations/decline', async (c) => {
    const services = rbacServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);
    const body = await c.req.json();

    try {
      const result = await services.declineInvitation(userId, body);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
}
