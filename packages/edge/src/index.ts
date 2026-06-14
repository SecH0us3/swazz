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
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/api/info', (c) => {
  const authEnabled = c.env.AUTH_ENABLED === 'true';
  return c.json({ auth_enabled: authEnabled, version: '1.0.0' });
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
  const hash = await hashPassword(body.password);

  try {
    await c.env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .bind(id, body.username, hash)
      .run();
    return c.json({ status: 'ok', id });
  } catch (err: any) {
    const errMsg = String(err?.message || err || '');
    if (errMsg.includes('UNIQUE constraint failed')) {
      // Prevent user enumeration by returning success on duplicate username
      return c.json({ status: 'ok', id });
    }
    return c.json({ error: 'Registration failed due to an internal server error' }, 500);
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
  const userId = c.req.query('user_id');
  if (userId) {
    const { results } = await c.env.DB.prepare(`
      SELECT p.*, m.role 
      FROM projects p 
      JOIN project_members m ON p.id = m.project_id 
      WHERE m.user_id = ? 
      ORDER BY p.created_at DESC
    `).bind(userId).all();
    return c.json({ projects: results });
  }
  
  // Fallback: list all
  const { results } = await c.env.DB.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  return c.json({ projects: results });
});

app.post('/api/projects', async (c) => {
  const body = await c.req.json();
  const id = ulid();
  const userId = body.user_id || 'anonymous';
  
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)')
      .bind(id, body.name, body.description || ''),
    c.env.DB.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
      .bind(id, userId, 'owner')
  ]);

  return c.json({ id, status: 'created' });
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

    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return c.json({ error: 'Empty body' }, 400);
    }

    await c.env.STORAGE.put(decoded.r2_key, body, {
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

  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const req = new Request(c.req.raw.url, c.req.raw);
  const url = new URL(req.url);
  url.pathname = '/connect-runner';
  return stub.fetch(new Request(url.toString(), req));
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
  const runId = crypto.randomUUID();

  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const doReq = new Request('http://do/dispatch', {
    method: 'POST',
    body: JSON.stringify({
      runId,
      config: body.config,
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
  const id = c.env.COORDINATOR_DO.idFromName('global-coordinator');
  const stub = c.env.COORDINATOR_DO.get(id);
  const res = await stub.fetch(new Request('http://internal/parse', { method: 'POST', body }));
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

export class RunnerCoordinator {
  state: DurableObjectState;
  env: Env;
  runners: Set<WebSocket>;
  clients: Map<string, Set<WebSocket>>; // runId -> client WS
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
      const activeRunners = this.state.getWebSockets("runner");
      if (activeRunners.length === 0) {
        return new Response('No runners available', { status: 503 });
      }
      
      const payload = await request.json() as any;
      const dispatchMsg = JSON.stringify({
        type: 'job_dispatch',
        payload,
      });

      // Pick the first available runner
      const runner = activeRunners[0];
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
      const body = JSON.parse(bodyText) as { url: string; forceRebuild?: boolean };
      
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

      const activeRunners = this.state.getWebSockets("runner");
      if (activeRunners.length === 0) return new Response(JSON.stringify({ error: "No active runners connected to Coordinator" }), { status: 503 });
      const reqId = ulid();
      this.pendingParseUrls.set(reqId, body.url);
      
      const runnerWs = activeRunners[0];
      runnerWs.send(JSON.stringify({ type: 'parse_request', reqId, payload: { url: body.url } }));
      
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
      const activeRunners = this.state.getWebSockets("runner");
      if (activeRunners.length === 0) return new Response("No runners available", { status: 503 });
      const runnerWs = activeRunners[0];
      this.jobs.set(runId, runnerWs);
      const parsedConfig = JSON.parse(configText).config;
      runnerWs.send(JSON.stringify({ type: 'start', runId, config: parsedConfig }));
      return new Response("ok");
    }

    if (url.pathname === '/control-run') {
      const runId = url.searchParams.get('runId')!;
      const action = url.searchParams.get('action')!;
      const runnerWs = this.jobs.get(runId);
      if (runnerWs) {
        runnerWs.send(JSON.stringify({ type: action, runId }));
      }
      return new Response("ok");
    }

    if (url.pathname === '/connect-runner') {
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);
      
      this.state.acceptWebSocket(server, ["runner"]);
      this.runners.add(server);

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
    
    if (tags.includes('runner')) {
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
    if (tags.includes('runner')) {
      this.runners.delete(ws);
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
