// @ts-nocheck
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './env';
import { logInfo, logWarn, logError } from '../../common/logging/logger';
import { getUserIdFromRequest, getDeleteRequestedAt, safeCompare } from './utils/auth';
import { getDB } from './utils/db';
import { registerAuthRoutes } from './routes/auth';
import { registerProjectsRoutes } from './routes/projects';
import { registerRbacRoutes } from './routes/rbac';
import { registerScansRoutes } from './routes/scans';
import { registerRunnersRoutes } from './routes/runners';
import { registerMiscRoutes } from './routes/misc';
import { cleanupExpiredGuests, cleanupScheduledDeletions, cleanupSecurityTables } from './utils/cleanup';
import { csrfMiddleware } from './utils/csrf';

export { RunnerCoordinator } from './Coordinator';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS ? c.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : ['*'];
  const origin = c.req.header('Origin');
  
  const corsMiddleware = cors({
    origin: allowedOrigins.includes('*') ? (origin || '*') : (origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'X-CSRF-Token'],
    exposeHeaders: ['Content-Length', 'Content-Signal', 'X-CSRF-Token'],
    maxAge: 86400,
    credentials: true,
  });
  
  return await corsMiddleware(c, next);
});

app.use('/api/*', csrfMiddleware());

app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (
    path === '/api/info' ||
    path === '/api/version' ||
    path === '/api/payload-catalog' ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/admin/') ||
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

    const isCancelRoute = path === '/api/users/me/cancel-deletion' && c.req.method === 'POST';
    if (!isCancelRoute) {
      const deleteRequestedAt = await getDeleteRequestedAt(getDB(c.env, userId), userId);
      if (deleteRequestedAt !== null) {
        return c.json({ error: 'Forbidden: Account is scheduled for deletion' }, 403);
      }
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
    version: c.env.VERSION || '1.0.0',
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null
  });
});

app.get('/api/version', (c) => {
  return c.json({ version: c.env.VERSION || '1.0.0' });
});

app.get('/api/admin/logs', async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret) {
    return c.json({ error: 'Unauthorized: Admin secret is not configured' }, 401);
  }
  const authHeader = c.req.header('X-Admin-Secret') || c.req.header('Authorization');
  const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (!providedSecret || !safeCompare(providedSecret, adminSecret)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.env.SESSION_CACHE) {
    return c.json([]);
  }

  const raw = await c.env.SESSION_CACHE.get('admin:logs');
  if (!raw) return c.json([]);

  try {
    return c.json(JSON.parse(raw));
  } catch {
    return c.json([]);
  }
});
// Add Security Headers middleware

app.use('*', async (c, next) => {
  await next();
  c.header('Content-Signal', 'ai-train=no, search=yes');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' ws: wss: http: https: https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';");
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});


