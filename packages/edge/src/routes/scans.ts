import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, getClientIp } from '../utils/auth';
import { IScansRepository, ScansRepository } from '../repositories/scans';
import { IScansService, ScansService } from '../services/scans';
import { RbacRepository } from '../repositories/rbac';

export function registerScansRoutes(
  app: Hono<{ Bindings: Env }>,
  scansServicesFactory: (env: Env) => IScansService = (env) => new ScansService(env, new ScansRepository(env), new RbacRepository(env))
) {
  app.post('/api/scans', async (c) => {
    const services = scansServicesFactory(c.env);
    const body = await c.req.json();
    const userId = await getUserIdFromRequest(c);
    const authHeader = c.req.header('Authorization') ?? '';
    const clientIp = getClientIp(c);

    let waitUntil: any = undefined;
    try {
      if (c.executionCtx) {
        waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
      }
    } catch {}

    try {
      const result = await services.createScan(body, userId, authHeader, clientIp, waitUntil);
      return c.json(result, 201);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.get('/api/scans', async (c) => {
    const services = scansServicesFactory(c.env);
    const projectId = c.req.query('project_id');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.getScans(projectId || '', userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.get('/api/scans/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.getScan(scanId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.patch('/api/scans/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    const body = await c.req.json();
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.updateScan(scanId, body, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.post('/api/scans/:id/upload-url', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.generateUploadUrl(scanId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.put('/api/scans/:id/upload', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    const authHeader = c.req.header('X-Upload-Token');
    const bodyStream = c.req.raw.body;

    try {
      const result = await services.uploadReport(scanId, authHeader, bodyStream);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.get('/api/scans/:id/runner-logs', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const result = await services.getRunnerLogs(scanId, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.get('/api/scans/:id/findings', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const result = await services.getFindings(scanId, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.get('/api/findings/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const findingId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const result = await services.getFindingDetails(findingId, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.patch('/api/findings/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const findingId = c.req.param('id');
    const body = await c.req.json();
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    let executionCtx: any = undefined;
    try {
      executionCtx = c.executionCtx;
    } catch {}

    try {
      const result = await services.updateFinding(findingId, body, userId, isAuthEnabled, executionCtx);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
}
