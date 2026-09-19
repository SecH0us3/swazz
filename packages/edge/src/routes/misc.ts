// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { getUserIdFromRequest, isWebRequest, isAnonymousUser, getClientIp, verifyTurnstile } from '../utils/auth';
import { IMiscRepository, MiscRepository } from '../repositories/misc';
import { IMiscService, MiscService } from '../services/misc';
import { runWafCheck } from '../services/wafCheck';
import { errorStatus, toStatusCode } from '../utils/http';

export function registerMiscRoutes(
  app: Hono<AppEnv>,
  miscServicesFactory: (env: Env) => IMiscService = (env) => new MiscService(env, new MiscRepository(env))
) {
  app.post('/api/waf-check', async (c) => {
    try {
      const body = await c.req.json();
      if (!body?.url || typeof body.url !== 'string') {
        throw new Error('Missing target url|400');
      }
      const result = await runWafCheck(c.env, body.url);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      return c.json({ error: parts[0] }, errorStatus(parts[1], 502));
    }
  });

  app.all('/api/proxy', async (c) => {
    const services = miscServicesFactory(c.env);
    try {
      const bodyText = await c.req.text();
      const payload: unknown = JSON.parse(bodyText);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid JSON payload|400');
      }
      const result = await services.proxy(payload);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      return c.json({ error: parts[0] }, errorStatus(parts[1], 502));
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
      return c.text(result.bodyText, toStatusCode(result.status), { 'Content-Type': 'application/json' });
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      return c.json({ error: parts[0] }, errorStatus(parts[1], 500));
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
      c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=86400');
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message || 'Internal server error' }, 500);
    }
  });

  app.post('/api/waitlist', async (c) => {
    try {
      const body = await c.req.json();
      const { email, name, company } = body || {};
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return c.json({ error: 'Valid email address is required' }, 400);
      }

      const turnstileSecret = c.env.TURNSTILE_SECRET;
      if (turnstileSecret && c.env.JWT_SECRET !== 'test-secret') {
        const turnstileToken = body['cf-turnstile-response'];
        const remoteIp = c.req.header('CF-Connecting-IP') ?? undefined;
        if (!turnstileToken) {
          return c.json({ error: 'Missing Turnstile token' }, 403);
        }
        const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteIp);
        if (!valid) {
          return c.json({ error: 'Turnstile verification failed' }, 403);
        }
      }

      // eslint-disable-next-line no-console
      console.log(`[Waitlist] New enterprise lead: ${email}, Name: ${name || 'N/A'}, Company: ${company || 'N/A'}`);
      return c.json({ success: true, message: 'Waitlist entry registered successfully' });
    } catch (err: any) {
      return c.json({ error: 'Invalid request payload' }, 400);
    }
  });
}
