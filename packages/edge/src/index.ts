import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sign, verify } from 'hono/jwt';
import { ulid } from 'ulidx';

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  COORDINATOR_DO: DurableObjectNamespace;
  JWT_SECRET: string;
  TURNSTILE_SECRET?: string;
  AUTH_ENABLED?: string; // 'true' | 'false'
  LIMIT_ANONYMOUS?: string; // 'true' | 'false'
}

const app = new Hono<{ Bindings: Env }>();

async function getUserIdFromRequest(c: any): Promise<string | null> {
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
  const secret = c.env.JWT_SECRET || 'fallback-secret';
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

app.use('*', cors());

app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (
    path === '/api/info' ||
    path === '/api/payload-catalog' ||
    path.startsWith('/api/auth/') ||
    path === '/api/runners/connect' ||
    (path.startsWith('/api/scans/') && path.endsWith('/upload'))
  ) {
    return await next();
  }

  if (c.env.AUTH_ENABLED === 'true') {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  await next();
});

app.get('/api/info', (c) => {
  const authEnabled = c.env.AUTH_ENABLED === 'true';
  const limitAnonymous = c.env.LIMIT_ANONYMOUS === 'true';
  return c.json({ 
    auth_enabled: authEnabled, 
    limit_anonymous: limitAnonymous, 
    version: '1.0.0' 
  });
});
// Add Content-Signal header middleware
app.use('*', async (c, next) => {
  await next();
  c.header('Content-Signal', 'ai-train=no, search=yes');
});

app.get('/', (c) => c.json({ service: 'swazz-edge', status: 'ok' }));
app.get('/health', (c) => c.json({ service: 'swazz-edge', status: 'ok' }));

app.get('/api/payload-catalog', (c) => {
  return c.json({
  "BOUNDARY": [
    {
      "id": "boundary_strings",
      "label": "Strings",
      "description": "Empty, whitespace, long strings, Unicode, megabyte payloads",
      "count": 17
    },
    {
      "id": "boundary_integers",
      "label": "Integers",
      "description": "Min/max int8–int64, overflow, JS safe integer limits",
      "count": 14
    },
    {
      "id": "boundary_numbers",
      "label": "Floats",
      "description": "NaN, ±Infinity, denormalized, max/min float64",
      "count": 10
    },
    {
      "id": "boundary_dates",
      "label": "Dates",
      "description": "Epoch, Y2K38, far future, invalid leap-year dates",
      "count": 9
    },
    {
      "id": "boundary_booleans",
      "label": "Booleans",
      "description": "True/false, nil, string coercions (yes/no, 1/0)",
      "count": 13
    },
    {
      "id": "boundary_arrays",
      "label": "Array Sizes",
      "description": "0, 1, 100, 10 000, 100 000 element arrays",
      "count": 6
    },
    {
      "id": "boundary_uuids",
      "label": "UUIDs",
      "description": "Nil UUID, max UUID, invalid format, empty string",
      "count": 4
    }
  ],
  "MALICIOUS": [
    {
      "id": "malicious_sqli",
      "label": "SQL Injection",
      "description": "Classic SQLi, SLEEP, UNION, xp_cmdshell payloads",
      "count": 12
    },
    {
      "id": "malicious_xss",
      "label": "XSS",
      "description": "Script tags, event handlers, template injection, JS URIs",
      "count": 10
    },
    {
      "id": "malicious_path_traversal",
      "label": "Path Traversal",
      "description": "Directory traversal, /etc/passwd, URL-encoded variants",
      "count": 7
    },
    {
      "id": "malicious_encoding",
      "label": "Encoding & Null Bytes",
      "description": "Null bytes, CRLF injection, zero-width chars, BOM, RTL override",
      "count": 17
    },
    {
      "id": "malicious_numbers",
      "label": "Number Abuse",
      "description": "NaN, ±Infinity, 1e500, hex/octal/binary strings, huge integers",
      "count": 12
    },
    {
      "id": "malicious_dates",
      "label": "Date Abuse",
      "description": "Invalid dates, far-future, negative years, non-date strings",
      "count": 9
    },
    {
      "id": "malicious_booleans",
      "label": "Boolean Abuse",
      "description": "String coercions, null, empty, truthy/falsy edge cases",
      "count": 12
    },
    {
      "id": "malicious_type_confusion",
      "label": "Type Confusion",
      "description": "Wrong types: nil, arrays, objects injected where scalars expected",
      "count": 11
    },
    {
      "id": "malicious_host_injection",
      "label": "Host Injection",
      "description": "Host header manipulation for SSRF, virtual host bypass",
      "count": 8
    },
    {
      "id": "malicious_cors_misconfig",
      "label": "CORS Misconfiguration",
      "description": "Origin header fuzzing for CORS bypass detection",
      "count": 5
    },
    {
      "id": "malicious_ip_spoofing",
      "label": "IP Spoofing",
      "description": "X-Forwarded-For, X-Real-IP injection for access control bypass",
      "count": 7
    },
    {
      "id": "malicious_jwt_manipulation",
      "label": "JWT Manipulation",
      "description": "Authorization header fuzzing: alg:none, invalid tokens",
      "count": 7
    },
    {
      "id": "malicious_oob_interaction",
      "label": "OOB Interaction",
      "description": "Injects unique URLs to detect blind SSRF, XSS, and command injection",
      "count": 4
    },
    {
      "id": "malicious_cmdi",
      "label": "Command Injection",
      "description": "OS command injection payloads (e.g. ; id, | id, ; whoami, etc.)",
      "count": 8
    },
    {
      "id": "malicious_ssti",
      "label": "Server-Side Template Injection (SSTI)",
      "description": "Template injection payloads (e.g. {{7*7}}, ${7*7}, etc.)",
      "count": 6
    },
    {
      "id": "malicious_xxe",
      "label": "XML External Entity (XXE)",
      "description": "XML external entity injection payloads for local file read",
      "count": 2
    }
  ],
  "RANDOM": [
    {
      "id": "random_values",
      "label": "Random Values",
      "description": "Format-aware random strings, numbers, UUIDs, emails, dates",
      "count": -1
    }
  ]
});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
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

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
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
  const hashHex = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === expectedHashHex;
}

/**
 * Verify a Cloudflare Turnstile token against the siteverify endpoint.
 * Returns true if verification succeeds, false otherwise.
 */
async function verifyTurnstile(token: string, secret: string, remoteip?: string): Promise<boolean> {
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
    const result = await res.json<{ success: boolean }>();
    return result.success === true;
  } catch {
    return false;
  }
}

