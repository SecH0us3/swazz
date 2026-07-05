import { Hono } from 'hono';
import { Env } from '../env';
import { mcpTools } from '../utils/mcp';
import { getUserIdFromRequest } from '../utils/auth';

async function handleMcpJsonRpc(reqBody: any, c: any, app: Hono<{ Bindings: Env }>): Promise<any> {
  const { jsonrpc, id, method, params } = reqBody;

  if (jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32600, message: 'Invalid Request' }
    };
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'swazz-mcp-coordinator',
          version: '1.0.0'
        }
      }
    };
  }

  if (method === 'tools/list') {
    const specTools = mcpTools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: specTools
      }
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    const headers = new Headers();
    const authHeader = c.req.header('Authorization');
    if (authHeader) {
      headers.set('Authorization', authHeader);
    } else {
      const token = c.req.query('token');
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');

    const internalReq = new Request('http://localhost/api/mcp/call', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, arguments: args })
    });

    try {
      const internalRes = await app.fetch(internalReq, c.env);
      const resJson: any = await internalRes.json();
      if (internalRes.ok) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(resJson.result)
              }
            ]
          }
        };
      } else {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: resJson.error || 'Request failed'
              }
            ],
            isError: true
          }
        };
      }
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Internal error: ${err.message}`
            }
          ],
          isError: true
        }
      };
    }
  }

  if (id === undefined) {
    // Notification, no response
    return null;
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  };
}

export function registerMcpRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/mcp/sse', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const connectionId = crypto.randomUUID();
    const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(doId);

    const requestUrl = new URL(c.req.url);
    const host = c.req.header('Host') || c.req.header('host') || requestUrl.host;
    const protocol = requestUrl.protocol;
    const origin = `${protocol}//${host}`;

    const doRes = await stub.fetch(new Request(`http://localhost/sse?connectionId=${connectionId}&origin=${encodeURIComponent(origin)}`));
    return doRes;
  });

  app.post('/api/mcp/message', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const connectionId = c.req.query('connectionId');
    if (!connectionId) return c.json({ error: 'Missing connectionId' }, 400);

    const body = await c.req.json();

    const responsePayload = await handleMcpJsonRpc(body, c, app);
    if (responsePayload) {
      const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = c.env.COORDINATOR_DO.get(doId);
      await stub.fetch(new Request(`http://localhost/sse-send?connectionId=${connectionId}`, {
        method: 'POST',
        body: JSON.stringify(responsePayload)
      }));
    }

    return new Response('Accepted', { status: 202 });
  });

  app.get('/api/mcp/tools', async (c) => {
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

    let path = tool.path;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      for (const [k, v] of Object.entries(args)) {
        path = path.replace(`:${k}`, encodeURIComponent(String(v)));
      }
    }
    if (path.includes(':')) {
      return c.json({ error: `Missing required path parameters in arguments` }, 400);
    }

    let urlStr = `http://localhost${path}`;
    if (tool.method === 'GET' && args && typeof args === 'object' && !Array.isArray(args)) {
      const url = new URL(urlStr);
      for (const [k, v] of Object.entries(args)) {
        if (!tool.path.includes(`:${k}`)) {
          url.searchParams.set(k, String(v));
        }
      }
      urlStr = url.toString();
    }

    const headers = new Headers();
    let token = null;
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = c.req.query('token');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');

    const fetchRequest = new Request(urlStr, {
      method: tool.method,
      headers,
      body: tool.method !== 'GET' && tool.method !== 'HEAD' && args ? JSON.stringify(args) : undefined
    });

    try {
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
