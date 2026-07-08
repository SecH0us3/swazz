import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerMcpRoutes } from '../../../src/routes/mcp';
import { getUserIdFromRequest } from '../../../src/utils/auth';

const mockGetUserIdFromRequest = vi.fn().mockResolvedValue('user-123');

vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: (c: any) => mockGetUserIdFromRequest(c),
  getClientIp: vi.fn().mockReturnValue('1.1.1.1')
}));

describe('MCP Routes', () => {
  let app: Hono<any>;
  let mockStub: any;
  let mockCoordinatorDo: any;
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserIdFromRequest.mockResolvedValue('user-123');

    mockStub = {
      fetch: vi.fn().mockResolvedValue(new Response('sse-stream', { status: 200 }))
    };

    mockCoordinatorDo = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id-123' }),
      get: vi.fn().mockReturnValue(mockStub)
    };

    mockEnv = {
      JWT_SECRET: 'test-secret',
      COORDINATOR_DO: mockCoordinatorDo
    };

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = mockEnv;
      await next();
    });
    registerMcpRoutes(app);
  });

  describe('GET /api/mcp/sse', () => {
    it('should return 401 if unauthorized', async () => {
      mockGetUserIdFromRequest.mockResolvedValue(null);
      const res = await app.request('/api/mcp/sse');
      expect(res.status).toBe(401);
    });

    it('should connect to SSE and return stub response', async () => {
      const res = await app.request('/api/mcp/sse');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('sse-stream');
      expect(mockCoordinatorDo.idFromName).toHaveBeenCalledWith('global-coordinator');
      expect(mockCoordinatorDo.get).toHaveBeenCalled();
    });

    it('should fall back to request header Host or request URL protocol if not local development', async () => {
      mockEnv.JWT_SECRET = 'production-secret';
      const res = await app.request('/api/mcp/sse', {
        headers: {
          Host: 'production.com'
        }
      });
      expect(res.status).toBe(200);
      const calledRequest = mockStub.fetch.mock.calls[0][0];
      const url = new URL(calledRequest.url);
      expect(decodeURIComponent(url.searchParams.get('origin') || '')).toBe('http://production.com');
    });
  });

  describe('POST /api/mcp/sse', () => {
    it('should return 401 if unauthorized', async () => {
      mockGetUserIdFromRequest.mockResolvedValue(null);
      const res = await app.request('/api/mcp/sse', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid_json'
      });
      expect(res.status).toBe(400);
    });

    it('should handle jsonrpc initialize', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize'
      };
      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.protocolVersion).toBe('2024-11-05');
      expect(body.result.serverInfo.name).toBe('swazz-mcp-coordinator');
    });

    it('should return error for invalid request payload (not object)', async () => {
      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify('not-an-object')
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error.code).toBe(-32600);
    });

    it('should return error for invalid jsonrpc version', async () => {
      const payload = {
        jsonrpc: '1.0',
        id: 1,
        method: 'initialize'
      };
      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error.code).toBe(-32600);
    });

    it('should return tools list on tools/list method', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      };
      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.tools.length).toBeGreaterThan(0);
      expect(body.result.tools[0].name).toBe('swazz_list_projects');
    });

    it('should return method not found for unknown methods', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 3,
        method: 'unknown/method'
      };
      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error.code).toBe(-32601);
    });

    it('should return 202 Accepted and null body for notification requests (no id)', async () => {
      const payload = {
        jsonrpc: '2.0',
        method: 'some/notification'
      };
      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe('Accepted');
    });

    it('should call internal API and return RPC response on tools/call', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'swazz_list_projects',
          arguments: {}
        }
      };

      const originalFetch = app.fetch.bind(app);
      const spyAppFetch = vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/mcp/call') {
          return Promise.resolve(new Response(JSON.stringify({
            result: { projects: [{ id: 'p1' }] }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token-123'
        },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.content[0].text).toContain('projects');
      expect(spyAppFetch).toHaveBeenCalled();
    });

    it('should support token in query parameter for tools/call authentication extraction', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'swazz_list_projects',
          arguments: {}
        }
      };

      const originalFetch = app.fetch.bind(app);
      let capturedAuthorizationHeader: string | null = null;
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/mcp/call') {
          capturedAuthorizationHeader = req.headers.get('Authorization');
          return Promise.resolve(new Response(JSON.stringify({
            result: { projects: [] }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/sse?token=my-query-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      expect(capturedAuthorizationHeader).toBe('Bearer my-query-token');
    });

    it('should read non-JSON internal response as text on tools/call failure', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'swazz_list_projects',
          arguments: {}
        }
      };

      const originalFetch = app.fetch.bind(app);
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/mcp/call') {
          return Promise.resolve(new Response('Error plain text response', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toBe('Error plain text response');
    });

    it('should return error text in tools/call if app.fetch throws error', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'swazz_list_projects',
          arguments: {}
        }
      };

      const originalFetch = app.fetch.bind(app);
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/mcp/call') {
          return Promise.reject(new Error('Network break'));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/sse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain('Network break');
    });
  });

  describe('POST /api/mcp/message', () => {
    it('should return 401 if unauthorized', async () => {
      mockGetUserIdFromRequest.mockResolvedValue(null);
      const res = await app.request('/api/mcp/message', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('should return 400 if connectionId is missing', async () => {
      const res = await app.request('/api/mcp/message', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await app.request('/api/mcp/message?connectionId=conn-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid_json'
      });
      expect(res.status).toBe(400);
    });

    it('should call handleMcpJsonRpc and forward output to Durable Object connection', async () => {
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize'
      };

      const res = await app.request('/api/mcp/message?connectionId=conn-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(202);
      expect(mockStub.fetch).toHaveBeenCalled();
      const calledRequest = mockStub.fetch.mock.calls[0][0];
      const url = new URL(calledRequest.url);
      expect(url.pathname).toBe('/sse-send');
      expect(url.searchParams.get('connectionId')).toBe('conn-123');
      expect(calledRequest.method).toBe('POST');
    });
  });

  describe('GET /api/mcp/tools', () => {
    it('should return 401 if unauthorized', async () => {
      mockGetUserIdFromRequest.mockResolvedValue(null);
      const res = await app.request('/api/mcp/tools');
      expect(res.status).toBe(401);
    });

    it('should return list of tools', async () => {
      const res = await app.request('/api/mcp/tools');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/mcp/call', () => {
    it('should return 401 if unauthorized', async () => {
      mockGetUserIdFromRequest.mockResolvedValue(null);
      const res = await app.request('/api/mcp/call', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid_json'
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 for unknown tool', async () => {
      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'unknown_tool' })
      });
      expect(res.status).toBe(404);
    });

    it('should substitute path parameters successfully', async () => {
      const originalFetch = app.fetch.bind(app);
      let capturedUrl: string | null = null;
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname.startsWith('/api/scans/')) {
          capturedUrl = req.url;
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'swazz_get_scan_status',
          arguments: { id: 'scan-xyz' }
        })
      });

      expect(res.status).toBe(200);
      expect(capturedUrl).toBe('http://localhost/api/scans/scan-xyz');
    });

    it('should return 400 if required path parameters are missing', async () => {
      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'swazz_get_scan_status',
          arguments: {}
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Missing required path parameters');
    });

    it('should append non-path arguments to search parameters for GET request', async () => {
      const originalFetch = app.fetch.bind(app);
      let capturedUrl: string | null = null;
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/scans') {
          capturedUrl = req.url;
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'swazz_list_scans',
          arguments: { project_id: 'proj-1', extra_param: 'value' }
        })
      });

      expect(res.status).toBe(200);
      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('project_id')).toBe('proj-1');
      expect(url.searchParams.get('extra_param')).toBe('value');
    });

    it('should fallback to token in query parameter if Authorization header is missing', async () => {
      const originalFetch = app.fetch.bind(app);
      let capturedAuth: string | null = null;
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/projects') {
          capturedAuth = req.headers.get('Authorization');
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/call?token=my-special-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'swazz_list_projects',
          arguments: {}
        })
      });

      expect(res.status).toBe(200);
      expect(capturedAuth).toBe('Bearer my-special-token');
    });

    it('should support text/plain response parsing for call target API returning non-JSON', async () => {
      const originalFetch = app.fetch.bind(app);
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/projects') {
          return Promise.resolve(new Response('Plain text fallback', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'swazz_list_projects',
          arguments: {}
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result).toBe('Plain text fallback');
    });

    it('should return error response code if internal API call fails', async () => {
      const originalFetch = app.fetch.bind(app);
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/projects') {
          return Promise.resolve(new Response(JSON.stringify({ error: 'Forbidden access' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'swazz_list_projects',
          arguments: {}
        })
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Forbidden access');
    });

    it('should catch request exceptions and return status 500', async () => {
      const originalFetch = app.fetch.bind(app);
      vi.spyOn(app, 'fetch').mockImplementation((req, env) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/projects') {
          return Promise.reject(new Error('Internal network error'));
        }
        return originalFetch(req, env);
      });

      const res = await app.request('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'swazz_list_projects',
          arguments: {}
        })
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Internal network error');
    });
  });
});