/**
 * Check if a login is rate-limited for the given username.
 * Returns { locked: true, retryAfter } if the account is locked.
 */
async function checkLoginRateLimit(
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
async function recordFailedLogin(db: D1Database, username: string): Promise<void> {
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
async function resetLoginAttempts(db: D1Database, username: string): Promise<void> {
  await db
    .prepare('DELETE FROM login_attempts WHERE username = ?')
    .bind(username)
    .run();
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

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
      return c.json({ status: 'ok', id });
    }
    return c.json({ error: 'Registration failed due to an internal server error' }, 500);
  }
});

app.get('/api/auth/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.substring(7);
  const secret = c.env.JWT_SECRET || 'fallback-secret';
  try {
    const decoded = await verify(token, secret, "HS256");
    if (!decoded || !decoded.sub) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const user = await c.env.DB.prepare('SELECT username, api_key, public_key FROM users WHERE id = ?')
      .bind(decoded.sub)
      .first<{ username: string; api_key: string | null; public_key: string | null }>();
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
    
    return c.json({ username: user.username, api_key: currentApiKey, public_key: user.public_key });
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
  const secret = c.env.JWT_SECRET || 'fallback-secret';
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
  
  const secret = c.env.JWT_SECRET || 'fallback-secret';
  const token = await sign(payload, secret);

  return c.json({ status: 'ok', token });
});

// ---------------------------------------------------------------------------
// Projects endpoints
// ---------------------------------------------------------------------------

