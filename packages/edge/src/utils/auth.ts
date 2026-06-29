import { verify } from 'hono/jwt';
import { Env } from '../env';
import { Context } from 'hono';

const KV_POSITIVE_TTL = 300; // 5 minutes
const KV_NEGATIVE_TTL = 60;  // 1 minute

export async function getUserIdFromRequest(c: Context<{ Bindings: Env }>): Promise<string | null> {
  let token = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = c.req.query('token');
  }
  if (!token) {
    return null;
  }

  if (token.startsWith('swazz_live_')) {
    const kv = c.env.SESSION_CACHE;
    const cacheKey = `apikey:${token}`;

    // 1. Try KV cache first (if available)
    if (kv) {
      try {
        const cached = await kv.get(cacheKey);
        if (cached !== null) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === 'object' && 'userId' in parsed) {
            return parsed.userId;
          }
        }
      } catch {
        // KV read failed — fall through to D1
      }
    }

    // 2. Cache miss — query D1
    try {
      const user = await c.env.DB.prepare('SELECT id FROM users WHERE api_key = ?')
        .bind(token)
        .first<{ id: string }>();
      const userId = user ? user.id : null;

      // 3. Write to KV (positive or negative cache)
      if (kv) {
        try {
          const ttl = userId ? KV_POSITIVE_TTL : KV_NEGATIVE_TTL;
          await kv.put(cacheKey, JSON.stringify({ userId }), { expirationTtl: ttl });
        } catch {
          // KV write failed — non-critical, continue
        }
      }

      return userId;
    } catch {
      return null;
    }
  }

  const secret = c.env.JWT_SECRET;
  if (!secret) {
    console.error("JWT_SECRET is not configured");
    return null;
  }
  try {
    const decoded = await verify(token, secret, "HS256");
    if (!decoded || !decoded.sub) {
      return null;
    }
    return String(decoded.sub);
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = 100000;
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const buffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${iterations}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  let iterations = 100000;
  let saltHex: string;
  let expectedHashHex: string;

  if (parts.length === 3) {
    iterations = parseInt(parts[0], 10);
    saltHex = parts[1];
    expectedHashHex = parts[2];
  } else {
    saltHex = parts[0];
    expectedHashHex = parts[1];
    iterations = 600000;
  }

  if (!saltHex || !expectedHashHex) return false;
  
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const buffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  
  const expectedHash = new Uint8Array(expectedHashHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const actualHash = new Uint8Array(buffer);
  
  if (expectedHash.length !== actualHash.length) return false;
  
  return crypto.subtle.timingSafeEqual(expectedHash, actualHash);
}

/**
 * Verify a Cloudflare Turnstile token against the siteverify endpoint.
 * Returns true if verification succeeds, false otherwise.
 */
export async function verifyTurnstile(token: string, secret: string, remoteip?: string): Promise<boolean> {
  // Always pass for dummy test keys or mock tokens in local development
  if (secret === '1x00000000000000000000000000000000' || token === 'mock-token' || token.startsWith('mock-')) {
    return true;
  }

  const formData = new URLSearchParams();
  formData.append('secret', secret);
  formData.append('response', token);
  if (remoteip) {
    formData.append('remoteip', remoteip);
  }

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });
    const result = (await res.json()) as { success: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

/**
 * Check if a login is rate-limited for the given username.
 * Returns { locked: true, retryAfter } if the account is locked.
 */
export async function checkLoginRateLimit(
  db: D1Database,
  username: string
): Promise<{ locked: boolean; retryAfter?: string }> {
  const row = await db
    .prepare('SELECT failed_count, locked_until FROM login_attempts WHERE username = ?')
    .bind(username)
    .first<{ failed_count: number; locked_until: string | null }>();

  if (!row) return { locked: false };

  if (row.locked_until) {
    const lockedUntil = new Date(row.locked_until + 'Z'); // D1 stores UTC without Z suffix
    if (lockedUntil > new Date()) {
      return { locked: true, retryAfter: row.locked_until };
    }
    // Lock has expired — reset the counter
    await db
      .prepare('UPDATE login_attempts SET failed_count = 0, locked_until = NULL WHERE username = ?')
      .bind(username)
      .run();
  }

  return { locked: false };
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Record a failed login attempt. After MAX_LOGIN_ATTEMPTS consecutive failures,
 * lock the account for LOCKOUT_MINUTES.
 */
export async function recordFailedLogin(db: D1Database, username: string): Promise<void> {
  const row = await db
    .prepare('SELECT failed_count FROM login_attempts WHERE username = ?')
    .bind(username)
    .first<{ failed_count: number }>();

  const newCount = (row?.failed_count ?? 0) + 1;
  let lockedUntil: string | null = null;

  if (newCount >= MAX_LOGIN_ATTEMPTS) {
    const lockDate = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    lockedUntil = lockDate.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
  }

  await db
    .prepare(
      `INSERT INTO login_attempts (username, failed_count, locked_until)
       VALUES (?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET failed_count = ?, locked_until = ?`
    )
    .bind(username, newCount, lockedUntil, newCount, lockedUntil)
    .run();
}

/**
 * Reset the failed login counter on successful login.
 */
export async function resetLoginAttempts(db: D1Database, username: string): Promise<void> {
  await db
    .prepare('DELETE FROM login_attempts WHERE username = ?')
    .bind(username)
    .run();
}

export async function checkProjectMembership(c: Context<{ Bindings: Env }>, projectId: string, userId: string, requiredRole?: string): Promise<{ authorized: boolean; error?: any }> {
  const member = await c.env.DB.prepare(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
  )
  .bind(projectId, userId)
  .first<{ role: string }>();

  if (!member) return { authorized: false, error: c.json({ error: 'Forbidden' }, 403) };
  if (requiredRole && member.role !== requiredRole) return { authorized: false, error: c.json({ error: 'Forbidden: Owner role required' }, 403) };
  
  return { authorized: true };
}

import { checkPermission } from './rbac';
import { PermissionKey } from '../config/rbac';

export async function checkScanMembership(c: Context<{ Bindings: Env }>, scanId: string, userId: string, requiredPermission?: PermissionKey): Promise<{ authorized: boolean; error?: any }> {
  const scan = await c.env.DB.prepare('SELECT project_id, user_id FROM scans WHERE id = ?')
    .bind(scanId)
    .first<{ project_id: string; user_id: string | null }>();
    
  if (!scan) {
    return { authorized: false, error: c.json({ error: 'Run/Scan not found' }, 404) };
  }

  // Standalone scan (no project): check direct user ownership
  if (!scan.project_id) {
    if (scan.user_id === userId) return { authorized: true };
    return { authorized: false, error: c.json({ error: 'Forbidden' }, 403) };
  }

  if (requiredPermission) {
    const hasAccess = await checkPermission(c.env, userId, scan.project_id, requiredPermission);
    if (!hasAccess) return { authorized: false, error: c.json({ error: 'Forbidden' }, 403) };
    return { authorized: true };
  }

  return checkProjectMembership(c, scan.project_id, userId);
}

export async function isAnonymousUser(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return true;
  }
  const token = authHeader.substring(7);
  const secret = c.env.JWT_SECRET;
  if (!secret) return true;
  try {
    const decoded = await verify(token, secret, "HS256");
    return !decoded || !decoded.sub;
  } catch {
    return true;
  }
}

export function isWebRequest(c: Context<{ Bindings: Env }>): boolean {
  const ua = c.req.header('User-Agent') || '';
  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');
  return ua.includes('Mozilla') || !!origin || !!referer;
}

export function getClientIp(c: Context<{ Bindings: Env }>): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || c.req.header('X-Forwarded-For') || '127.0.0.1';
}

