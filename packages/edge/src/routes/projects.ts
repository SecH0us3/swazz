import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest } from '../utils/auth';
import { requirePermission } from '../middleware/rbac';
import { auditLog } from '../middleware/auditLog';
import { IProjectRepository, ProjectRepository } from '../repositories/projects';
import { IProjectService, ProjectService } from '../services/projects';
import { RbacRepository } from '../repositories/rbac';

export function registerProjectsRoutes(
  app: Hono<{ Bindings: Env; Variables: { auditDetails: any } }>,
  projectServicesFactory: (env: Env) => IProjectService = (env) => new ProjectService(env, new ProjectRepository(env), new RbacRepository(env))
) {
  app.get('/api/projects', async (c) => {
    const services = projectServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const result = await services.getProjects(userId, isAuthEnabled);
      return c.json(result);
    } catch (e: any) {
      if (e.message.startsWith('Unauthorized')) return c.json({ error: 'Unauthorized' }, 401);
      return c.json({ error: e.message }, 500);
    }
  });
  
  app.post('/api/projects', async (c) => {
    const services = projectServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';
    const body = await c.req.json();
    
    try {
      const result = await services.createProject(userId, isAuthEnabled, body);
      return c.json(result);
    } catch (e: any) {
      if (e.message.startsWith('Unauthorized')) return c.json({ error: 'Unauthorized' }, 401);
      return c.json({ error: e.message }, 500);
    }
  });
  
  app.get('/api/projects/:id/config', requirePermission('get:/api/projects/:id/config'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
  
    const result = await services.getProjectConfig(projectId);
    return c.json(result);
  });
  
  app.post('/api/projects/:id/config', requirePermission('post:/api/projects/:id/config'), auditLog('post:/api/projects/:id/config', 'Saved scan configuration'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const body = await c.req.json();
  
    const result = await services.saveProjectConfig(projectId, body.config);
    return c.json(result);
  });

  app.post('/api/projects/:id/schedule', requirePermission('post:/api/projects/:id/schedule'), auditLog('post:/api/projects/:id/schedule', 'Updated scan schedule'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const body = await c.req.json();
    
    try {
      const result = await services.updateProjectSchedule(projectId, body);
      
      if (result.auditDetails) {
        c.set('auditDetails', result.auditDetails);
      }
   
      return c.json({ status: result.status, cron_schedule: result.cron_schedule });
    } catch (e: any) {
      if (e.message.includes('|400')) {
        return c.json({ error: e.message.split('|')[0] }, 400);
      }
      return c.json({ error: e.message }, 500);
    }
  });
  
  app.patch('/api/projects/:id', requirePermission('patch:/api/projects/:id'), auditLog('patch:/api/projects/:id', 'Updated project settings'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const body = await c.req.json();
  
    const result = await services.updateProjectSettings(projectId, body);

    if (result.auditDetails) {
      c.set('auditDetails', result.auditDetails);
    }
  
    return c.json({ status: result.status });
  });
  
  app.delete('/api/projects/:id', requirePermission('delete:/api/projects/:id'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
  
    const result = await services.deleteProject(projectId);
    return c.json(result);
  });

  app.get('/api/projects/:id/analytics', async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const userId = await getUserIdFromRequest(c);
    const period = c.req.query('period') || '30d';
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const analytics = await services.getProjectAnalytics(projectId, userId || null, period, isAuthEnabled);
      return c.json(analytics);
    } catch (e: any) {
      console.error("GET /api/projects/:id/analytics error:", e);
      if (e.message.startsWith('Unauthorized')) return c.json({ error: 'Unauthorized' }, 401);
      if (e.message.startsWith('Forbidden')) return c.json({ error: 'Forbidden' }, 403);
      return c.json({ error: 'Internal Server Error', message: e.message, stack: e.stack }, 500);
    }
  });

  app.get('/api/projects/:id/members/:user_id/login-history', requirePermission('get:/api/projects/:id/members/:user_id/login-history'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const userId = c.req.param('user_id') as string;
    const queryPage = c.req.query('page') || '1';
    const queryLimit = c.req.query('limit') || '20';

    try {
      const result = await services.getUserLoginHistory(projectId, userId, queryPage, queryLimit);
      return c.json(result);
    } catch (e: any) {
      if (e.message.includes('|404')) return c.json({ error: e.message.split('|')[0] }, 404);
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  });

  app.get('/api/projects/:id/audit-logs', requirePermission('get:/api/projects/:id/audit-logs'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;

    const queryPage = c.req.query('page') || '1';
    const queryLimit = c.req.query('limit') || '20';
    const search = c.req.query('search') || '';
    const source = c.req.query('source') || '';
    const action = c.req.query('action') || '';

    const result = await services.getProjectAuditLogs(projectId, queryPage, queryLimit, search, source, action);

    return c.json(result);
  });

  app.get('/api/projects/:id/webhooks', requirePermission('get:/api/projects/:id/webhooks'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    try {
      const result = await services.getProjectWebhooks(projectId);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post('/api/projects/:id/webhooks', requirePermission('post:/api/projects/:id/webhooks'), auditLog('post:/api/projects/:id/webhooks', 'Created project webhook'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const body = await c.req.json();
    try {
      const result = await services.createProjectWebhook(projectId, body);
      return c.json(result, 201);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.put('/api/projects/:id/webhooks/:webhook_id', requirePermission('put:/api/projects/:id/webhooks/:webhook_id'), auditLog('put:/api/projects/:id/webhooks/:webhook_id', 'Updated project webhook'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const webhookId = c.req.param('webhook_id') as string;
    const body = await c.req.json();
    try {
      const result = await services.updateProjectWebhook(projectId, webhookId, body);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.delete('/api/projects/:id/webhooks/:webhook_id', requirePermission('delete:/api/projects/:id/webhooks/:webhook_id'), auditLog('delete:/api/projects/:id/webhooks/:webhook_id', 'Deleted project webhook'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const webhookId = c.req.param('webhook_id') as string;
    try {
      const result = await services.deleteProjectWebhook(projectId, webhookId);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post('/api/projects/:id/webhooks/:webhook_id/test', requirePermission('post:/api/projects/:id/webhooks/:webhook_id/test'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const webhookId = c.req.param('webhook_id') as string;
    try {
      const result = await services.testProjectWebhook(projectId, webhookId);
      return c.json(result);
    } catch (e: any) {
      const parts = e.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post(
    '/api/projects/:id/members/create',
    requirePermission('post:/api/projects/:id/members/create'),
    auditLog('post:/api/projects/:id/members/create', 'Created project user or service account'),
    async (c) => {
      const services = projectServicesFactory(c.env);
      const projectId = c.req.param('id') as string;
      let body: any;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
      
      try {
        const result = await services.createProjectMemberAccount(projectId, body);
        c.set('auditDetails', {
          username: result.username,
          userId: result.id,
          roles: body.roles,
          is_interactive: body.is_interactive !== false
        });
        return c.json(result, 201);
      } catch (e: any) {
        const parts = e.message.split('|');
        const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
        return c.json({ error: parts[0] }, statusCode as any);
      }
    }
  );
}

