import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestHandler } from '../../../src/coordinator/RequestHandler';
import { StateManager } from '../../../src/coordinator/StateManager';
import { QueueService } from '../../../src/coordinator/QueueService';
import { ulid } from 'ulidx';

const mockGetCachedSwagger = vi.fn();

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(function () {
      return {
        getCachedSwagger: mockGetCachedSwagger,
      };
    })
  };
});

describe('RequestHandler', () => {
  let mockState: any;
  let mockEnv: any;
  let mockQueueService: any;
  let mockWs: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWs = {
      deserializeAttachment: vi.fn().mockReturnValue({}),
      serializeAttachment: vi.fn(),
      send: vi.fn(),
      close: vi.fn()
    };

    mockState = {
      getWebSockets: vi.fn().mockReturnValue([]),
      getTags: vi.fn().mockReturnValue([]),
      acceptWebSocket: vi.fn(),
      storage: {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true)
      }
    };

    mockEnv = {
      VERSION: '1.0.0',
      JWT_SECRET: 'test-secret',
      STORAGE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(true)
      }
    };

    mockQueueService = {
      checkAndDispatchQueuedScans: vi.fn().mockResolvedValue(undefined)
    };
  });

  it('returns 404 for unknown endpoints', async () => {
    const stateManager = new StateManager(mockState);
    const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

    const res = await handler.handle(new Request('http://localhost/unknown'));
    expect(res.status).toBe(404);
  });

  describe('/sse and /sse-send', () => {
    it('returns 400 for /sse if connectionId is missing', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/sse'));
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Missing connectionId');
    });

    it('creates a stream and saves controller on /sse', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/sse?connectionId=conn1&origin=http%3A%2F%2Ftest.com'));
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(stateManager.sseStreams.has('conn1')).toBe(true);

      // Trigger cancel to clean up
      const reader = res.body?.getReader();
      await reader?.cancel();
      expect(stateManager.sseStreams.has('conn1')).toBe(false);
    });

    it('returns 400 for /sse-send if connectionId is missing', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/sse-send', { method: 'POST', body: 'hello' }));
      expect(res.status).toBe(400);
    });

    it('returns 404 for /sse-send if connection does not exist', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/sse-send?connectionId=unknown', { method: 'POST', body: 'hello' }));
      expect(res.status).toBe(404);
    });

    it('enqueues message on /sse-send', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      
      const mockController = {
        enqueue: vi.fn()
      } as any;
      stateManager.sseStreams.set('conn1', mockController);

      const res = await handler.handle(new Request('http://localhost/sse-send?connectionId=conn1', { method: 'POST', body: 'hello-world' }));
      expect(res.status).toBe(200);
      expect(mockController.enqueue).toHaveBeenCalled();
    });

    it('handles closed stream error in /sse-send', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      
      const mockController = {
        enqueue: vi.fn().mockImplementation(() => {
          throw new Error('closed');
        })
      } as any;
      stateManager.sseStreams.set('conn1', mockController);

      const res = await handler.handle(new Request('http://localhost/sse-send?connectionId=conn1', { method: 'POST', body: 'hello-world' }));
      expect(res.status).toBe(410);
      expect(stateManager.sseStreams.has('conn1')).toBe(false);
    });
  });

  describe('/revoke-user', () => {
    it('returns 400 if userId is missing', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/revoke-user'));
      expect(res.status).toBe(400);
    });

    it('closes and deletes runner WebSocket matching user id', async () => {
      mockState.getWebSockets.mockReturnValue([mockWs]);
      mockState.getTags.mockReturnValue(['runner', 'user_id:user123']);

      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/revoke-user?userId=user123'));
      
      expect(res.status).toBe(200);
      expect(mockWs.close).toHaveBeenCalledWith(1008, "User account deleted");
      expect(stateManager.runners.has(mockWs)).toBe(false);
      const data = await res.json() as any;
      expect(data.disconnectedCount).toBe(1);
    });
  });

  describe('/dispatch', () => {
    it('returns 400 for invalid json', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', { method: 'POST', body: 'invalid-json' }));
      expect(res.status).toBe(400);
    });

    it('returns 503 if no runners are available', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: {} })
      }));
      expect(res.status).toBe(503);
    });

    it('dispatches job to compatible runner', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner']); // shared runner
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: {} })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      expect(stateManager.jobs.get('run1')).toBe(mockWs);
      expect(mockState.storage.delete).toHaveBeenCalledWith('config:run1');
    });

    it('handles dispatch failure gracefully', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner']);
      mockWs.send.mockImplementation(() => {
        throw new Error('send error');
      });
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: {} })
      }));

      expect(res.status).toBe(500);
      expect(stateManager.runners.has(mockWs)).toBe(false);
      expect(stateManager.jobs.has('run1')).toBe(false);
    });
  });

  describe('/command', () => {
    it('returns 400 for missing payload or runId', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }));
      expect(res.status).toBe(400);
    });

    it('sends command to runner if job exists', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.jobs.set('run1', mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', command: 'pause' })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMsg.type).toBe('job_command');
      expect(sentMsg.payload.command).toBe('pause');
    });

    it('returns 404 if runner not found for job', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-not-found', command: 'pause' })
      }));
      expect(res.status).toBe(404);
    });
  });

  describe('/parse', () => {
    it('returns cached swagger details if present', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      mockGetCachedSwagger.mockResolvedValue({
        endpoints_r2_key: 'key1',
        fetched_at: '2026-07-08',
        base_path: 'http://test.com'
      });
      mockEnv.STORAGE.get.mockResolvedValue({
        text: () => Promise.resolve('{"/api": {}}')
      });

      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json' })
      }));

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.fromCache).toBe(true);
      expect(data.basePath).toBe('http://test.com');
      expect(data.endpoints).toEqual({ '/api': {} });
    });

    it('returns 503 if no active runners are connected', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      mockGetCachedSwagger.mockResolvedValue(null);

      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json' })
      }));

      expect(res.status).toBe(503);
    });

    it('sends parse_request to runner and awaits response', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      // We resolve the pending parse in a moment to simulate runner response
      setTimeout(() => {
        expect(stateManager.pendingParses.size).toBe(1);
        const reqId = Array.from(stateManager.pendingParses.keys())[0];
        const resolve = stateManager.pendingParses.get(reqId);
        resolve?.(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }, 50);

      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json' })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMsg.type).toBe('parse_request');
      expect(sentMsg.payload.url).toBe('http://example.com/swagger.json');
    });
  });

  describe('/start-run', () => {
    it('returns 503 if no runners available', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/start-run?runId=run1', {
        method: 'POST',
        body: JSON.stringify({ config: {} })
      }));
      expect(res.status).toBe(503);
    });

    it('sends start command to shared runner', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']); // shared runner

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/start-run?runId=run1', {
        method: 'POST',
        body: JSON.stringify({ config: { target: 'ok' } })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMsg.type).toBe('start');
      expect(sentMsg.config.target).toBe('ok');
    });
  });

  describe('/control-run', () => {
    it('sends control action to job runner', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.jobs.set('run1', mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/control-run?runId=run1&action=stop', {
        method: 'POST'
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMsg.type).toBe('stop');
    });
  });

  describe('/runners', () => {
    it('returns active runners list', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'name:runner-1', 'version:v1.2.3', 'pubkey-abc']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123', activeJobs: ['job1'] });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners'));

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.runners.length).toBe(1);
      expect(data.runners[0]).toEqual({
        connectionId: 'conn123',
        name: 'runner-1',
        publicKey: 'pubkey-abc',
        status: 'connected',
        isShared: false,
        version: 'v1.2.3',
        activeJobs: ['job1']
      });
    });
  });

  describe('/runners/restart', () => {
    it('returns 400 if connectionId is missing', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart'));
      expect(res.status).toBe(400);
    });

    it('restarts runner owned by user', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123&userPublicKey=pubkey-abc', {
        method: 'POST'
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMsg.type).toBe('agent_restart');
    });

    it('returns 403 for shared runners (no public key)', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123', {
        method: 'POST'
      }));

      expect(res.status).toBe(403);
    });
  });

  describe('/connect-runner', () => {
    it('accepts shared runner websocket connection', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      const res = await handler.handle(new Request('http://localhost/connect-runner?name=shared-runner&version=v1.0.0'));
      expect(res.status).toBe(101);
      expect(mockState.acceptWebSocket).toHaveBeenCalled();
      expect(stateManager.runners.has(mockWs)).toBe(false); // Wait, acceptWebSocket is called on server WS, mockState returns it as web sockets when queried?
      // Since it's a shared runner, we serialised attachment authenticated: true and added to runners.
      // Wait, in RequestHandler.ts line 480: `this.stateManager.runners.add(server);`
      // So the server socket (which is mockState.acceptWebSocket second argument) gets added.
      // Let's verify that acceptWebSocket was called with the server socket.
      const serverWs = mockState.acceptWebSocket.mock.calls[0][0];
      expect(stateManager.runners.has(serverWs)).toBe(true);
      expect(mockQueueService.checkAndDispatchQueuedScans).toHaveBeenCalledWith(serverWs);
    });

    it('initiates challenge for private runner', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      const res = await handler.handle(new Request('http://localhost/connect-runner?public_key=pubkey-abc&name=my-runner'));
      expect(res.status).toBe(101);
      const serverWs = mockState.acceptWebSocket.mock.calls[0][0];
      expect(stateManager.pendingChallenges.has(serverWs)).toBe(true);
    });
  });

  describe('/connect-client', () => {
    it('returns 400 if runId is missing', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/connect-client'));
      expect(res.status).toBe(400);
    });

    it('accepts client websocket connection', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      const res = await handler.handle(new Request('http://localhost/connect-client?runId=run123'));
      expect(res.status).toBe(101);
      expect(mockState.acceptWebSocket).toHaveBeenCalled();
      const serverWs = mockState.acceptWebSocket.mock.calls[0][0];
      expect(stateManager.clients.get('run123')?.has(serverWs)).toBe(true);
    });
  });
});
