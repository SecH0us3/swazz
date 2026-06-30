// @ts-nocheck
import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, hashPassword, verifyPassword, recordFailedLogin, verifyTurnstile, checkProjectMembership, checkScanMembership, resetLoginAttempts, isWebRequest, isAnonymousUser, getClientIp } from '../utils/auth';
import { ulid } from 'ulidx';
import { sign } from 'hono/jwt';

export function registerMiscRoutes(app: Hono<{ Bindings: Env }>) {
  app.all('/api/proxy', async (c) => {
    try {
      const bodyText = await c.req.text();
      const payload = JSON.parse(bodyText) as any;
      const targetUrl = payload.url;
      if (!targetUrl) return c.json({ error: 'Missing target url' }, 400);
  
      const startTime = Date.now();
      const fetchOpts: RequestInit = {
        method: payload.method || 'GET',
        headers: payload.headers || {},
        body: ['GET', 'HEAD'].includes(payload.method || 'GET') ? undefined : payload.body,
        redirect: 'manual'
      };
  
      const response = await fetch(targetUrl, fetchOpts);
      const duration = Date.now() - startTime;
      
      let resBody = await response.text();
      try { resBody = JSON.parse(resBody); } catch {}
      
      return c.json({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: resBody,
        duration
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 502);
    }
  });
  
  app.post('/api/parse', async (c) => {
    const body = await c.req.text();
  
    if (c.env.LIMIT_ANONYMOUS === 'true' && isWebRequest(c)) {
      const isAnon = await isAnonymousUser(c);
      if (isAnon) {
        const ip = getClientIp(c);
        
        const usage = await c.env.DB.prepare('SELECT json_count FROM anonymous_usage WHERE ip = ?')
          .bind(ip)
          .first<{ json_count: number }>();
  
        if (usage && usage.json_count >= 1) {
          return c.json({ error: 'Anonymous limit reached: You can only import/parse 1 JSON spec by IP.' }, 403);
        }
      }
    }
  
    let userPublicKey = "";
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      try {
        const user = await c.env.DB.prepare('SELECT public_key FROM users WHERE id = ?')
          .bind(userId)
          .first<{ public_key: string | null }>();
        if (user && user.public_key) {
          userPublicKey = user.public_key;
        }
      } catch (dbErr) {
        console.error("Failed to query user public key in /api/parse:", dbErr);
      }
    }
  
    let parsedBody: any = {};
    try {
      parsedBody = JSON.parse(body);
    } catch { /* ignored */ }
    parsedBody.userPublicKey = userPublicKey;
    const newBodyText = JSON.stringify(parsedBody);
  
    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const res = await stub.fetch(new Request('http://internal/parse', { method: 'POST', body: newBodyText }));
  
    if (res.ok && c.env.LIMIT_ANONYMOUS === 'true' && isWebRequest(c)) {
      const isAnon = await isAnonymousUser(c);
      if (isAnon) {
        const ip = getClientIp(c);
        await c.env.DB.prepare(
          `INSERT INTO anonymous_usage (ip, json_count) VALUES (?, 1)
           ON CONFLICT(ip) DO UPDATE SET json_count = json_count + 1`
        ).bind(ip).run();
      }
    }
  
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  });
  
}
