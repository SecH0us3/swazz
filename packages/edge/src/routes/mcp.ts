import { Hono } from 'hono';
import { Env } from '../env';
import { mcpTools } from '../utils/mcp';
import { getUserIdFromRequest } from '../utils/auth';

export function registerMcpRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/mcp/tools', async (c) => {
    // Check auth
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    return c.json({ tools: mcpTools });
  });

  app.post('/api/mcp/call', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { name, arguments: args } = body;

    const tool = mcpTools.find(t => t.name === name);
    if (!tool) {
      return c.json({ error: `Tool ${name} not found` }, 404);
    }

    // Build the request path with route parameters
    let path = tool.path;
    if (args && typeof args === 'object') {
      for (const [k, v] of Object.entries(args)) {
        path = path.replace(`:${k}`, encodeURIComponent(String(v)));
      }
    }

    // Construct URL with query parameters if GET
    let urlStr = `http://localhost${path}`;
    if (tool.method === 'GET' && args) {
      const url = new URL(urlStr);
      for (const [k, v] of Object.entries(args)) {
        if (!tool.path.includes(`:${k}`)) {
          url.searchParams.set(k, String(v));
        }
      }
      urlStr = url.toString();
    }

    const headers = new Headers();
    const authHeader = c.req.header('Authorization');
    if (authHeader) {
      headers.set('Authorization', authHeader);
    }
    headers.set('Content-Type', 'application/json');

    const fetchRequest = new Request(urlStr, {
      method: tool.method,
      headers,
      body: tool.method !== 'GET' && tool.method !== 'HEAD' && args ? JSON.stringify(args) : undefined
    });

    try {
      // Execute the request internally against our Hono app
      const response = await app.fetch(fetchRequest, c.env);
      let responseBody: any;
      const contentType = response.headers.get('Content-Type') || '';
      
      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      if (!response.ok) {
        return c.json({ error: responseBody?.error || responseBody || 'Request failed' }, response.status);
      }

      return c.json({ result: responseBody });
    } catch (err: any) {
      return c.json({ error: `Failed to call tool: ${err.message}` }, 500);
    }
  });
}
