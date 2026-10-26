// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { mcpTools } from '../utils/mcp';
import { getUserIdFromRequest, queryApiKey, requestToken } from '../utils/auth';
import { errorStatus } from '../utils/http';
import { ValidationError, isValidId, LIMITS, readJsonBody, reqString } from '../utils/validation';

async function handleMcpJsonRpc(reqBody: any, c: any, app: Hono<AppEnv>): Promise<any> {
  if (!reqBody || typeof reqBody !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' }
    };
  }
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
      const token = queryApiKey(c);
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
      let resJson: any;
      const contentType = internalRes.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        resJson = await internalRes.json();
      } else {
        resJson = { error: await internalRes.text() };
      }
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

/** The status of a coordinator call (0 if it failed outright); its body is not needed. */
async function coordinatorCall(stub: { fetch(req: Request): Promise<Response> }, req: Request): Promise<number> {
  try {
    const res = await stub.fetch(req);
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

export function registerMcpRoutes(app: Hono<AppEnv>) {
  app.get('/api/mcp/sse', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const connectionId = crypto.randomUUID();
    const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(doId);

    const requestUrl = new URL(c.req.url);
    const host = c.req.header('Host') || c.req.header('host') || requestUrl.host;
    const protocol = requestUrl.protocol;
    let origin = `${protocol}//${host}`;

    const isLocal = c.env.JWT_SECRET === 'test-secret';
    if (isLocal) {
      origin = 'http://localhost:8787';
    }

    // The connection is the caller's: only their messages are answered on it (handlers/sse.ts).
    const doRes = await stub.fetch(new Request(`http://localhost/sse?connectionId=${connectionId}&userId=${encodeURIComponent(userId)}&origin=${encodeURIComponent(origin)}`));
    return doRes;
  });

  app.post('/api/mcp/sse', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    let body;
    try {
      body = await readJsonBody(c, { allowPrimitives: true });
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const responsePayload = await handleMcpJsonRpc(body, c, app);
    if (responsePayload) {
      return c.json(responsePayload);
    }
    return c.text('Accepted', 202);
  });

  app.post('/api/mcp/message', async (c) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const connectionId = c.req.query('connectionId');
    if (!connectionId) return c.json({ error: 'Missing connectionId' }, 400);
    if (!isValidId(connectionId)) return c.json({ error: 'Invalid connectionId' }, 400);

    let body;
    try {
      body = await readJsonBody(c, { allowPrimitives: true });
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Only the user who opened the connection may send on it, and nothing runs before that is
    // known: someone else's connection is answered like one that does not exist.
    const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = c.env.COORDINATOR_DO.get(doId);
    const owner = `connectionId=${encodeURIComponent(connectionId)}&userId=${encodeURIComponent(userId)}`;
    const check = await coordinatorCall(stub, new Request(`http://localhost/sse-owner?${owner}`));
    if (check !== 204) {
      return check === 404 ? c.json({ error: 'Connection not found' }, 404) : c.json({ error: 'Coordinator unavailable' }, 502);
    }

    const responsePayload = await handleMcpJsonRpc(body, c, app);
    if (responsePayload) {
      // The connection can close while the call runs; its answer is then lost, and the caller is
      // told so rather than left waiting for it.
      const sent = await coordinatorCall(stub, new Request(`http://localhost/sse-send?${owner}`, {
        method: 'POST',
        body: JSON.stringify(responsePayload)
      }));
      if (sent === 404 || sent === 410) return c.json({ error: 'Connection closed before the answer could be sent' }, 410);
      if (sent !== 200) return c.json({ error: 'Coordinator unavailable' }, 502);
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

    let body: any;
    try {
      body = await readJsonBody(c);
      reqString(body.name, 'name', LIMITS.NAME);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { name, arguments: args } = body;

    const tool = mcpTools.find(t => t.name === name);
    if (!tool) {
      return c.json({ error: `Tool ${name} not found` }, 404);
    }

    let path = tool.path;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null) {
          path = path.replace(`:${k}`, encodeURIComponent(String(v)));
        }
      }
    }
    if (path.includes(':')) {
      return c.json({ error: `Missing required path parameters in arguments` }, 400);
    }

    let urlStr = `http://localhost${path}`;
    if (tool.method === 'GET' && args && typeof args === 'object' && !Array.isArray(args)) {
      const url = new URL(urlStr);
      const pathParams = tool.path.split('/').filter(s => s.startsWith(':')).map(s => s.slice(1));
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null && !pathParams.includes(k)) {
          url.searchParams.set(k, String(v));
        }
      }
      urlStr = url.toString();
    }

    const headers = new Headers();
    const token = requestToken(c);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');

    const fetchRequest = new Request(urlStr, {
      method: tool.method,
      headers,
      body: tool.method !== 'GET' && args ? JSON.stringify(args) : undefined
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
        return c.json({ error: responseBody?.error || responseBody || 'Request failed' }, errorStatus(response.status));
      }

      return c.json({ result: responseBody });
    } catch (err: any) {
      return c.json({ error: `Failed to call tool: ${err.message}` }, 500);
    }
  });
}
