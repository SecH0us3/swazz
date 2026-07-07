import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, isWebRequest, isAnonymousUser } from '../utils/auth';
import { IRunnersRepository, RunnersRepository } from '../repositories/runners';
import { IRunnersService, RunnersService } from '../services/runners';

import { RbacRepository } from '../repositories/rbac';

export function registerRunnersRoutes(
  app: Hono<{ Bindings: Env }>,
  runnersServicesFactory: (env: Env) => IRunnersService = (env) => new RunnersService(env, new RunnersRepository(env), new RbacRepository(env))
) {
  app.get('/api/runners/connect', async (c) => {
    const services = runnersServicesFactory(c.env);
    const upgradeHeader = c.req.header('Upgrade');
    const token = c.req.query('token') || (c.req.header('Authorization')?.startsWith('Bearer ') ? c.req.header('Authorization')?.substring(7) : undefined);
    const publicKey = c.req.header('X-Runner-Public-Key') || c.req.query('public_key');

    try {
      return await services.connect(upgradeHeader, token, publicKey, c.req.raw.url, c.req.raw);
    } catch (err: any) {
      console.error(`WS Connect Runner Error: ${err.message}`);
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return new Response(parts[0], { status: statusCode });
    }
  });
  
  app.get('/api/runners', async (c) => {
    const services = runnersServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);
    try {
      const result = await services.getRunners(userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.get('/api/runs/:id/events', async (c) => {
    const services = runnersServicesFactory(c.env);
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    const upgradeHeader = c.req.header('Upgrade');

    try {
      return await services.connectClient(runId, userId, upgradeHeader, c.req.raw.url, c.req.raw);
    } catch (err: any) {
      console.error(`WS Connect Client Error: ${err.message}`);
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return new Response(parts[0], { status: statusCode });
    }
  });
  
  app.post('/api/runs', async (c) => {
    const services = runnersServicesFactory(c.env);
    const body = await c.req.json();
    const userId = await getUserIdFromRequest(c);
    const isWeb = isWebRequest(c);
    const isAnon = await isAnonymousUser(c);

    try {
      const result = await services.queueRun(body, userId, isWeb, isAnon);
      return c.json(result, 201);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.post('/api/runs/:id/stop', async (c) => {
    const services = runnersServicesFactory(c.env);
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.stopRun(runId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.post('/api/runs/:id/pause', async (c) => {
    const services = runnersServicesFactory(c.env);
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.pauseRun(runId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.post('/api/runs/:id/resume', async (c) => {
    const services = runnersServicesFactory(c.env);
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.resumeRun(runId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post('/api/runners/:connectionId/restart', async (c) => {
    const services = runnersServicesFactory(c.env);
    const connectionId = c.req.param('connectionId');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.restartRunner(connectionId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
}
