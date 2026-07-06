import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest } from '../utils/auth';
import { requirePermission } from '../middleware/rbac';
import { auditLog } from '../middleware/auditLog';
import { IProjectServices, ProjectServices } from '../services/projects';

export function registerProjectsRoutes(
  app: Hono<{ Bindings: Env }>,
  projectServicesFactory: (env: Env) => IProjectServices = (env) => new ProjectServices(env)
) {
  app.get('/api/projects', async (c) => {
    const services = projectServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c) || c.req.query('user_id') || null;
    const projects = await services.getProjects(userId);
    return c.json({ projects });
  });
  
  app.post('/api/projects', async (c) => {
    const services = projectServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c) || 'anonymous';
    const body = await c.req.json();
    
    const { id } = await services.createProject(userId, body);
    return c.json({ id, status: 'created' });
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
  
    await services.saveProjectConfig(projectId, body.config);
  
    return c.json({ status: 'saved' });
  });

  app.post('/api/projects/:id/schedule', requirePermission('post:/api/projects/:id/schedule'), auditLog('post:/api/projects/:id/schedule', 'Updated scan schedule'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const body = await c.req.json();
    const { cron_schedule } = body;
    
    if (cron_schedule) {
      if (typeof cron_schedule !== 'string') {
        return c.json({ error: 'cron_schedule must be a string' }, 400);
      }
      // 1. Enforce frequency limit: at most once a day
      const parts = cron_schedule.trim().split(/\s+/);
      if (parts.length !== 5) {
        return c.json({ error: 'Invalid cron format. Must have exactly 5 fields.' }, 400);
      }
      const minute = parts[0];
      const hour = parts[1];
      const isSingleMinute = /^\d+$/.test(minute) && parseInt(minute, 10) >= 0 && parseInt(minute, 10) <= 59;
      const isSingleHour = /^\d+$/.test(hour) && parseInt(hour, 10) >= 0 && parseInt(hour, 10) <= 23;
      if (!isSingleMinute || !isSingleHour) {
        return c.json({ error: 'Scan schedule cannot be more frequent than once a day (minute and hour fields must be specific single integer constants).' }, 400);
      }
    }

    const { oldSchedule } = await services.updateProjectSchedule(projectId, cron_schedule || null);

    c.set('auditDetails' as any, {
      before: { cron_schedule: oldSchedule },
      after: { cron_schedule: cron_schedule || null }
    });
 
    return c.json({ status: 'saved', cron_schedule });
  });
  
  app.patch('/api/projects/:id', requirePermission('patch:/api/projects/:id'), auditLog('patch:/api/projects/:id', 'Updated project settings'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const body = await c.req.json();
  
    const { beforeDiff, afterDiff, updated } = await services.updateProjectSettings(projectId, body);

    if (updated) {
      c.set('auditDetails' as any, {
        before: beforeDiff,
        after: afterDiff
      });
    }
  
    return c.json({ status: 'updated' });
  });
  
  app.delete('/api/projects/:id', requirePermission('delete:/api/projects/:id'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
  
    await services.deleteProject(projectId);
  
    return c.json({ status: 'deleted' });
  });

  app.get('/api/projects/:id/analytics', async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const userId = await getUserIdFromRequest(c);
    const period = c.req.query('period') || '30d';

    try {
      const analytics = await services.getProjectAnalytics(projectId, userId || null, period);
      return c.json(analytics);
    } catch (e: any) {
      if (e.message === 'Unauthorized') return c.json({ error: 'Unauthorized' }, 401);
      if (e.message === 'Forbidden') return c.json({ error: 'Forbidden' }, 403);
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  });

  app.get('/api/projects/:id/members/:user_id/login-history', requirePermission('get:/api/projects/:id/members/:user_id/login-history'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;
    const userId = c.req.param('user_id') as string;

    const isMember = await services.checkUserIsMember(projectId, userId);

    if (!isMember) {
      return c.json({ error: 'User is not a member of this project' }, 404);
    }

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));

    const result = await services.getUserLoginHistory(userId, page, limit);

    return c.json(result);
  });

  app.get('/api/projects/:id/audit-logs', requirePermission('get:/api/projects/:id/audit-logs'), async (c) => {
    const services = projectServicesFactory(c.env);
    const projectId = c.req.param('id') as string;

    const page   = Math.max(1, parseInt(c.req.query('page')   || '1',  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
    const search = (c.req.query('search') || '').trim();
    const source = (c.req.query('source') || '').trim();
    const action = (c.req.query('action') || '').trim();

    const result = await services.getProjectAuditLogs(projectId, page, limit, search, source, action);

    return c.json(result);
  });
}
