import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, hashPassword, verifyPassword, recordFailedLogin, verifyTurnstile, checkProjectMembership, checkScanMembership, resetLoginAttempts, isWebRequest, isAnonymousUser, getClientIp, checkLoginRateLimit, deletionCache, hashUsername, checkIpRateLimit, verifyDummyPassword } from '../utils/auth';
import { ulid } from 'ulidx';
import { sign, verify } from 'hono/jwt';
import { cleanupExpiredGuests } from '../utils/cleanup';
import { generateTOTPSecret, verifyTOTP, encryptTOTPSecret, decryptTOTPSecret } from '../utils/totp';


export function registerAuthRoutes(app: Hono<{ Bindings: Env }>) {
  app.post('/api/auth/register', async (c) => {
    const body = await c.req.json();
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      return c.json({ error: 'Missing username or password' }, 400);
    }

    const username = body.username.trim();
    const usernameRegex = /^[a-zA-Z0-9_\-]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return c.json({ error: 'Username must be 3-20 characters long and contain only letters, numbers, underscores, or hyphens' }, 400);
    }

    const password = body.password;
    if (password.length < 12) {
      return c.json({ error: 'Password must be at least 12 characters long' }, 400);
    }

    const email = typeof body.email === 'string' ? body.email.trim() : null;
    if (email !== null) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return c.json({ error: 'Invalid email format' }, 400);
      }
    }
  
    // Turnstile verification (skip if secret not configured — local dev mode)
    const turnstileSecret = c.env.TURNSTILE_SECRET;
    if (turnstileSecret && c.env.JWT_SECRET !== 'test-secret') {
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
  
    let usernameHash: string;
    try {
      usernameHash = await hashUsername(username);
      // Check if username is locked
      const existing = await c.env.DB.prepare('SELECT username_hash FROM username_registry WHERE username_hash = ?')
        .bind(usernameHash)
        .first<{ username_hash: string }>();
      if (existing) {
        return c.json({ error: 'Username already exists' }, 400);
      }
    } catch (err: any) {
      return c.json({ error: 'Registration failed due to an internal server error' }, 500);
    }
  
    const id = ulid();
    const projectId = ulid();
    const hash = await hashPassword(body.password);
    const apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
  
    try {
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO username_registry (username_hash) VALUES (?)')
          .bind(usernameHash),
        c.env.DB.prepare('INSERT INTO users (id, username, password_hash, api_key, email) VALUES (?, ?, ?, ?, ?)')
          .bind(id, username, hash, apiKey, email),
        c.env.DB.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
          .bind(projectId),
        c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
          .bind(projectId, id)
      ]);

      const payload = {
        sub: id,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
      };
      
      const secret = c.env.JWT_SECRET;
      if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
      const jwtToken = await sign(payload, secret);

      return c.json({ status: 'ok', id, token: jwtToken });
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (errMsg.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'Username already exists' }, 400);
      }
      return c.json({ error: 'Registration failed due to an internal server error' }, 500);
    }
  });

  app.post('/api/auth/guest/step1', async (c) => {
    // IP-based Rate limit check (max 30 requests per minute)
    const clientIp = getClientIp(c);
    const ipRateLimit = await checkIpRateLimit(c.env.DB, `ip-guest:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    // Turnstile verification (skip if secret not configured — local dev mode)
    const turnstileSecret = c.env.TURNSTILE_SECRET;
    let isVerified = false;
    if (turnstileSecret && c.env.JWT_SECRET !== 'test-secret') {
      const body = await c.req.json();
      const turnstileToken = body['cf-turnstile-response'];
      if (!turnstileToken) {
        return c.json({ error: 'Missing Turnstile token' }, 403);
      }
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteip);
      if (!valid) {
        return c.json({ error: 'Turnstile verification failed' }, 403);
      }
      isVerified = true;
    } else {
      isVerified = true; // Bypassed/disabled
    }

    const token = (isVerified ? 'verified_' : '') + crypto.randomUUID();
    const challenge = crypto.randomUUID();
    const difficulty = 3; // SHA-256 starts with "000"
    
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const expiryStr = expiry.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    // Save challenge with placeholder guest username
    await c.env.DB.prepare(
      'INSERT INTO login_challenges (token, username, challenge, difficulty, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(token, 'guest_temp', challenge, difficulty, expiryStr)
    .run();

    return c.json({
      status: 'ok',
      token,
      challenge,
      difficulty
    });
  });

  app.post('/api/auth/guest', async (c) => {
    // Proactively clean up expired guests asynchronously (non-blocking)
    try {
      c.executionCtx.waitUntil(cleanupExpiredGuests(c.env.DB));
    } catch {
      cleanupExpiredGuests(c.env.DB).catch(console.error);
    }

    const body = await c.req.json();
    const challengeToken = body.token;
    const nonce = body.nonce;

    if (!challengeToken || nonce === undefined) {
      return c.json({ error: 'Missing challenge token or nonce' }, 400);
    }

    // Turnstile verification (skip if secret not configured — local dev mode, or already verified in step1)
    const turnstileSecret = c.env.TURNSTILE_SECRET;
    if (turnstileSecret && c.env.JWT_SECRET !== 'test-secret' && !challengeToken.startsWith('verified_')) {
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

    // Verify Proof of Work challenge exists and is valid
    const challengeRow = await c.env.DB.prepare(
      'SELECT challenge, difficulty, expires_at FROM login_challenges WHERE token = ? AND username = ?'
    )
    .bind(challengeToken, 'guest_temp')
    .first<{ challenge: string; difficulty: number; expires_at: string }>();

    if (!challengeRow) {
      return c.json({ error: 'Invalid or expired challenge token' }, 400);
    }

    // Delete token immediately to prevent replay attacks
    await c.env.DB.prepare('DELETE FROM login_challenges WHERE token = ?')
      .bind(challengeToken)
      .run();

    const expiresAt = new Date(challengeRow.expires_at + 'Z');
    if (expiresAt.getTime() < Date.now()) {
      return c.json({ error: 'Invalid or expired challenge token' }, 400);
    }

    // Verify PoW difficulty matching target prefix
    const targetPrefix = '0'.repeat(challengeRow.difficulty);
    const dataText = challengeRow.challenge + nonce;
    
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(dataText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (!hashHex.startsWith(targetPrefix)) {
      return c.json({ error: 'Invalid Proof of Work solution' }, 403);
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
      const user = await c.env.DB.prepare('SELECT username, api_key, public_key, is_guest, delete_requested_at, two_factor_enabled FROM users WHERE id = ?')
        .bind(decoded.sub)
        .first<{ username: string; api_key: string | null; public_key: string | null; is_guest: number; delete_requested_at: string | null; two_factor_enabled: number }>();
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
        delete_requested_at: user.delete_requested_at,
        two_factor_enabled: user.two_factor_enabled === 1
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

      // Fetch old API key for KV cache invalidation
      const oldUser = await c.env.DB.prepare('SELECT api_key FROM users WHERE id = ?')
        .bind(decoded.sub)
        .first<{ api_key: string | null }>();

      if (!oldUser) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const newApiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
      await c.env.DB.prepare('UPDATE users SET api_key = ? WHERE id = ?')
        .bind(newApiKey, decoded.sub)
        .run();

      // Invalidate old key and proactively cache new key in KV
      const kv = c.env.SESSION_CACHE;
      if (kv) {
        try {
          if (oldUser?.api_key) {
            await kv.delete(`apikey:${oldUser.api_key}`);
          }
          await kv.put(`apikey:${newApiKey}`, JSON.stringify({ userId: decoded.sub }), { expirationTtl: 300 });
        } catch {
          // KV operations failed — non-critical
        }
      }

      return c.json({ api_key: newApiKey });
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  });
  app.post('/api/auth/login/step1', async (c) => {
    const clientIp = getClientIp(c);
    
    // IP-based Rate limit check (max 30 requests per minute)
    const ipRateLimit = await checkIpRateLimit(c.env.DB, `ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    
    // Global system rate limit check (max 100 requests per minute)
    const systemRateLimit = await checkIpRateLimit(c.env.DB, 'system', 100, 60);
    if (systemRateLimit.limited) {
      return c.json({ error: 'System busy. Please try again later.' }, 429);
    }

    const body = await c.req.json();
    if (!body.username) {
      return c.json({ error: 'Missing username' }, 400);
    }

    // Turnstile verification (skip if secret not configured — local dev mode)
    const turnstileSecret = c.env.TURNSTILE_SECRET;
    let isVerified = false;
    if (turnstileSecret && c.env.JWT_SECRET !== 'test-secret') {
      const turnstileToken = body['cf-turnstile-response'];
      if (!turnstileToken) {
        return c.json({ error: 'Missing Turnstile token' }, 403);
      }
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteip);
      if (!valid) {
        return c.json({ error: 'Turnstile verification failed' }, 403);
      }
      isVerified = true;
    } else {
      isVerified = true; // Bypassed/disabled
    }

    const username = body.username.trim();
    const token = (isVerified ? 'verified_' : '') + crypto.randomUUID();
    const challenge = crypto.randomUUID();
    const difficulty = 3; // SHA-256 starts with "000"
    
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const expiryStr = expiry.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    // Save challenge
    await c.env.DB.prepare(
      'INSERT INTO login_challenges (token, username, challenge, difficulty, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(token, username, challenge, difficulty, expiryStr)
    .run();

    return c.json({
      status: 'ok',
      token,
      challenge,
      difficulty
    });
  });

  app.post('/api/auth/login', async (c) => {
    const startTime = Date.now();
    const clientIp = getClientIp(c);
    
    const enforceUniformDelay = async (start: number) => {
      const elapsed = Date.now() - start;
      const targetDelay = 300;
      if (elapsed < targetDelay) {
        await new Promise(resolve => setTimeout(resolve, targetDelay - elapsed));
      }
    };

    // IP-based Rate limit check (max 30 requests per minute)
    const ipRateLimit = await checkIpRateLimit(c.env.DB, `ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    const body = await c.req.json();
    let username: string;
    
    const isTestEnv = c.env.JWT_SECRET === 'test-secret';
    
    if (isTestEnv && !body.token && body.username) {
      username = body.username;
    } else {
      if (!body.token || !body.password || body.nonce === undefined) {
        return c.json({ error: 'Missing token, password, or nonce' }, 400);
      }

      // Turnstile verification (skip if secret not configured — local dev mode, or already verified in step1)
      const turnstileSecret = c.env.TURNSTILE_SECRET;
      if (turnstileSecret && c.env.JWT_SECRET !== 'test-secret' && !body.token.startsWith('verified_')) {
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

      // Retrieve challenge
      const challengeRow = await c.env.DB.prepare(
        'SELECT username, challenge, difficulty, expires_at FROM login_challenges WHERE token = ?'
      )
      .bind(body.token)
      .first<{ username: string; challenge: string; difficulty: number; expires_at: string }>();

      if (!challengeRow) {
        return c.json({ error: 'Session expired or invalid login token' }, 401);
      }

      // Delete token immediately to prevent replay attacks
      await c.env.DB.prepare('DELETE FROM login_challenges WHERE token = ?').bind(body.token).run();

      // Check expiry
      const expiresAt = new Date(challengeRow.expires_at + 'Z');
      if (expiresAt.getTime() < Date.now()) {
        return c.json({ error: 'Session expired' }, 401);
      }

      // Verify Proof of Work
      const nonce = String(body.nonce);
      const text = challengeRow.challenge + nonce;
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      const targetPrefix = '0'.repeat(challengeRow.difficulty);
      
      if (!hashHex.startsWith(targetPrefix)) {
        return c.json({ error: 'Proof of work verification failed' }, 403);
      }

      username = challengeRow.username;
    }

    // Check username rate limits
    const rateLimit = await checkLoginRateLimit(c.env.DB, username);
    if (rateLimit.locked) {
      return c.json(
        { error: 'Account temporarily locked due to too many failed attempts', retry_after: rateLimit.retryAfter },
        429
      );
    }

    const user = await c.env.DB.prepare('SELECT id, password_hash, two_factor_enabled, two_factor_secret FROM users WHERE username = ?')
      .bind(username)
      .first<{ id: string; password_hash: string; two_factor_enabled: number; two_factor_secret: string | null }>();

    if (!user) {
      // User doesn't exist: run dummy verify and inject timing-delay to prevent username enumeration
      await verifyDummyPassword(body.password);
      await recordFailedLogin(c.env.DB, username);
      await enforceUniformDelay(startTime);
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      await recordFailedLogin(c.env.DB, username);
      await enforceUniformDelay(startTime);
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // 2FA Verification
    if (user.two_factor_enabled === 1) {
      if (!body.two_factor_code) {
        await enforceUniformDelay(startTime);
        return c.json({ status: '2fa_required' });
      }
      if (!user.two_factor_secret) {
        await enforceUniformDelay(startTime);
        return c.json({ error: 'Internal server error: 2FA configured incorrectly' }, 500);
      }
      let decryptedSecret: string;
      try {
        decryptedSecret = await decryptTOTPSecret(user.two_factor_secret, body.password);
      } catch {
        await recordFailedLogin(c.env.DB, username);
        await enforceUniformDelay(startTime);
        return c.json({ error: 'Invalid credentials' }, 401);
      }
      const isValid2fa = await verifyTOTP(decryptedSecret, body.two_factor_code);
      if (!isValid2fa) {
        await recordFailedLogin(c.env.DB, username);
        await enforceUniformDelay(startTime);
        return c.json({ error: 'Invalid credentials' }, 401);
      }
    }

    // Successful login — reset rate-limit counter
    await resetLoginAttempts(c.env.DB, username);

    const payload = {
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
    };
    
    const secret = c.env.JWT_SECRET;
    if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
    const jwtToken = await sign(payload, secret);

    await enforceUniformDelay(startTime);
    return c.json({ status: 'ok', token: jwtToken });
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

  app.post('/api/auth/2fa/setup', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const body = await c.req.json();
      if (!body.password) {
        return c.json({ error: 'Missing password verification' }, 400);
      }

      const user = await c.env.DB.prepare('SELECT username, password_hash, two_factor_enabled FROM users WHERE id = ?')
        .bind(userId)
        .first<{ username: string; password_hash: string; two_factor_enabled: number }>();

      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }

      if (user.two_factor_enabled === 1) {
        return c.json({ error: '2FA is already enabled. Disable it first.' }, 400);
      }

      // Verify Password
      const isPasswordValid = await verifyPassword(body.password, user.password_hash);
      if (!isPasswordValid) {
        return c.json({ error: 'Invalid password' }, 401);
      }

      const secret = generateTOTPSecret();
      const encryptedSecret = await encryptTOTPSecret(secret, body.password);
      
      await c.env.DB.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?')
        .bind(encryptedSecret, userId)
        .run();

      const issuer = 'Swazz';
      const otpauthUrl = `otpauth://totp/${issuer}:${user.username}?secret=${secret}&issuer=${issuer}`;

      return c.json({
        status: 'ok',
        secret,
        otpauth_url: otpauthUrl
      });
    } catch (err: any) {
      console.error("Failed to setup 2FA:", err);
      return c.json({ error: err.message || 'Failed to setup 2FA' }, 500);
    }
  });

  app.post('/api/auth/2fa/verify', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const body = await c.req.json();
      if (!body.code) {
        return c.json({ error: 'Missing 2FA code' }, 400);
      }
      if (!body.password) {
        return c.json({ error: 'Missing password verification' }, 400);
      }

      const user = await c.env.DB.prepare('SELECT password_hash, two_factor_secret FROM users WHERE id = ?')
        .bind(userId)
        .first<{ password_hash: string; two_factor_secret: string | null }>();

      if (!user || !user.two_factor_secret) {
        return c.json({ error: '2FA has not been set up. Call setup endpoint first.' }, 400);
      }

      // 1. Verify password
      const isPasswordValid = await verifyPassword(body.password, user.password_hash);
      if (!isPasswordValid) {
        return c.json({ error: 'Invalid password or 2FA code' }, 401);
      }

      // 2. Decrypt TOTP secret
      let decryptedSecret: string;
      try {
        decryptedSecret = await decryptTOTPSecret(user.two_factor_secret, body.password);
      } catch {
        return c.json({ error: 'Invalid password or 2FA code' }, 401);
      }

      // 3. Verify Code
      const isValid = await verifyTOTP(decryptedSecret, body.code);
      if (!isValid) {
        return c.json({ error: 'Invalid password or 2FA code' }, 401);
      }

      await c.env.DB.prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = ?')
        .bind(userId)
        .run();

      return c.json({ status: 'ok' });
    } catch (err: any) {
      console.error("Failed to verify 2FA:", err);
      return c.json({ error: err.message || 'Failed to verify 2FA' }, 500);
    }
  });

  app.post('/api/auth/2fa/disable', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const body = await c.req.json();
      if (!body.code) {
        return c.json({ error: 'Missing 2FA code' }, 400);
      }
      if (!body.password) {
        return c.json({ error: 'Missing password verification' }, 400);
      }

      const user = await c.env.DB.prepare('SELECT password_hash, two_factor_secret, two_factor_enabled FROM users WHERE id = ?')
        .bind(userId)
        .first<{ password_hash: string; two_factor_secret: string | null; two_factor_enabled: number }>();

      if (!user || user.two_factor_enabled !== 1 || !user.two_factor_secret) {
        return c.json({ error: '2FA is not enabled' }, 400);
      }

      // 1. Verify Password
      const isPasswordValid = await verifyPassword(body.password, user.password_hash);
      if (!isPasswordValid) {
        return c.json({ error: 'Invalid password or 2FA code' }, 401);
      }

      // 2. Decrypt TOTP secret
      let decryptedSecret: string;
      try {
        decryptedSecret = await decryptTOTPSecret(user.two_factor_secret, body.password);
      } catch {
        return c.json({ error: 'Invalid password or 2FA code' }, 401);
      }

      // 3. Verify 2FA TOTP Code
      const isValid = await verifyTOTP(decryptedSecret, body.code);
      if (!isValid) {
        return c.json({ error: 'Invalid password or 2FA code' }, 401);
      }

      await c.env.DB.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?')
        .bind(userId)
        .run();

      return c.json({ status: 'ok' });
    } catch (err: any) {
      console.error("Failed to disable 2FA:", err);
      return c.json({ error: err.message || 'Failed to disable 2FA' }, 500);
    }
  });
}
