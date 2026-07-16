import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, isWebRequest, isAnonymousUser, getClientIp } from '../utils/auth';
import { IMiscRepository, MiscRepository } from '../repositories/misc';
import { IMiscService, MiscService } from '../services/misc';

export function registerMiscRoutes(
  app: Hono<{ Bindings: Env }>,
  miscServicesFactory: (env: Env) => IMiscService = (env) => new MiscService(env, new MiscRepository(env))
) {
  app.all('/api/proxy', async (c) => {
    const services = miscServicesFactory(c.env);
    try {
      const bodyText = await c.req.text();
      const payload = JSON.parse(bodyText) as any;
      const result = await services.proxy(payload);
      return c.json(result);
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 502;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });
  
  app.post('/api/parse', async (c) => {
    const services = miscServicesFactory(c.env);
    const body = await c.req.text();
    const isAnon = await isAnonymousUser(c);
    const ip = getClientIp(c);
    const userId = await getUserIdFromRequest(c);
    const isWeb = isWebRequest(c);

    try {
      const result = await services.parseSpec(body, userId, isAnon, ip, isWeb);
      return c.text(result.bodyText, result.status as any, { 'Content-Type': 'application/json' });
    } catch (err: any) {
      const parts = err.message.split('|');
      const statusCode = parts.length > 1 ? parseInt(parts[1], 10) : 500;
      return c.json({ error: parts[0] }, statusCode as any);
    }
  });

  app.post('/api/telemetry/scans/increment', async (c) => {
    const services = miscServicesFactory(c.env);
    let yyMm: string | undefined;
    let body: any;
    try {
      body = await c.req.json();
    } catch {}

    if (body && body.yyMm !== undefined) {
      if (typeof body.yyMm !== "string") {
        return c.json({ error: "yyMm must be a string" }, 400);
      }
      if (/^\d{4}$/.test(body.yyMm)) {
        const yy = parseInt(body.yyMm.slice(0, 2), 10);
        const mm = parseInt(body.yyMm.slice(2), 10);
        if (mm >= 1 && mm <= 12) {
          const now = new Date();
          const currentYy = now.getUTCFullYear() % 100;
          const currentMm = now.getUTCMonth() + 1;
          if (yy < currentYy || (yy === currentYy && mm <= currentMm)) {
            yyMm = body.yyMm;
          }
        }
      }
    }

    if (!yyMm) {
      const now = new Date();
      const yy = String(now.getUTCFullYear()).slice(-2);
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      yyMm = `${yy}${mm}`;
    }

    try {
      await services.incrementGlobalScanCount(yyMm);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err.message || 'Internal server error' }, 500);
    }
  });

  app.get('/api/telemetry/scans/count', async (c) => {
    const services = miscServicesFactory(c.env);
    try {
      const result = await services.getGlobalScanCount();
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message || 'Internal server error' }, 500);
    }
  });
}