app.get('/api/projects', async (c) => {
  const userId = await getUserIdFromRequest(c) || c.req.query('user_id');
  if (userId) {
    let { results } = await c.env.DB.prepare(`
      SELECT p.* 
      FROM projects p 
      JOIN project_members m ON p.id = m.project_id 
      WHERE m.user_id = ? 
      ORDER BY p.created_at DESC
    `).bind(userId).all<{ id: string; name: string; description: string }>();

    // Auto-create a default project if the user has none
    if (!results || results.length === 0) {
      const projectId = ulid();
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
          .bind(projectId),
        c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
          .bind(projectId, userId)
      ]);
      
      const newProject = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
      results = newProject ? [newProject] : [];
    }

    return c.json({ projects: results });
  }
  
  // Fallback: list all
  const { results } = await c.env.DB.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  return c.json({ projects: results });
});

app.post('/api/projects', async (c) => {
  const userId = await getUserIdFromRequest(c) || 'anonymous';
  const body = await c.req.json();
  const id = ulid();
  
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)')
      .bind(id, body.name, body.description || ''),
    c.env.DB.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
      .bind(id, userId, 'owner')
  ]);

  return c.json({ id, status: 'created' });
});

app.get('/api/projects/:id/config', async (c) => {
  const projectId = c.req.param('id');
  const userId = await getUserIdFromRequest(c);
  if (userId) {
    const member = await c.env.DB.prepare(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
    )
    .bind(projectId, userId)
    .first();
    if (!member) return c.json({ error: 'Forbidden' }, 403);
  }

  const result = await c.env.DB.prepare(
    "SELECT config_json FROM scan_configs WHERE project_id = ? AND name = 'default'"
  )
  .bind(projectId)
  .first<{ config_json: string }>();

  if (!result) {
    return c.json({ config: null });
  }
  return c.json({ config: JSON.parse(result.config_json) });
});

app.post('/api/projects/:id/config', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json();
  const userId = await getUserIdFromRequest(c);
  if (userId) {
    const member = await c.env.DB.prepare(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
    )
    .bind(projectId, userId)
    .first();
    if (!member) return c.json({ error: 'Forbidden' }, 403);
  }

  const configJson = JSON.stringify(body.config);
  const id = ulid();

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM scan_configs WHERE project_id = ? AND name = 'default'").bind(projectId),
    c.env.DB.prepare("INSERT INTO scan_configs (id, project_id, name, config_json) VALUES (?, ?, 'default', ?)").bind(id, projectId, configJson)
  ]);

  return c.json({ status: 'saved' });
});

app.patch('/api/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json();
  const userId = await getUserIdFromRequest(c);
  if (userId) {
    const member = await c.env.DB.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    )
    .bind(projectId, userId)
    .first<{ role: string }>();
    if (!member || member.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare(
    'UPDATE projects SET name = ?, description = ? WHERE id = ?'
  )
  .bind(body.name, body.description || '', projectId)
  .run();

  return c.json({ status: 'updated' });
});

app.delete('/api/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const userId = await getUserIdFromRequest(c);
  if (userId) {
    const member = await c.env.DB.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    )
    .bind(projectId, userId)
    .first<{ role: string }>();
    if (!member || member.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM scan_configs WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM scans WHERE project_id = ?').bind(projectId),
  ]);

  return c.json({ status: 'deleted' });
});

// ---------------------------------------------------------------------------
// Scans CRUD endpoints
// ---------------------------------------------------------------------------