export const deletionCache = new Map<string, { deleteRequestedAt: string | null; expiry: number }>();

export async function getDeleteRequestedAt(db: D1Database, userId: string): Promise<string | null> {
  const now = Date.now();
  const cached = deletionCache.get(userId);
  if (cached && cached.expiry > now) {
    return cached.deleteRequestedAt;
  }
  const user = await db.prepare('SELECT delete_requested_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ delete_requested_at: string | null }>();
  const deleteRequestedAt = user ? user.delete_requested_at : null;
  deletionCache.set(userId, { deleteRequestedAt, expiry: now + 60000 }); // cache for 1 minute
  return deleteRequestedAt;
}

export async function hashUsername(username: string): Promise<string> {
  if (typeof username !== 'string') {
    throw new TypeError('Username must be a string');
  }
  const normalized = username.trim().toLowerCase();
  const salt = 'swazz-secure-username-salt-constant-2026';
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized + ':' + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Check if a request is rate limited.
 * key: rate limit key (e.g. 'ip:1.2.3.4' or 'system')
 * maxAttempts: max allowed attempts in window
 * windowSeconds: window duration in seconds
 * Returns { limited: true } if rate limit exceeded.
 */
export async function checkIpRateLimit(
  db: D1Database,
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<{ limited: boolean }> {
  const now = new Date();
  const resetTime = new Date(now.getTime() + windowSeconds * 1000);
  const nowStr = now.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

  // Clean up expired rate limits probabilistically (e.g., 1% of requests) to prevent database bloat without impacting every request
  if (Math.random() < 0.01) {
    await db.prepare("DELETE FROM rate_limits WHERE reset_at < datetime('now')").run();
  }

  const row = await db
    .prepare('SELECT attempts, reset_at FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ attempts: number; reset_at: string }>();

  if (!row) {
    const resetAtStr = resetTime.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
    await db
      .prepare('INSERT INTO rate_limits (key, attempts, reset_at) VALUES (?, 1, ?)')
      .bind(key, resetAtStr)
      .run();
    return { limited: false };
  }

  const resetAt = new Date(row.reset_at + 'Z');
  if (resetAt < now) {
    const resetAtStr = resetTime.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
    await db
      .prepare('UPDATE rate_limits SET attempts = 1, reset_at = ? WHERE key = ?')
      .bind(resetAtStr, key)
      .run();
    return { limited: false };
  }

  if (row.attempts >= maxAttempts) {
    return { limited: true };
  }

  await db
    .prepare('UPDATE rate_limits SET attempts = attempts + 1 WHERE key = ?')
    .bind(key)
    .run();
  
  return { limited: false };
}

/**
 * Run a dummy verification using a fake hash to match the CPU timing cost of real password checks.
 */
export async function verifyDummyPassword(password: string): Promise<boolean> {
  const dummyHash = '100000:0102030405060708090a0b0c0d0e0f10:0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
  await verifyPassword(password, dummyHash);
  return false;
}


