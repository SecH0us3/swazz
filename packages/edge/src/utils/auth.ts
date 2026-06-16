import { verify } from 'hono/jwt';
import { Env } from '../env';
import { Context } from 'hono';

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
    try {
      const user = await c.env.DB.prepare('SELECT id FROM users WHERE api_key = ?')
        .bind(token)
        .first<{ id: string }>();
      return user ? user.id : null;
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
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, expectedHashHex] = storedHash.split(':');
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
      iterations: 100000,
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

export async function checkScanMembership(c: Context<{ Bindings: Env }>, scanId: string, userId: string): Promise<{ authorized: boolean; error?: any }> {
  const scan = await c.env.DB.prepare('SELECT project_id FROM scans WHERE id = ?')
    .bind(scanId)
    .first<{ project_id: string }>();
    
  if (!scan) {
    return { authorized: false, error: c.json({ error: 'Run/Scan not found' }, 404) };
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