app.post('/api/scans', async (c) => {
  const body = await c.req.json();
  if (!body.project_id || !body.target_url || !body.profile) {
    return c.json({ error: 'Missing required fields: project_id, target_url, profile' }, 400);
  }

  const id = ulid();
  const status = 'pending';

  await c.env.DB.prepare(
    `INSERT INTO scans (id, project_id, target_url, profile, status)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, body.project_id, body.target_url, body.profile, status)
    .run();

  // Dispatch to coordinator
  try {
    const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(doId);
    const doReq = new Request('http://do/dispatch', {
      method: 'POST',
      body: JSON.stringify({ runId: id, config: body.config || {} }),
    });
    const doRes = await stub.fetch(doReq);
    if (!doRes.ok) {
      // Update status if dispatch fails (no runners)
      await c.env.DB.prepare('UPDATE scans SET status = ? WHERE id = ?')
        .bind('dispatch_failed', id)
        .run();
      return c.json({ id, status: 'dispatch_failed', error: 'No runners available' }, 503);
    }
  } catch {
    // Coordinator may be unavailable; scan is still created
    await c.env.DB.prepare('UPDATE scans SET status = ? WHERE id = ?')
      .bind('dispatch_failed', id)
      .run();
    return c.json({ id, status: 'dispatch_failed', error: 'Failed to reach coordinator' }, 503);
  }

  return c.json({ id, status: 'dispatched' }, 201);
});

app.get('/api/scans', async (c) => {
  const projectId = c.req.query('project_id');
  if (!projectId) {
    return c.json({ error: 'Missing query parameter: project_id' }, 400);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM scans WHERE project_id = ? ORDER BY created_at DESC'
  )
    .bind(projectId)
    .all();

  return c.json({ scans: results });
});

app.get('/api/scans/:id', async (c) => {
  const scanId = c.req.param('id');
  const scan = await c.env.DB.prepare('SELECT * FROM scans WHERE id = ?')
    .bind(scanId)
    .first();

  if (!scan) {
    return c.json({ error: 'Scan not found' }, 404);
  }
  return c.json({ scan });
});

app.patch('/api/scans/:id', async (c) => {
  const scanId = c.req.param('id');
  const body = await c.req.json();

  // Verify scan exists
  const existing = await c.env.DB.prepare('SELECT id FROM scans WHERE id = ?')
    .bind(scanId)
    .first();
  if (!existing) {
    return c.json({ error: 'Scan not found' }, 404);
  }

  // Build dynamic SET clause for allowed fields
  const allowedFields = ['status', 'summary_stats', 'report_url', 'completed_at'] as const;
  const setClauses: string[] = [];
  const values: (string | null)[] = [];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (setClauses.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  values.push(scanId);
  await c.env.DB.prepare(`UPDATE scans SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM scans WHERE id = ?')
    .bind(scanId)
    .first();

  return c.json({ scan: updated });
});

// ---------------------------------------------------------------------------
// R2 Presigned Upload URL flow
// ---------------------------------------------------------------------------

/**
 * Step 1: Runner requests an upload token for a specific scan.
 * Returns a short-lived JWT (15 min) locked to the scan ID and the target R2 key.
 */
app.post('/api/scans/:id/upload-url', async (c) => {
  const scanId = c.req.param('id');

  // Verify scan exists
  const scan = await c.env.DB.prepare('SELECT id, status FROM scans WHERE id = ?')
    .bind(scanId)
    .first<{ id: string; status: string }>();
  if (!scan) {
    return c.json({ error: 'Scan not found' }, 404);
  }

  const r2Key = `reports/${scanId}.enc`;
  const secret = c.env.JWT_SECRET || 'fallback-secret';

  const uploadToken = await sign(
    {
      purpose: 'upload',
      scan_id: scanId,
      r2_key: r2Key,
      exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
    },
    secret
  );

  return c.json({
    upload_token: uploadToken,
    r2_key: r2Key,
    method: 'PUT',
    url: `/api/scans/${scanId}/upload`,
    expires_in: 900, // seconds
  });
});

/**
 * Step 2: Runner uploads the archive via PUT with the upload token.
 * Writes the body to R2 at `reports/<scan_id>.enc`.
 */
app.put('/api/scans/:id/upload', async (c) => {
  const scanId = c.req.param('id');
  const authHeader = c.req.header('X-Upload-Token');
  if (!authHeader) {
    return c.json({ error: 'Missing X-Upload-Token header' }, 401);
  }

  const secret = c.env.JWT_SECRET || 'fallback-secret';

  try {
    const decoded = await verify(authHeader, secret, "HS256") as {
      purpose: string;
      scan_id: string;
      r2_key: string;
      exp: number;
    };

    if (decoded.purpose !== 'upload' || decoded.scan_id !== scanId) {
      return c.json({ error: 'Token does not match this scan' }, 403);
    }

    const bodyStream = c.req.raw.body;
    if (!bodyStream) {
      return c.json({ error: 'Empty body' }, 400);
    }

    await c.env.STORAGE.put(decoded.r2_key, bodyStream, {
      customMetadata: {
        scan_id: scanId,
        uploaded_at: new Date().toISOString(),
      },
    });

    // Update scan record with report_url
    await c.env.DB.prepare('UPDATE scans SET report_url = ?, is_encrypted = 1 WHERE id = ?')
      .bind(decoded.r2_key, scanId)
      .run();

    return c.json({ status: 'uploaded', r2_key: decoded.r2_key });
  } catch (err: any) {
    if (err?.name === 'JwtTokenExpired' || err?.message?.includes('expired')) {
      return c.json({ error: 'Upload token expired' }, 401);
    }
    return c.json({ error: 'Invalid upload token' }, 403);
  }
});

// ---------------------------------------------------------------------------
// Coordinator WebSocket Proxy
// ---------------------------------------------------------------------------

app.get('/api/runners/connect', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const token = c.req.query('token');
  const publicKey = c.req.query('public_key');

  if (publicKey) {
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE public_key = ?')
      .bind(publicKey)
      .first();
    if (!user) {
      return new Response('Unauthorized: Invalid public key', { status: 401 });
    }
  } else if (token) {
    if (token !== 'test') {
      const user = await c.env.DB.prepare('SELECT id FROM users WHERE api_key = ?')
        .bind(token)
        .first();
      if (!user) {
        return new Response('Unauthorized: Invalid runner token', { status: 401 });
      }
    }
  } else {
    return new Response('Unauthorized: Missing token or public_key query parameter', { status: 401 });
  }

  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const req = new Request(c.req.raw.url, c.req.raw);
  const url = new URL(req.url);
  url.pathname = '/connect-runner';
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

  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const req = new Request(c.req.raw.url, c.req.raw);
  const url = new URL(req.url);
  url.pathname = '/connect-client';
  url.searchParams.set('runId', c.req.param('id'));
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

  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const doReq = new Request('http://do/dispatch', {
    method: 'POST',
    body: JSON.stringify({
      runId,
      config: body.config,
      userPublicKey,
    }),
  });
  
  const doRes = await stub.fetch(doReq);
  if (!doRes.ok) {
    return c.json({ error: 'Failed to dispatch job to runner' }, 500);
  }

  return c.json({ id: runId, status: 'dispatched' });
});

