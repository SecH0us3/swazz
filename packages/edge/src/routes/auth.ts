import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, hashPassword, verifyPassword, recordFailedLogin, verifyTurnstile, checkProjectMembership, checkScanMembership, resetLoginAttempts, isWebRequest, isAnonymousUser, getClientIp, checkLoginRateLimit, deletionCache } from '../utils/auth';
import { ulid } from 'ulidx';
import { sign, verify } from 'hono/jwt';
import { cleanupExpiredGuests } from '../utils/cleanup';

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>) {
  app.post('/api/auth/register', async (c) => {
    const body = await c.req.json();
    if (!body.username || !body.password) {
      return c.json({ error: 'Missing username or password' }, 400);
    }
  
    // Turnstile verification (skip if secret not configured — local dev mode)
    const turnstileSecret = c.env.TURNSTILE_SECRET;
    if (turnstileSecret) {
      const turnstileToken = body['cf-turnstile-response'];
      if (!turnstileToken) {
        return c.json({ error: 'Missing Turnstile token' }, 403);
      }
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteip);
      if (!valid) {
        return c.json({ error: 'Turnstile verification failed' }, 403);
      }
    }
  
    const id = ulid();
    const projectId = ulid();
    const hash = await hashPassword(body.password);
    const apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
  
    try {
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO users (id, username, password_hash, api_key) VALUES (?, ?, ?, ?)')
          .bind(id, body.username, hash, apiKey),
        c.env.DB.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
          .bind(projectId),
        c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
          .bind(projectId, id)
      ]);
      return c.json({ status: 'ok', id });
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (errMsg.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'Username already exists' }, 400);
      }
      return c.json({ error: 'Registration failed due to an internal server error' }, 500);
    }
  });

  app.post('/api/auth/guest', async (c) => {
    // Proactively clean up expired guests asynchronously (non-blocking)
    try {
      c.executionCtx.waitUntil(cleanupExpiredGuests(c.env.DB));
    } catch {
      cleanupExpiredGuests(c.env.DB).catch(console.error);
    }

    const username = "g_" + crypto.randomUUID().replace(/-/g, "").substring(0, 12);
    const password = `guest_pass_${crypto.randomUUID().replace(/-/g, '')}`;
    const id = ulid();
    const projectId = ulid();
    const hash = await hashPassword(password);
    const apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');

    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO users (id, username, password_hash, api_key, is_guest, expires_at) VALUES (?, ?, ?, ?, 1, datetime('now', '+1 day'))"
        ).bind(id, username, hash, apiKey),
        c.env.DB.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
          .bind(projectId),
        c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
          .bind(projectId, id)
      ]);

      const payload = {
        sub: id,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours
      };
      
      const secret = c.env.JWT_SECRET;
      if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
      const token = await sign(payload, secret);

      return c.json({ 
        status: 'ok', 
        token, 
        username,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    } catch (err: any) {
      console.error("Failed to create guest user:", err);
      return c.json({ error: 'Failed to create guest user account' }, 500);
    }
  });
  
  app.get('/api/auth/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.substring(7);
    const secret = c.env.JWT_SECRET;
    if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
    try {
      const decoded = await verify(token, secret, "HS256");
      if (!decoded || !decoded.sub) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      const user = await c.env.DB.prepare('SELECT username, api_key, public_key, is_guest, delete_requested_at FROM users WHERE id = ?')
        .bind(decoded.sub)
        .first<{ username: string; api_key: string | null; public_key: string | null; is_guest: number; delete_requested_at: string | null }>();
      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }
      
      let currentApiKey = user.api_key;
      if (!currentApiKey) {
        currentApiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
        await c.env.DB.prepare('UPDATE users SET api_key = ? WHERE id = ?')
          .bind(currentApiKey, decoded.sub)
          .run();
      }
      
      return c.json({ 
        username: user.username, 
        api_key: currentApiKey, 
        public_key: user.public_key,
        is_guest: user.is_guest === 1,
        delete_requested_at: user.delete_requested_at
      });
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  });
  
  app.post('/api/auth/public-key', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    try {
      const body = await c.req.json();
      const publicKey = body.public_key;
      if (publicKey !== undefined && publicKey !== null && publicKey !== '') {
        // Validate hex-encoded string of length 64 (Ed25519 raw public key is 32 bytes = 64 hex characters)
        const hexRegex = /^[0-9a-fA-F]{64}$/;
        if (!hexRegex.test(publicKey)) {
          return c.json({ error: 'Invalid public key format. Must be a 64-character hex-encoded string.' }, 400);
        }
      }
  
      const val = (publicKey === '' || publicKey === null || publicKey === undefined) ? null : publicKey.toLowerCase();
      await c.env.DB.prepare('UPDATE users SET public_key = ? WHERE id = ?')
        .bind(val, userId)
        .run();
  
      return c.json({ status: 'ok', public_key: val });
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to update public key' }, 500);
    }
  });
  
  app.post('/api/auth/regenerate-key', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.substring(7);
    const secret = c.env.JWT_SECRET;
    if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
    try {
      const decoded = await verify(token, secret, "HS256");
      if (!decoded || !decoded.sub) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      const newApiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
      await c.env.DB.prepare('UPDATE users SET api_key = ? WHERE id = ?')
        .bind(newApiKey, decoded.sub)
        .run();
      return c.json({ api_key: newApiKey });
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  });
  
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json();
    if (!body.username || !body.password) {
      return c.json({ error: 'Missing username or password' }, 400);
    }
  
    // Turnstile verification (skip if secret not configured — local dev mode)
    const turnstileSecret = c.env.TURNSTILE_SECRET;
    if (turnstileSecret) {
      const turnstileToken = body['cf-turnstile-response'];
      if (!turnstileToken) {
        return c.json({ error: 'Missing Turnstile token' }, 403);
      }
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteip);
      if (!valid) {
        return c.json({ error: 'Turnstile verification failed' }, 403);
      }
    }
  
    // Rate-limit check
    const rateLimit = await checkLoginRateLimit(c.env.DB, body.username);
    if (rateLimit.locked) {
      return c.json(
        { error: 'Account temporarily locked due to too many failed attempts', retry_after: rateLimit.retryAfter },
        429
      );
    }
  
    const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .bind(body.username)
      .first<{ id: string; password_hash: string }>();
  
    if (!user) {
      await recordFailedLogin(c.env.DB, body.username);
      return c.json({ error: 'Invalid credentials' }, 401);
    }
  
    const valid = await verifyPassword(body.password, user.password_hash);
    
    if (!valid) {
      await recordFailedLogin(c.env.DB, body.username);
      return c.json({ error: 'Invalid credentials' }, 401);
    }
  
    // Successful login — reset rate-limit counter
    await resetLoginAttempts(c.env.DB, body.username);
  
    const payload = {
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
    };
    
    const secret = c.env.JWT_SECRET;
    if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
    const token = await sign(payload, secret);
  
    return c.json({ status: 'ok', token });
  });
  
  app.delete('/api/users/me', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      await c.env.DB.prepare('UPDATE users SET delete_requested_at = datetime(\'now\') WHERE id = ?')
        .bind(userId)
        .run();

      deletionCache.delete(userId);

      // Terminate active scans for this user
      await c.env.DB.prepare(`
        UPDATE scans
        SET status = 'failed', completed_at = datetime('now')
        WHERE (user_id = ? OR project_id IN (
          SELECT pm.project_id FROM project_members pm
          WHERE pm.user_id = ? AND pm.role = 'owner'
        )) AND completed_at IS NULL
      `)
        .bind(userId, userId)
        .run();

      // Immediately revoke and disconnect active runner WebSocket connections in Durable Object
      try {
        const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = c.env.COORDINATOR_DO.get(doId);
        const doRes = await stub.fetch(new Request(`http://do/revoke-user?userId=${userId}`, {
          method: 'POST'
        }));
        if (!doRes.ok) {
          console.error("Failed to revoke runner connections in DO on schedule deletion:", await doRes.text());
        }
      } catch (doErr) {
        console.error("Failed to invoke DO /revoke-user on schedule deletion:", doErr);
      }

      return c.json({ status: 'deletion_scheduled', eta_days: 7 });
    } catch (err: any) {
      console.error("Failed to schedule user account deletion:", err);
      return c.json({ error: err.message || 'Failed to schedule user account deletion' }, 500);
    }
  });

  app.post('/api/users/me/cancel-deletion', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      await c.env.DB.prepare('UPDATE users SET delete_requested_at = NULL WHERE id = ?')
        .bind(userId)
        .run();

      deletionCache.delete(userId);

      return c.json({ status: 'deletion_cancelled' });
    } catch (err: any) {
      console.error("Failed to cancel user account deletion:", err);
      return c.json({ error: err.message || 'Failed to cancel deletion' }, 500);
    }
  });
}
