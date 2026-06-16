import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './env';
import { getUserIdFromRequest } from './utils/auth';
import { registerAuthRoutes } from './routes/auth';
import { registerProjectsRoutes } from './routes/projects';
import { registerScansRoutes } from './routes/scans';
import { registerRunnersRoutes } from './routes/runners';
import { registerMiscRoutes } from './routes/misc';

export { RunnerCoordinator } from './Coordinator';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS ? c.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : ['*'];
  const origin = c.req.header('Origin');
  
  const corsMiddleware = cors({
    origin: allowedOrigins.includes('*') ? '*' : (origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'Upgrade'],
    exposeHeaders: ['Content-Length', 'Content-Signal'],
    maxAge: 86400,
  });
  
  return await corsMiddleware(c, next);
});

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


registerAuthRoutes(app);
registerProjectsRoutes(app);
registerScansRoutes(app);
registerRunnersRoutes(app);
registerMiscRoutes(app);

export default app;
