// @ts-nocheck
import { Hono } from 'hono';
import { Env } from '../env';
import { getDB } from '../utils/db';
import { getUserIdFromRequest, hashPassword, verifyPassword, recordFailedLogin, verifyTurnstile, checkProjectMembership, checkScanMembership, resetLoginAttempts, isWebRequest, isAnonymousUser, getClientIp, checkLoginRateLimit, deletionCache, hashUsername, checkIpRateLimit, verifyDummyPassword, recordLoginHistory } from '../utils/auth';
import { ulid } from 'ulidx';
import { sign, verify } from 'hono/jwt';
import { cleanupExpiredGuests } from '../utils/cleanup';
import { generateTOTPSecret, verifyTOTP, encryptTOTPSecret, decryptTOTPSecret } from '../utils/totp';

const tempOauthCodes = new Map<string, string>();

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToArrayBuffer(base64: string) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

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
      const existing = await getDB(c.env).prepare('SELECT username_hash FROM username_registry WHERE username_hash = ?')
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
      await getDB(c.env).batch([
        getDB(c.env).prepare('INSERT INTO username_registry (username_hash) VALUES (?)')
          .bind(usernameHash),
        getDB(c.env).prepare("INSERT INTO users (id, username, password_hash, api_key, email, plan) VALUES (?, ?, ?, ?, ?, 'Free')")
          .bind(id, username, hash, apiKey, email),
        getDB(c.env).prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
          .bind(projectId),
        getDB(c.env).prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
          .bind(projectId, id)
      ]);

      await recordLoginHistory(getDB(c.env), id, 'success', c);

      const payload = {
        sub: id,
        iat: Math.floor(Date.now() / 1000),
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
    const ipRateLimit = await checkIpRateLimit(getDB(c.env), `ip-guest:${clientIp}`, 30, 60);
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
    await getDB(c.env).prepare(
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
      c.executionCtx.waitUntil(cleanupExpiredGuests(getDB(c.env)));
    } catch {
      cleanupExpiredGuests(getDB(c.env)).catch(console.error);
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
    const challengeRow = await getDB(c.env).prepare(
      'SELECT challenge, difficulty, expires_at FROM login_challenges WHERE token = ? AND username = ?'
    )
    .bind(challengeToken, 'guest_temp')
    .first<{ challenge: string; difficulty: number; expires_at: string }>();

    if (!challengeRow) {
      return c.json({ error: 'Invalid or expired challenge token' }, 400);
    }

    // Delete token immediately to prevent replay attacks
    await getDB(c.env).prepare('DELETE FROM login_challenges WHERE token = ?')
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
      await getDB(c.env).batch([
        getDB(c.env).prepare(
          "INSERT INTO users (id, username, password_hash, api_key, is_guest, expires_at, plan) VALUES (?, ?, ?, ?, 1, datetime('now', '+1 day'), 'Free')"
        ).bind(id, username, hash, apiKey),
        getDB(c.env).prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
          .bind(projectId),
        getDB(c.env).prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
          .bind(projectId, id)
      ]);

      const payload = {
        sub: id,
        iat: Math.floor(Date.now() / 1000),
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
      const user = await getDB(c.env).prepare('SELECT username, api_key, public_key, is_guest, delete_requested_at, two_factor_enabled, plan, github_id FROM users WHERE id = ?')
        .bind(decoded.sub)
        .first<{ username: string; api_key: string | null; public_key: string | null; is_guest: number; delete_requested_at: string | null; two_factor_enabled: number; plan: string | null; github_id: string | null }>();
      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }
      
      let currentApiKey = user.api_key;
      if (!currentApiKey) {
        currentApiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
        await getDB(c.env).prepare('UPDATE users SET api_key = ? WHERE id = ?')
          .bind(currentApiKey, decoded.sub)
          .run();
      }
      
      return c.json({ 
        username: user.username, 
        api_key: currentApiKey, 
        public_key: user.public_key,
        is_guest: user.is_guest === 1,
        delete_requested_at: user.delete_requested_at,
        two_factor_enabled: user.two_factor_enabled === 1,
        plan: user.plan || 'Free',
        github_id: user.github_id || null
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
      await getDB(c.env).prepare('UPDATE users SET public_key = ? WHERE id = ?')
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
      const oldUser = await getDB(c.env).prepare('SELECT api_key FROM users WHERE id = ?')
        .bind(decoded.sub)
        .first<{ api_key: string | null }>();

      if (!oldUser) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const newApiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
      await getDB(c.env).prepare('UPDATE users SET api_key = ? WHERE id = ?')
        .bind(newApiKey, decoded.sub)
        .run();

      // Invalidate old key and proactively cache new key in KV
      const kv = c.env.SESSION_CACHE;
      if (kv) {
        try {
          if (oldUser?.api_key) {
            await kv.delete(`apikey:${oldUser.api_key}`);
          }
          await kv.put(`apikey:${newApiKey}`, JSON.stringify({ userId: String(decoded.sub) }), { expirationTtl: 300 });
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
    const ipRateLimit = await checkIpRateLimit(getDB(c.env), `ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }
    
    // Global system rate limit check (max 100 requests per minute)
    const systemRateLimit = await checkIpRateLimit(getDB(c.env), 'system', 100, 60);
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
    await getDB(c.env).prepare(
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
    const ipRateLimit = await checkIpRateLimit(getDB(c.env), `ip:${clientIp}`, 30, 60);
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
      const challengeRow = await getDB(c.env).prepare(
        'SELECT username, challenge, difficulty, expires_at FROM login_challenges WHERE token = ?'
      )
      .bind(body.token)
      .first<{ username: string; challenge: string; difficulty: number; expires_at: string }>();

      if (!challengeRow) {
        return c.json({ error: 'Session expired or invalid login token' }, 401);
      }

      // Delete token immediately to prevent replay attacks
      await getDB(c.env).prepare('DELETE FROM login_challenges WHERE token = ?').bind(body.token).run();

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

    const user = await getDB(c.env).prepare('SELECT id, password_hash, two_factor_enabled, two_factor_secret FROM users WHERE username = ?')
      .bind(username)
      .first<{ id: string; password_hash: string; two_factor_enabled: number; two_factor_secret: string | null }>();

    // Check username rate limits
    const rateLimit = await checkLoginRateLimit(getDB(c.env), username);
    if (rateLimit.locked) {
      if (user) {
        await recordLoginHistory(getDB(c.env), user.id, 'locked', c);
      }
      return c.json(
        { error: 'Account temporarily locked due to too many failed attempts', retry_after: rateLimit.retryAfter },
        429
      );
    }

    if (!user) {
      // User doesn't exist: run dummy verify and inject timing-delay to prevent username enumeration
      await verifyDummyPassword(body.password);
      await recordFailedLogin(getDB(c.env), username);
      await enforceUniformDelay(startTime);
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      await recordFailedLogin(getDB(c.env), username);
      await recordLoginHistory(getDB(c.env), user.id, 'failed_password', c);
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
        await recordFailedLogin(getDB(c.env), username);
        await recordLoginHistory(getDB(c.env), user.id, 'failed_password', c);
        await enforceUniformDelay(startTime);
        return c.json({ error: 'Invalid credentials' }, 401);
      }
      const isValid2fa = await verifyTOTP(decryptedSecret, body.two_factor_code);
      if (!isValid2fa) {
        await recordFailedLogin(getDB(c.env), username);
        await recordLoginHistory(getDB(c.env), user.id, 'failed_2fa', c);
        await enforceUniformDelay(startTime);
        return c.json({ error: 'Invalid credentials' }, 401);
      }
    }

    // Successful login — reset rate-limit counter
    await resetLoginAttempts(getDB(c.env), username);
    await recordLoginHistory(getDB(c.env), user.id, 'success', c);

    const payload = {
      sub: user.id,
      iat: Math.floor(Date.now() / 1000),
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
      await getDB(c.env).prepare('UPDATE users SET delete_requested_at = datetime(\'now\') WHERE id = ?')
        .bind(userId)
        .run();

      deletionCache.delete(userId);

      // Terminate active scans for this user
      await getDB(c.env).prepare(`
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
        }) as any);
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
      await getDB(c.env).prepare('UPDATE users SET delete_requested_at = NULL WHERE id = ?')
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

      const user = await getDB(c.env).prepare('SELECT username, password_hash, two_factor_enabled FROM users WHERE id = ?')
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
      
      await getDB(c.env).prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?')
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

      const user = await getDB(c.env).prepare('SELECT password_hash, two_factor_secret FROM users WHERE id = ?')
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

      await getDB(c.env).prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = ?')
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

      const user = await getDB(c.env).prepare('SELECT password_hash, two_factor_secret, two_factor_enabled FROM users WHERE id = ?')
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

      await getDB(c.env).prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?')
        .bind(userId)
        .run();

      return c.json({ status: 'ok' });
    } catch (err: any) {
      console.error("Failed to disable 2FA:", err);
      return c.json({ error: err.message || 'Failed to disable 2FA' }, 500);
    }
  });

  app.post('/api/auth/passkeys/register/generate-options', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const user = await getDB(c.env).prepare('SELECT username FROM users WHERE id = ?').bind(userId).first<{username: string}>();
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
    const rpID = new URL(requestOrigin).hostname;
    const encoder = new TextEncoder();
    const userIDBytes = encoder.encode(userId);

    const passkeys = await getDB(c.env).prepare('SELECT credential_id FROM passkeys WHERE user_id = ?').bind(userId).all<{credential_id: string}>();
    const excludeCredentials = passkeys.results.map(pk => ({
      id: pk.credential_id,
      type: 'public-key' as const,
      transports: [],
    }));

    const options = await generateRegistrationOptions({
      rpName: 'Swazz',
      rpID,
      userID: userIDBytes as any,
      userName: user.username,
      userDisplayName: user.username,
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
    });

    if (!c.env.SESSION_CACHE) {
      return c.json({ error: 'Internal server error: SESSION_CACHE is not configured' }, 500);
    }
    await c.env.SESSION_CACHE.put("passkey_challenge:" + userId, options.challenge, { expirationTtl: 300 });

    return c.json(options);
  });

  app.post('/api/auth/passkeys/register/verify', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const body = await c.req.json();

    let expectedChallenge = '';
    if (c.env.SESSION_CACHE) {
      expectedChallenge = await c.env.SESSION_CACHE.get("passkey_challenge:" + userId) || '';
      await c.env.SESSION_CACHE.delete("passkey_challenge:" + userId);
    }

    if (!expectedChallenge) {
      return c.json({ error: 'Challenge expired or not found' }, 400);
    }

    const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
    const expectedOrigin = requestOrigin;
    const rpID = new URL(requestOrigin).hostname;

    try {
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        
        const credential_id = credential.id;
        const public_key = arrayBufferToBase64(credential.publicKey);
        const counter = credential.counter;
        const device_type = credentialDeviceType;
        const backed_up = credentialBackedUp ? 1 : 0;
        const transports = body.response.transports ? body.response.transports.join(',') : '';

        const webauthn_user_id = arrayBufferToBase64(new TextEncoder().encode(userId));

        await getDB(c.env).prepare(`
          INSERT INTO passkeys (credential_id, user_id, public_key, webauthn_user_id, counter, device_type, backed_up, transports)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(credential_id, userId, public_key, webauthn_user_id, counter, device_type, backed_up, transports).run();

        return c.json({ status: 'ok', verified: true });
      } else {
        return c.json({ error: 'Verification failed' }, 400);
      }
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.post('/api/auth/passkeys/login/generate-options', async (c) => {
    const clientIp = getClientIp(c);
    const ipRateLimit = await checkIpRateLimit(getDB(c.env), `ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    const body = await c.req.json();
    if (typeof body.username !== 'string') {
      return c.json({ error: 'Invalid or missing username' }, 400);
    }
    const username = body.username.trim();

    const user = await getDB(c.env).prepare('SELECT id FROM users WHERE username = ?').bind(username).first<{id: string}>();
    if (!user) {
      await new Promise(r => setTimeout(r, 200));
      return c.json({ error: 'User not found' }, 404);
    }

    const passkeys = await getDB(c.env).prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').bind(user.id).all<{credential_id: string, transports: string}>();
    
    if (!passkeys.results || passkeys.results.length === 0) {
      await new Promise(r => setTimeout(r, 200));
      return c.json({ error: 'No passkeys found for user' }, 404);
    }

    const allowCredentials = passkeys.results.map(pk => ({
      id: pk.credential_id,
      type: 'public-key' as const,
      transports: pk.transports ? (pk.transports.split(',')) as any : undefined,
    }));

    const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
    const rpID = new URL(requestOrigin).hostname;
    
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    if (!c.env.SESSION_CACHE) {
      return c.json({ error: 'Internal server error: SESSION_CACHE is not configured' }, 500);
    }
    await c.env.SESSION_CACHE.put("passkey_login:" + user.id, options.challenge, { expirationTtl: 300 });

    return c.json(options);
  });

  app.post('/api/auth/passkeys/login/verify', async (c) => {
    const clientIp = getClientIp(c);
    const ipRateLimit = await checkIpRateLimit(getDB(c.env), `ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    const body = await c.req.json();
    const credential_id = body.id;
    if (typeof credential_id !== 'string') {
       return c.json({ error: 'Invalid or missing credential ID' }, 400);
    }

    const pk = await getDB(c.env).prepare('SELECT user_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?').bind(credential_id).first<{user_id: string, public_key: string, counter: number, transports: string}>();
    
    if (!pk) {
      return c.json({ error: 'Credential not found' }, 404);
    }

    let expectedChallenge = '';
    if (c.env.SESSION_CACHE) {
      expectedChallenge = await c.env.SESSION_CACHE.get("passkey_login:" + pk.user_id) || '';
      await c.env.SESSION_CACHE.delete("passkey_login:" + pk.user_id);
    }

    if (!expectedChallenge) {
      return c.json({ error: 'Challenge expired or not found' }, 400);
    }

    const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
    const expectedOrigin = requestOrigin;
    const rpID = new URL(requestOrigin).hostname;

    try {
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: {
          id: credential_id,
          publicKey: base64ToArrayBuffer(pk.public_key),
          counter: pk.counter,
          transports: pk.transports ? pk.transports.split(',') as any : undefined,
        }
      });

      if (verification.verified && verification.authenticationInfo) {
        const { newCounter } = verification.authenticationInfo;
        await getDB(c.env).prepare('UPDATE passkeys SET counter = ? WHERE credential_id = ?').bind(newCounter, credential_id).run();

        const user = await getDB(c.env).prepare('SELECT username FROM users WHERE id = ?').bind(pk.user_id).first<{username: string}>();
        if (user) {
            await resetLoginAttempts(getDB(c.env), user.username);
        }

        const payload = {
          sub: pk.user_id,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
        };
        const secret = c.env.JWT_SECRET;
        if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
        const jwtToken = await sign(payload, secret);

        return c.json({ status: 'ok', token: jwtToken });
      } else {
        return c.json({ error: 'Verification failed' }, 400);
      }
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.get('/api/auth/passkeys', async (c) => {
  const userId = await getUserIdFromRequest(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const { results } = await getDB(c.env).prepare('SELECT credential_id as id, device_type, created_at FROM passkeys WHERE user_id = ?').bind(userId).all();
  return c.json(results);
});

app.delete('/api/auth/passkeys/:id', async (c) => {
  const userId = await getUserIdFromRequest(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const id = c.req.param('id');
  const { success } = await getDB(c.env).prepare('DELETE FROM passkeys WHERE credential_id = ? AND user_id = ?').bind(id, userId).run();
  if (!success) return c.json({ error: 'Failed to delete' }, 500);
  return c.json({ status: 'ok' });
});

app.post('/api/admin/users/plan', async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret) {
    return c.json({ error: 'Unauthorized: Admin secret is not configured' }, 401);
  }

  const authHeader = c.req.header('X-Admin-Secret') || c.req.header('Authorization');
  const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (providedSecret !== adminSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { username, plan } = body;
  if (!username || !plan) {
    return c.json({ error: 'Missing username or plan' }, 400);
  }

  if (plan !== 'Free' && plan !== 'Supporter Plan') {
    return c.json({ error: 'Invalid plan. Allowed plans: Free, Supporter Plan' }, 400);
  }

  const result = await getDB(c.env).prepare('UPDATE users SET plan = ? WHERE username = ?')
    .bind(plan, username)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ status: 'ok', username, plan });
});

  app.get('/api/auth/login/github', async (c) => {
    const clientId = c.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return c.json({ error: 'GitHub OAuth not configured' }, 500);
    }
    
    // Check if linking existing account
    let userId: string | null = null;
    try {
      userId = await getUserIdFromRequest(c);
    } catch {
      // Ignore, user is not logged in
    }
    
    const secret = c.env.JWT_SECRET;
    const statePayload = {
      action: userId ? 'link' : 'login',
      userId: userId || null,
      exp: Math.floor(Date.now() / 1000) + 60 * 10, // 10 minutes
    };
    const state = await sign(statePayload, secret);
    
    const requestUrl = new URL(c.req.url);
    const redirectUri = c.env.GITHUB_REDIRECT_URI || `${requestUrl.origin}/api/auth/callback/github`;
    
    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', clientId);
    githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
    githubAuthUrl.searchParams.set('scope', 'user:email');
    githubAuthUrl.searchParams.set('state', state);
    
    return c.redirect(githubAuthUrl.toString());
  });

  app.get('/api/auth/callback/github', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    
    const requestUrl = new URL(c.req.url);
    console.log('[DEBUG-OAUTH] c.req.url:', c.req.url);
    console.log('[DEBUG-OAUTH] requestUrl.hostname:', requestUrl.hostname);
    console.log('[DEBUG-OAUTH] requestUrl.port:', requestUrl.port);
    console.log('[DEBUG-OAUTH] requestUrl.origin:', requestUrl.origin);
    console.log('[DEBUG-OAUTH] ALLOWED_ORIGINS:', c.env.ALLOWED_ORIGINS);
    
    let frontendUrl = c.env.ALLOWED_ORIGINS && c.env.ALLOWED_ORIGINS !== '*' ? c.env.ALLOWED_ORIGINS.split(',')[0].trim() : '';
    if (!frontendUrl) {
      if (c.env.JWT_SECRET === 'test-secret' || requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1' || requestUrl.hostname === '[::1]' || requestUrl.hostname === '::1' || requestUrl.port === '8787') {
        frontendUrl = 'http://localhost:5173';
      } else {
        frontendUrl = requestUrl.origin;
      }
    }
    console.log('[DEBUG-OAUTH] final frontendUrl:', frontendUrl);
    frontendUrl = frontendUrl.replace(/\/$/, '');
    
    if (!code || !state) {
      return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Missing code or state')}`);
    }
    
    const secret = c.env.JWT_SECRET;
    let decodedState: any;
    try {
      decodedState = await verify(state, secret, "HS256");
    } catch (err) {
      return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Invalid or expired state')}`);
    }
    
    if (!decodedState || (decodedState.action !== 'login' && decodedState.action !== 'link')) {
      return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Invalid state payload')}`);
    }
    
    const clientId = c.env.GITHUB_CLIENT_ID;
    const clientSecret = c.env.GITHUB_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('GitHub OAuth not configured on server')}`);
    }
    
    try {
      // 1. Exchange code for access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Swazz-Edge-Coordinator',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });
      
      const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (tokenData.error || !tokenData.access_token) {
        return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Failed to exchange code: ' + (tokenData.error || 'unknown'))}`);
      }
      
      const accessToken = tokenData.access_token;
      
      // 2. Fetch user profile
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'Swazz-Edge-Coordinator',
          'Accept': 'application/json',
        },
      });
      
      const userData = (await userRes.json()) as { id?: number; login?: string; email?: string | null };
      if (!userData.id || !userData.login) {
        return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Failed to fetch GitHub profile')}`);
      }
      
      const githubId = String(userData.id);
      const githubLogin = userData.login;
      
      // 3. Fetch primary email
      let email = userData.email || null;
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `token ${accessToken}`,
            'User-Agent': 'Swazz-Edge-Coordinator',
            'Accept': 'application/json',
          },
        });
        const emailsData = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        if (Array.isArray(emailsData)) {
          const primaryEmail = emailsData.find(e => e.primary && e.verified) || emailsData.find(e => e.primary) || emailsData[0];
          if (primaryEmail) {
            email = primaryEmail.email;
          }
        }
      }
      
      const db = getDB(c.env);
      
      if (decodedState.action === 'link') {
        const userId = decodedState.userId;
        if (!userId) {
          return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Invalid user session for linking')}`);
        }
        
        // Check if already linked
        const existingLink = await db.prepare('SELECT id FROM users WHERE github_id = ?')
          .bind(githubId)
          .first<{ id: string }>();
          
        if (existingLink && existingLink.id !== userId) {
          return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('GitHub account is already linked to another user')}`);
        }
        
        await db.prepare('UPDATE users SET github_id = ? WHERE id = ?')
          .bind(githubId, userId)
          .run();
          
        return c.redirect(`${frontendUrl}/?status=github_linked`);
      } else {
        // Log in or Register
        let user = await db.prepare('SELECT id FROM users WHERE github_id = ?')
          .bind(githubId)
          .first<{ id: string }>();
          
        let userId: string;
        
        if (user) {
          userId = user.id;
        } else {
          // Check if email already exists to prevent duplicate accounts or database constraint errors
          if (email) {
            const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?')
              .bind(email)
              .first<{ id: string }>();
            if (existingUser) {
              return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('An account with this email already exists. Please log in with your password and link your GitHub account in settings.')}`);
            }
          }

          // Unique username generator (limited to 3 to 20 characters matching ^[a-zA-Z0-9_\-]{3,20}$)
          let baseUsername = githubLogin.replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 15);
          if (baseUsername.length < 3) {
            baseUsername = 'gh_' + baseUsername;
          }
          
          let username = baseUsername;
          let usernameHash = '';
          let isUnique = false;
          let attempts = 0;
          
          while (!isUnique && attempts < 10) {
            const finalUsername = attempts === 0 ? username : `${username.substring(0, 16)}_${Math.floor(Math.random() * 100)}`;
            const currentHash = await hashUsername(finalUsername);
            
            const existingReg = await db.prepare('SELECT username_hash FROM username_registry WHERE username_hash = ?')
              .bind(currentHash)
              .first<{ username_hash: string }>();
              
            if (!existingReg) {
              username = finalUsername;
              usernameHash = currentHash;
              isUnique = true;
            } else {
              attempts++;
            }
          }
          
          if (!isUnique) {
            return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Failed to generate a unique username')}`);
          }
          
          userId = ulid();
          const projectId = ulid();
          const randomPass = crypto.randomUUID() + crypto.randomUUID();
          const passwordHash = await hashPassword(randomPass);
          const apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
          
          await db.batch([
            db.prepare('INSERT INTO username_registry (username_hash) VALUES (?)')
              .bind(usernameHash),
            db.prepare("INSERT INTO users (id, username, password_hash, api_key, email, github_id, plan) VALUES (?, ?, ?, ?, ?, ?, 'Free')")
              .bind(userId, username, passwordHash, apiKey, email, githubId),
            db.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
              .bind(projectId),
            db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
              .bind(projectId, userId)
          ]);
        }
        
        // Generate JWT token
        const payload = {
          sub: userId,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
        };
        const jwtToken = await sign(payload, secret);
        
        const exchangeCode = crypto.randomUUID();
        const exchangeKey = `oauth_code:${exchangeCode}`;
        const cache = c.env.SESSION_CACHE;
        if (cache) {
          await cache.put(exchangeKey, jwtToken, { expirationTtl: 60 });
        } else {
          tempOauthCodes.set(exchangeKey, jwtToken);
          setTimeout(() => tempOauthCodes.delete(exchangeKey), 60 * 1000);
        }
        
        return c.redirect(`${frontendUrl}/?exchange_code=${exchangeCode}`);
      }
    } catch (err: any) {
      console.error('GitHub OAuth callback error:', err);
      return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Authentication failed. Please try again later.')}`);
    }
  });

  app.post('/api/auth/oauth/exchange', async (c) => {
    const body = await c.req.json();
    const code = body.code;
    if (typeof code !== 'string') {
      return c.json({ error: 'Missing code' }, 400);
    }
    
    const key = `oauth_code:${code}`;
    let token: string | null = null;
    const cache = c.env.SESSION_CACHE;
    if (cache) {
      token = await cache.get(key);
      if (token) {
        await cache.delete(key);
      }
    } else {
      token = tempOauthCodes.get(key) || null;
      if (token) {
        tempOauthCodes.delete(key);
      }
    }
    
    if (!token) {
      return c.json({ error: 'Invalid or expired exchange code' }, 400);
    }
    
    return c.json({ status: 'ok', token });
  });
}
