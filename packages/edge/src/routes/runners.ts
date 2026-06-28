import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, getDeleteRequestedAt, hashPassword, verifyPassword, recordFailedLogin, verifyTurnstile, checkProjectMembership, checkScanMembership, resetLoginAttempts, isWebRequest, isAnonymousUser, getClientIp } from '../utils/auth';
import { ulid } from 'ulidx';
import { sign } from 'hono/jwt';

export function registerRunnersRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/runners/connect', async (c) => {
    const upgradeHeader = c.req.header('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }
  
    let token = c.req.query('token');
    if (!token) {
      const authHeader = c.req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
  
    const publicKey = c.req.header('X-Runner-Public-Key') || c.req.query('public_key');
  
    let userId = "";
    if (publicKey) {
      const user = await c.env.DB.prepare('SELECT id FROM users WHERE public_key = ?')
        .bind(publicKey)
        .first<{ id: string }>();
      if (!user) {
        return new Response('Unauthorized: Invalid public key', { status: 401 });
      }
      userId = user.id;
    } else if (token) {
      const user = await c.env.DB.prepare('SELECT id FROM users WHERE api_key = ?')
        .bind(token)
        .first<{ id: string }>();
      if (!user) {
        return new Response('Unauthorized: Invalid runner token', { status: 401 });
      }
      userId = user.id;
    } else {
      return new Response('Unauthorized: Missing token or X-Runner-Public-Key header', { status: 401 });
    }

    const deleteRequestedAt = await getDeleteRequestedAt(c.env.DB, userId);
    if (deleteRequestedAt !== null) {
      return new Response('Forbidden: Account is scheduled for deletion', { status: 403 });
    }
  
    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const req = new Request(c.req.raw.url, c.req.raw);
    const url = new URL(req.url);
    url.pathname = '/connect-runner';
    if (publicKey) {
      url.searchParams.set('public_key', publicKey);
    }
    if (userId) {
      url.searchParams.set('user_id', userId);
    }
    return stub.fetch(new Request(url.toString(), req));
  });
  
  app.get('/api/runners', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  
    let userPublicKey: string | null = null;
    try {
      const user = await c.env.DB.prepare('SELECT public_key FROM users WHERE id = ?')
        .bind(userId)
        .first<{ public_key: string | null }>();
      if (user) {
        userPublicKey = user.public_key;
      }
    } catch (err) {
      console.error("Failed to fetch user public key in /api/runners:", err);
    }
  
    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const res = await stub.fetch(new Request('http://do/runners'));
    if (!res.ok) {
      return c.json({ error: 'Failed to fetch runners' }, 500);
    }
  
    const data = await res.json() as { runners: any[] };
    const mappedRunners = data.runners.map(r => ({
      ...r,
      isMine: userPublicKey && r.publicKey === userPublicKey,
    }));
  
    return c.json({ runners: mappedRunners });
  });
  
  // Client WebSocket Events Proxy
  app.get('/api/runs/:id/events', async (c) => {
    const upgradeHeader = c.req.header('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }
  
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const { authorized, error } = await checkScanMembership(c, runId, userId);
      if (!authorized) return error;
    }
  
    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const req = new Request(c.req.raw.url, c.req.raw);
    const url = new URL(req.url);
    url.pathname = '/connect-client';
    url.searchParams.set('runId', runId);
    return stub.fetch(new Request(url.toString(), req));
  });
  
  app.post('/api/runs', async (c) => {
    const body = await c.req.json();
  
    if (c.env.LIMIT_ANONYMOUS === 'true' && isWebRequest(c)) {
      const isAnon = await isAnonymousUser(c);
      if (isAnon) {
        let endpointCount = 0;
        const config = body.config || {};
        const endpoints = config.endpoints;
        if (endpoints) {
          if (Array.isArray(endpoints)) {
            endpointCount = endpoints.length;
          } else if (Array.isArray(endpoints.include)) {
            endpointCount = endpoints.include.length;
          }
        }
        if (endpointCount > 50) {
          return c.json({ error: 'Anonymous limit reached: You can only scan up to 50 endpoints.' }, 403);
        }
      }
    }
  
    let userPublicKey = "";
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      if (body.projectId) {
        const { authorized, error } = await checkProjectMembership(c, body.projectId, userId);
        if (!authorized) return error;
      }
  
      try {
        const user = await c.env.DB.prepare('SELECT public_key FROM users WHERE id = ?')
          .bind(userId)
          .first<{ public_key: string | null }>();
        if (user && user.public_key) {
          userPublicKey = user.public_key;
        }
      } catch (dbErr) {
        console.error("Failed to query user public key in /api/runs:", dbErr);
      }
    }
  
    const runId = crypto.randomUUID();
  
    // Insert the scan record in D1 DB so that checkScanMembership (ownership/membership verification) succeeds
    const projectId = body.projectId || "";
    const targetUrl = body.config?.base_url || "";
    const profile = (body.config?.profiles && body.config.profiles[0]) || "default";
    const status = 'queued';

    try {
      await c.env.DB.prepare(
        `INSERT INTO scans (id, project_id, target_url, profile, status, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(runId, projectId, targetUrl, profile, status, userId ?? null)
        .run();
    } catch (dbErr) {
      console.error("Failed to insert scan into D1 in /api/runs:", dbErr);
    }

    // Send to SCAN_QUEUE instead of immediately fetching /dispatch on COORDINATOR_DO
    await c.env.SCAN_QUEUE.send({
      runId,
      config: body.config || {},
      userPublicKey,
      targetUrl,
      profile,
      projectId,
      userId: userId ?? null
    });
  
    return c.json({ id: runId, status: 'queued' }, 201);
  });
  
  app.post('/api/runs/:id/stop', async (c) => {
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const { authorized, error } = await checkScanMembership(c, runId, userId);
      if (!authorized) return error;
    }
  
    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const doReq = new Request('http://do/command', {
      method: 'POST',
      body: JSON.stringify({ runId, command: 'stop' }),
    });
    await stub.fetch(doReq);
    return c.json({ status: 'stopped' });
  });
  
  app.post('/api/runs/:id/pause', async (c) => {
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const { authorized, error } = await checkScanMembership(c, runId, userId);
      if (!authorized) return error;
    }
  
    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const doReq = new Request('http://do/command', {
      method: 'POST',
      body: JSON.stringify({ runId, command: 'pause' }),
    });
    await stub.fetch(doReq);
    return c.json({ status: 'paused' });
  });
  
  app.post('/api/runs/:id/resume', async (c) => {
    const runId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const { authorized, error } = await checkScanMembership(c, runId, userId);
      if (!authorized) return error;
    }
  
    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const doReq = new Request('http://do/command', {
      method: 'POST',
      body: JSON.stringify({ runId, command: 'resume' }),
    });
    await stub.fetch(doReq);
    return c.json({ status: 'resumed' });
  });

  app.post('/api/runners/:connectionId/restart', async (c) => {
    const connectionId = c.req.param('connectionId');
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Fetch user public key
    let userPublicKey = "";
    let dbFailed = false;
    try {
      const user = await c.env.DB.prepare('SELECT public_key FROM users WHERE id = ?')
        .bind(userId)
        .first<{ public_key: string | null }>();
      if (user && user.public_key) {
        userPublicKey = user.public_key;
      }
    } catch (dbErr) {
      console.error("Failed to query user public key in /api/runners/.../restart:", dbErr);
      dbFailed = true;
    }

    if (dbFailed) {
      return c.json({ error: 'Internal Server Error' }, 500);
    }

    if (!userPublicKey) {
      return c.json({ error: 'Forbidden: You do not own any runners' }, 403);
    }

    const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(id);
    const doRes = await stub.fetch(
      new Request(`http://do/runners/restart?connectionId=${encodeURIComponent(connectionId)}&userPublicKey=${encodeURIComponent(userPublicKey)}`, {
        method: 'POST'
      })
    );

    if (!doRes.ok) {
      const errMsg = await doRes.text();
      const status = doRes.status;
      return c.json({ error: errMsg || 'Failed to restart runner' }, status);
    }

    return c.json({ status: 'restarted' });
  });
  
}