app.get('/', (c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/markdown')) {
    return c.text(`# Swazz: Smart API Fuzzer ⚡️

Swazz is an advanced, high-performance Smart API Fuzzer designed to identify crashes, logic flaws, and security vulnerabilities (such as XSS, SQL injection, and boundary bypassing) by automatically parsing your Swagger/OpenAPI specifications.

## 🌟 Key Features

- **Smart Payload Generation**: Automatically generates context-aware payloads based on API schema definitions (e.g., proper UUIDs, massive strings, malicious payloads).
- **Hybrid Architecture**: Fast Go-based execution engine (\`packages/container\`) paired with a modern React 19 web dashboard (\`packages/web\`).
- **Interactive Web UI**: Features a real-time Endpoint × Status heatmap, dynamic request inspector, and easy configuration management.
- **Robust CLI**: Run headless CI/CD integrations with high concurrency and detailed reporting.
- **Cloudflare Ready**: Built-in support for Edge deployment.

## 🚀 Key Commands

### Root Commands
- \`npm install\`: Install frontend dependencies.
- \`npm run dev\`: Starts the Go backend and Vite frontend concurrently.
- \`npm run build\`: Build the web dashboard.
- \`npm run deploy:web\`: Deploy the dashboard to Cloudflare Pages.

### Backend Commands (in \`packages/container\`)
- \`go run main.go serve\`: Start the HTTP API server.
- \`go run main.go start --config <path>\`: Run the fuzzer in CLI mode.
- \`go test ./...\`: Run all backend tests.

---
*Find 500 errors before your users do. Smart API fuzzing with boundary, malicious, and random payload profiles.*
`, 200, {
      'Content-Type': 'text/markdown; charset=utf-8'
    });
  }

  if (accept.includes('text/html')) {
    const requestUrl = new URL(c.req.url);
    let dashboardUrl = '/';
    if (requestUrl.port === '8787') {
      dashboardUrl = 'http://localhost:5173/';
    } else {
      const referer = c.req.header('Referer');
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          dashboardUrl = `${refererUrl.protocol}//${refererUrl.host}/`;
        } catch {}
      }
    }

    c.header('Content-Type', 'text/html; charset=utf-8');
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <title>swazz — Smart API Fuzzer</title>
</head>
<body>
  <h1>swazz — Smart API Fuzzer</h1>
  <p>To view the full interactive dashboard, please visit <a href="${dashboardUrl}">our dashboard</a>.</p>
</body>
</html>`);
  }

  return c.json({ service: 'swazz-edge', status: 'ok' });
});
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


registerAuthRoutes(app);
registerProjectsRoutes(app);
registerRbacRoutes(app);
registerScansRoutes(app);
registerRunnersRoutes(app);
registerMiscRoutes(app);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  async scheduled(event: any, env: Env, ctx: any) {
    ctx.waitUntil(cleanupExpiredGuests(getDB(env), env));
    ctx.waitUntil(cleanupScheduledDeletions(env));
    ctx.waitUntil(cleanupSecurityTables(getDB(env), env));
  },
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
    if (batch.queue === 'swazz-scan-queue') {
      for (const msg of batch.messages) {
        try {
          const doId = env.COORDINATOR_DO.idFromName('global-coordinator');
          const stub = env.COORDINATOR_DO.get(doId);
          const doReq = new Request('http://do/dispatch', {
            method: 'POST',
            body: JSON.stringify({
              runId: msg.body.runId,
              config: msg.body.config || {},
              userPublicKey: msg.body.userPublicKey || ""
            }),
          });
          const doRes = await stub.fetch(doReq as any);
          if (doRes.ok) {
            await getDB(env, msg.body.runId).prepare('UPDATE scans SET status = ? WHERE id = ?')
              .bind('dispatched', msg.body.runId)
              .run();
            msg.ack();
          } else if (doRes.status === 503) {
            // Keep status as 'queued' in D1 and acknowledge the message so that when a runner connects, the coordinator DO will pull and assign it.
            msg.ack();
          } else {
            logError(env, "Queue", `SCAN_QUEUE dispatch failed with status ${doRes.status} for run ${msg.body.runId}`);
            msg.retry();
          }
        } catch (err) {
          logError(env, "Queue", `SCAN_QUEUE dispatch failed for run ${msg.body.runId}`, { error: err });
          msg.retry();
        }
      }
    } else if (batch.queue === 'swazz-findings-queue') {
      const statements = batch.messages.map(msg => {
        const id = crypto.randomUUID();
        const { scanId, type, payload } = msg.body;
        const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return getDB(env, scanId).prepare(
          `INSERT INTO scan_events (id, scan_id, type, payload) VALUES (?, ?, ?, ?)`
        ).bind(id, scanId, type, payloadStr);
      });
      if (statements.length > 0) {
        try {
          await getDB(env).batch(statements);
          for (const msg of batch.messages) {
            msg.ack();
          }
        } catch (err) {
          logError(env, "Queue", "Failed to bulk insert findings", { error: err });
          throw err;
        }
      }
    }
  }
};