app.post('/api/runs/:id/stop', async (c) => {
  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const doReq = new Request('http://do/command', {
    method: 'POST',
    body: JSON.stringify({ runId: c.req.param('id'), command: 'stop' }),
  });
  await stub.fetch(doReq);
  return c.json({ status: 'stopped' });
});

app.post('/api/runs/:id/pause', async (c) => {
  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const doReq = new Request('http://do/command', {
    method: 'POST',
    body: JSON.stringify({ runId: c.req.param('id'), command: 'pause' }),
  });
  await stub.fetch(doReq);
  return c.json({ status: 'paused' });
});

app.post('/api/runs/:id/resume', async (c) => {
  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const doReq = new Request('http://do/command', {
    method: 'POST',
    body: JSON.stringify({ runId: c.req.param('id'), command: 'resume' }),
  });
  await stub.fetch(doReq);
  return c.json({ status: 'resumed' });
});

export default app;

// ---------------------------------------------------------------------------
// Durable Object for Coordinator
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Proxy & Fuzz Control
// ---------------------------------------------------------------------------

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
      
      // Ensure anonymous_usage table exists
      await c.env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS anonymous_usage (ip TEXT PRIMARY KEY, json_count INTEGER DEFAULT 0, scan_count INTEGER DEFAULT 0)'
      ).run();

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

export class RunnerCoordinator {
  state: DurableObjectState;
  env: Env;
  runners: Set<WebSocket>;
  clients: Map<string, Set<WebSocket>>; // runId -> client WS
  jobs: Map<string, WebSocket>; // runId -> runner WS
  pendingChallenges?: Map<WebSocket, string>; // runner WS -> challenge nonce
  pendingParses: Map<string, (r: Response) => void>;
  pendingParseUrls: Map<string, string>; // reqId -> url

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.runners = new Set();
    this.clients = new Map();
    this.jobs = new Map();
    this.pendingParses = new Map();
    this.pendingParseUrls = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/dispatch') {
      const activeRunners = Array.from(this.runners);
      if (activeRunners.length === 0) {
        return new Response('No runners available', { status: 503 });
      }
      
      const payload = await request.json() as any;
      const dispatchMsg = JSON.stringify({
        type: 'job_dispatch',
        payload,
      });

      // Prioritize picking the runner matching the user's public key
      let runner = null;
      if (payload.userPublicKey) {
        runner = activeRunners.find(r => {
          const tags = this.state.getTags(r);
          return tags.includes(payload.userPublicKey);
        });
      }
      if (!runner) {
        runner = activeRunners[0];
      }

      if (runner) {
        this.jobs.set(payload.runId, runner);
        runner.send(dispatchMsg);
        return new Response('Dispatched', { status: 200 });
      }
      return new Response('No runner could accept job', { status: 500 });
    }

    if (url.pathname === '/command') {
      const payload = await request.json() as any;
      const runner = this.jobs.get(payload.runId);
      if (runner) {
        runner.send(JSON.stringify({
          type: 'job_command',
          payload,
        }));
        return new Response('Command sent', { status: 200 });
      }
      return new Response('Runner not found for job', { status: 404 });
    }

    
    if (url.pathname === '/parse') {
      const bodyText = await request.text();
      const body = JSON.parse(bodyText) as { url: string; forceRebuild?: boolean; userPublicKey?: string };
      
      if (!body.forceRebuild) {
        try {
          const cached = await this.env.DB.prepare('SELECT base_path, endpoints_r2_key, fetched_at FROM swagger_cache WHERE url = ?')
            .bind(body.url)
            .first() as { base_path: string; endpoints_r2_key: string; fetched_at: string } | null;
            
          if (cached && cached.endpoints_r2_key) {
            const r2Object = await this.env.STORAGE.get(cached.endpoints_r2_key);
            if (r2Object) {
              const endpointsText = await r2Object.text();
              return new Response(JSON.stringify({
                basePath: cached.base_path,
                endpoints: JSON.parse(endpointsText),
                cachedAt: cached.fetched_at,
                fromCache: true
              }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
          }
        } catch (dbErr) {
          console.error("Failed to read swagger cache from DB/R2:", dbErr);
        }
      }

      const activeRunners = Array.from(this.runners);
      if (activeRunners.length === 0) return new Response(JSON.stringify({ error: "No active runners connected to Coordinator" }), { status: 503 });
      const reqId = ulid();
      this.pendingParseUrls.set(reqId, body.url);
      
      // Prioritize picking the runner matching the user's public key
      let runnerWs = null;
      if (body.userPublicKey) {
        runnerWs = activeRunners.find(r => {
          const tags = this.state.getTags(r);
          return tags.includes(body.userPublicKey!);
        });
      }
      if (!runnerWs) {
        runnerWs = activeRunners[0];
      }

      try {
        runnerWs.send(JSON.stringify({ type: 'parse_request', reqId, payload: { url: body.url } }));
      } catch (err) {
        this.pendingParseUrls.delete(reqId);
        return new Response(JSON.stringify({ error: "Failed to send parse request to runner" }), { status: 500 });
      }
      
      return new Promise<Response>((resolve) => {
        this.pendingParses.set(reqId, resolve);
        setTimeout(() => {
          if (this.pendingParses.has(reqId)) {
            this.pendingParses.delete(reqId);
            this.pendingParseUrls.delete(reqId);
            resolve(new Response(JSON.stringify({ error: "Parse timeout from Go runner" }), { status: 504 }));
          }
        }, 15000);
      });
    }

    if (url.pathname === '/start-run') {
      const runId = url.searchParams.get('runId')!;
      const configText = await request.text();
      const activeRunners = Array.from(this.runners);
      if (activeRunners.length === 0) return new Response("No runners available", { status: 503 });
      const runnerWs = activeRunners[0];
      this.jobs.set(runId, runnerWs);
      const parsedConfig = JSON.parse(configText).config;
      try {
        runnerWs.send(JSON.stringify({ type: 'start', runId, config: parsedConfig }));
      } catch (err) {
        this.jobs.delete(runId);
        return new Response("Failed to send start command to runner", { status: 500 });
      }
      return new Response("ok");
    }

    if (url.pathname === '/control-run') {
      const runId = url.searchParams.get('runId')!;
      const action = url.searchParams.get('action')!;
      const runnerWs = this.jobs.get(runId);
      if (runnerWs) {
        try {
          runnerWs.send(JSON.stringify({ type: action, runId }));
        } catch (err) {
          // ignore or log
        }
      }
      return new Response("ok");
    }

    if (url.pathname === '/runners') {
      const runnerList = [];
      for (const ws of this.runners) {
        const tags = this.state.getTags(ws);
        const isPending = tags.includes('runner-pending');
        const pubKey = tags.find(t => t !== 'runner-pending' && t !== 'runner' && !t.startsWith('name:')) || null;
        const nameTag = tags.find(t => t.startsWith('name:'));
        const name = nameTag ? nameTag.substring(5) : 'Unnamed Runner';

        runnerList.push({
          name,
          publicKey: pubKey,
          status: isPending ? 'authenticating' : 'connected',
        });
      }
      return new Response(JSON.stringify({ runners: runnerList }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/connect-runner') {
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);
      
      const publicKey = url.searchParams.get('public_key');
      const name = url.searchParams.get('name') || 'Unnamed Runner';
      const nameTag = `name:${name}`;
      
      if (publicKey) {
        this.state.acceptWebSocket(server, ["runner-pending", publicKey, nameTag]);
        
        // Generate random 32-byte hex challenge nonce
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
          
        if (!this.pendingChallenges) {
          this.pendingChallenges = new Map();
        }
        this.pendingChallenges.set(server, nonce);
        
        // Send challenge after a tiny delay to ensure client is ready to receive messages
        setTimeout(() => {
          try {
            server.send(JSON.stringify({ type: 'challenge', nonce }));
          } catch { /* ignored */ }
        }, 50);
        
        // Timeout auth after 5 seconds
        setTimeout(() => {
          try {
            if (!this.runners.has(server)) {
              server.close(1008, "Authentication timeout");
            }
          } catch { /* ignored */ }
        }, 5000);
      } else {
        this.state.acceptWebSocket(server, ["runner", nameTag]);
        this.runners.add(server);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (url.pathname === '/connect-client') {
      const runId = url.searchParams.get('runId');
      if (!runId) return new Response('Missing runId', { status: 400 });

      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);
      
      this.state.acceptWebSocket(server, ["client", runId]);
      
      if (!this.clients.has(runId)) {
        this.clients.set(runId, new Set());
      }
      this.clients.get(runId)!.add(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const tags = this.state.getTags(ws);
    
    if (tags.includes('runner-pending') && !this.runners.has(ws)) {
      try {
        const msg = JSON.parse(message as string);
        if (msg.type === 'challenge_response') {
          const nonce = this.pendingChallenges?.get(ws);
          const publicKey = tags.find(t => t !== 'runner-pending');
          if (!nonce || !publicKey) {
            ws.close(1008, "Invalid authentication state");
            return;
          }
          
          const signature = msg.signature;
          let isValid = false;
          try {
            const pubKeyBuffer = new Uint8Array(publicKey.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
            const cryptoKey = await crypto.subtle.importKey(
              "raw",
              pubKeyBuffer,
              { name: "Ed25519" },
              true,
              ["verify"]
            );
            const nonceBuffer = new TextEncoder().encode(nonce);
            const signatureBuffer = new Uint8Array(signature.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
            
            isValid = await crypto.subtle.verify(
              "Ed25519",
              cryptoKey,
              signatureBuffer,
              nonceBuffer
            );
          } catch (err) {
            console.error("Runner Ed25519 verify failed:", err);
          }
          
          if (isValid) {
            this.pendingChallenges?.delete(ws);
            this.runners.add(ws);
            ws.send(JSON.stringify({ type: 'auth_ok' }));
          } else {
            ws.send(JSON.stringify({ type: 'auth_failed', error: 'Invalid challenge signature' }));
            ws.close(1008, "Authentication failed");
          }
        }
      } catch (err) {
        console.error("Failed to process runner challenge response:", err);
        ws.close(1008, "Invalid auth request format");
      }
      return;
    }
    
    if (tags.includes('runner') || this.runners.has(ws)) {
      try {
        const msg = JSON.parse(message as string);
        
        if (msg.type === 'parse_result') {
          const resolve = this.pendingParses.get(msg.reqId);
          const urlStr = this.pendingParseUrls.get(msg.reqId);
          this.pendingParseUrls.delete(msg.reqId);
          
          if (resolve) {
            this.pendingParses.delete(msg.reqId);
            
            // Background write to DB/R2
            if (msg.payload && !msg.payload.error && urlStr) {
              const db = this.env.DB;
              const storage = this.env.STORAGE;
              
              (async () => {
                try {
                  const basePath = msg.payload.basePath || '';
                  const endpoints = msg.payload.endpoints || [];
                  const rawSpec = msg.payload.rawSpec || '';
                  const endpointsJson = JSON.stringify(endpoints);
                  
                  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpointsJson));
                  const hashArray = Array.from(new Uint8Array(hashBuffer));
                  const endpointsHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                  
                  const existing = await db.prepare('SELECT endpoints_hash, endpoints_r2_key, raw_spec_r2_key FROM swagger_cache WHERE url = ?')
                    .bind(urlStr)
                    .first() as { endpoints_hash: string; endpoints_r2_key: string; raw_spec_r2_key: string } | null;
                    
                  let endpointsR2Key = existing?.endpoints_r2_key;
                  let rawSpecR2Key = existing?.raw_spec_r2_key;
                  let shouldWriteR2 = false;
                  
                  if (!existing) {
                    endpointsR2Key = `specs/parsed/${ulid()}.json`;
                    rawSpecR2Key = `specs/raw/${ulid()}.json`;
                    shouldWriteR2 = true;
                  } else if (existing.endpoints_hash !== endpointsHash) {
                    shouldWriteR2 = true;
                  }
                  
                  if (shouldWriteR2) {
                    await storage.put(endpointsR2Key!, endpointsJson);
                    if (rawSpec) {
                      await storage.put(rawSpecR2Key!, rawSpec);
                    }
                  }
                  
                  await db.prepare('INSERT OR REPLACE INTO swagger_cache (url, base_path, endpoints_hash, endpoints_r2_key, raw_spec_r2_key, fetched_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
                    .bind(urlStr, basePath, endpointsHash, endpointsR2Key, rawSpecR2Key)
                    .run();
                } catch (cacheErr) {
                  console.error("Failed to write swagger cache in background:", cacheErr);
                }
              })();
            }

            const clientPayload = { ...msg.payload };
            if (clientPayload.rawSpec !== undefined) {
              delete clientPayload.rawSpec;
            }
            
            resolve(new Response(JSON.stringify(clientPayload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
        }
        if (msg.type === 'event' || msg.type === 'error') {
          const runId = msg.runId;
          const clientSet = this.clients.get(runId);
          if (clientSet) {
            const outMsg = JSON.stringify(msg.payload);
            for (const client of clientSet) {
              try {
                client.send(outMsg);
              } catch (e) {
                // client closed
              }
            }
          }
        }
      } catch (e) {
        console.error("Failed to parse runner message", e);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const tags = this.state.getTags(ws);
    if (tags.includes('runner') || tags.includes('runner-pending')) {
      this.runners.delete(ws);
      if (this.pendingChallenges) {
        this.pendingChallenges.delete(ws);
      }
      // Remove from jobs
      for (const [runId, r] of this.jobs.entries()) {
        if (r === ws) {
          this.jobs.delete(runId);
        }
      }
    } else if (tags.includes('client')) {
      const runId = tags.find(t => t !== 'client');
      if (runId && this.clients.has(runId)) {
        this.clients.get(runId)!.delete(ws);
        if (this.clients.get(runId)!.size === 0) {
          this.clients.delete(runId);
        }
      }
    }
  }

  async webSocketError(ws: WebSocket, error: any) {
    await this.webSocketClose(ws, 1011, "Error", false);
  }
}

async function isAnonymousUser(c: any): Promise<boolean> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return true;
  }
  const token = authHeader.substring(7);
  const secret = c.env.JWT_SECRET || 'fallback-secret';
  try {
    const decoded = await verify(token, secret, "HS256");
    return !decoded || !decoded.sub;
  } catch {
    return true;
  }
}

function isWebRequest(c: any): boolean {
  const ua = c.req.header('User-Agent') || '';
  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');
  return ua.includes('Mozilla') || !!origin || !!referer;
}

function getClientIp(c: any): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || c.req.header('X-Forwarded-For') || '127.0.0.1';
}
