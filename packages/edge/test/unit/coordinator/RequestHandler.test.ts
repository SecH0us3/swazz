import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const mockLogWarn = vi.fn();
const mockLogError = vi.fn();

vi.mock('../../../../common/logging/logger', () => ({
  logWarn: (...args: any[]) => mockLogWarn(...args),
  logError: (...args: any[]) => mockLogError(...args)
}));

describe('RequestHandler', () => {
  let mockState: any;
  let mockEnv: any;
  let mockQueueService: any;
  let mockWs: any;

  const createMockWs = () => {
    let attachment: any = {};
    return {
      deserializeAttachment: vi.fn().mockImplementation(() => attachment),
      serializeAttachment: vi.fn().mockImplementation((val) => { attachment = val; }),
      send: vi.fn(),
      close: vi.fn()
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockWs = createMockWs();

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

    it('creates a stream without origin query parameter', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/sse?connectionId=conn1'));
      expect(res.status).toBe(200);
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

    it('returns 400 for missing payload', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null'
      }));
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

    it('returns 503 if no runner could accept job (due to disable_shared_runners)', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner']); // shared runner
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run1',
          config: { settings: { disable_shared_runners: true } }
        })
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

    it('dispatches job to private runner if matching public key', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc']); // private runner
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: {}, userPublicKey: 'pubkey-abc' })
      }));

      expect(res.status).toBe(200);
      expect(stateManager.jobs.get('run1')).toBe(mockWs);
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
    it('returns 400 for invalid JSON payload', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        body: 'invalid'
      }));
      expect(res.status).toBe(400);
    });

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
    it('returns 400 for invalid JSON body', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        body: 'invalid-json'
      }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing url and rawSpec', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }));
      expect(res.status).toBe(400);
    });

    it('throws TypeError if body.url is not a string', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      await expect(
        handler.handle(new Request('http://localhost/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 123 })
        }))
      ).rejects.toThrow('body.url must be a string');
    });

    it('maps local/test bbad.secmy.app URLs correctly', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);
      mockGetCachedSwagger.mockResolvedValue(null);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      
      setTimeout(() => {
        const reqId = Array.from(stateManager.pendingParses.keys())[0];
        const resolve = stateManager.pendingParses.get(reqId);
        resolve?.(new Response('ok'));
      }, 50);

      await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://bbad.secmy.app/swagger.json' })
      }));

      expect(mockWs.send).toHaveBeenCalled();
      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMsg.payload.url).toBe('http://127.0.0.1:8788/swagger.json');
    });

    it('returns cached swagger details if present and maps local basePath', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      mockGetCachedSwagger.mockResolvedValue({
        endpoints_r2_key: 'key1',
        fetched_at: '2026-07-08',
        base_path: 'http://bbad.secmy.app'
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
      expect(data.basePath).toBe('http://127.0.0.1:8788');
      expect(data.endpoints).toEqual({ '/api': {} });
    });

    it('logs error and falls back on cache DB retrieval fail', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockRejectedValue(new Error('DB connection failed'));

      // We resolve the pending parse in a moment to simulate runner response
      setTimeout(() => {
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
      expect(mockLogError).toHaveBeenCalled();
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

    it('returns 503 if only private runner connected and public key is missing', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc']); // Private runner
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json' })
      }));

      expect(res.status).toBe(503);
    });

    it('sends parse_request to matching private runner and awaits response', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc']); // Private runner

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      setTimeout(() => {
        const reqId = Array.from(stateManager.pendingParses.keys())[0];
        const resolve = stateManager.pendingParses.get(reqId);
        resolve?.(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }, 50);

      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json', userPublicKey: 'pubkey-abc' })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
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

    it('handles runner send throw error in /parse', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);
      mockWs.send.mockImplementation(() => {
        throw new Error('connection lost');
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json' })
      }));

      expect(res.status).toBe(500);
    });

    it('returns 504 on parse timeout', async () => {
      vi.useFakeTimers();

      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      const promise = handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json' })
      }));

      // Fast-forward 30 seconds async to trigger timers and run promise queues
      await vi.advanceTimersByTimeAsync(30000);

      const res = await promise;
      expect(res.status).toBe(504);

      vi.useRealTimers();
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

    it('returns 503 if only private runner connected (no shared runner)', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc']); // private runner
      stateManager.runners.add(mockWs);

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

    it('handles runnerWs.send throwing error in /start-run', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);
      mockWs.send.mockImplementation(() => {
        throw new Error('lost connection');
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/start-run?runId=run1', {
        method: 'POST',
        body: JSON.stringify({ config: {} })
      }));

      expect(res.status).toBe(500);
      expect(stateManager.runners.has(mockWs)).toBe(false);
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

    it('ignores if ws.send throws', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.jobs.set('run1', mockWs);
      mockWs.send.mockImplementation(() => {
        throw new Error('dropped connection');
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/control-run?runId=run1&action=stop', {
        method: 'POST'
      }));

      expect(res.status).toBe(200);
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

    it('returns active runners list with fallback defaults if name/version tags are missing', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner']);
      mockWs.deserializeAttachment.mockReturnValue(null);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners'));

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.runners[0].name).toBe('Unnamed Runner');
      expect(data.runners[0].version).toBe('v0.0.0');
    });

    it('handles deserializeAttachment throwing error gracefully', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'name:runner-1', 'version:v1.2.3']);
      mockWs.deserializeAttachment.mockImplementation(() => {
        throw new Error('corrupted attachment');
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners'));

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.runners[0].connectionId).toBeNull();
      expect(data.runners[0].activeJobs).toEqual([]);
    });
  });

  describe('/runners/restart', () => {
    it('returns 400 if connectionId is missing', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart'));
      expect(res.status).toBe(400);
    });

    it('handles deserializeAttachment throwing error in loops gracefully', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockWs.deserializeAttachment.mockImplementation(() => {
        throw new Error('corrupted');
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123', {
        method: 'POST'
      }));

      expect(res.status).toBe(404);
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

    it('returns 403 if user public key does not match', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123&userPublicKey=pubkey-different', {
        method: 'POST'
      }));

      expect(res.status).toBe(403);
    });

    it('returns 500 if send restart command throws error', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });
      mockWs.send.mockImplementation(() => {
        throw new Error('dropped connection');
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123&userPublicKey=pubkey-abc', {
        method: 'POST'
      }));

      expect(res.status).toBe(500);
    });
  });

  describe('/connect-runner', () => {
    it('accepts shared runner websocket connection', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      const res = await handler.handle(new Request('http://localhost/connect-runner?name=shared-runner&version=v1.0.0'));
      expect(res.status).toBe(101);
      expect(mockState.acceptWebSocket).toHaveBeenCalled();
      const serverWs = mockState.acceptWebSocket.mock.calls[0][0];
      expect(stateManager.runners.has(serverWs)).toBe(true);
      expect(mockQueueService.checkAndDispatchQueuedScans).toHaveBeenCalledWith(serverWs);
    });

    it('logs warning if shared runner version is outdated', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      await handler.handle(new Request('http://localhost/connect-runner?name=shared-runner&version=v0.9.0'));
      expect(mockLogWarn).toHaveBeenCalled();
    });

    it('initiates challenge for private runner', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      const res = await handler.handle(new Request('http://localhost/connect-runner?public_key=pubkey-abc&name=my-runner'));
      expect(res.status).toBe(101);
      const serverWs = mockState.acceptWebSocket.mock.calls[0][0];
      expect(stateManager.pendingChallenges.has(serverWs)).toBe(true);
    });

    it('ignores if challenge sending throws error', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      
      // Inject throw on server socket send
      mockState.acceptWebSocket.mockImplementation((ws: any) => {
        ws.send = () => { throw new Error('send fail'); };
      });

      const res = await handler.handle(new Request('http://localhost/connect-runner?public_key=pubkey-abc&name=my-runner'));
      expect(res.status).toBe(101);
    });

    it('closes private runner websocket on challenge auth timeout', async () => {
      vi.useFakeTimers();

      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      await handler.handle(new Request('http://localhost/connect-runner?public_key=pubkey-abc&name=my-runner'));
      
      const serverWs = mockState.acceptWebSocket.mock.calls[0][0];
      const closeSpy = vi.spyOn(serverWs, 'close');
      
      // Fast-forward 5 seconds async to trigger background timeouts
      await vi.advanceTimersByTimeAsync(5000);

      expect(closeSpy).toHaveBeenCalledWith(1008, "Authentication timeout");

      vi.useRealTimers();
    });

    it('challenge auth timeout does not close websocket if runner is already added to runners list', async () => {
      vi.useFakeTimers();

      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      await handler.handle(new Request('http://localhost/connect-runner?public_key=pubkey-abc&name=my-runner'));
      
      const serverWs = mockState.acceptWebSocket.mock.calls[0][0];
      const closeSpy = vi.spyOn(serverWs, 'close');
      
      // Authenticate and add runner to stateManager
      stateManager.runners.add(serverWs);

      // Fast-forward 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      expect(closeSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
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

    it('adds multiple client connections for the same runId', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      const res1 = await handler.handle(new Request('http://localhost/connect-client?runId=run123'));
      const ws1 = mockState.acceptWebSocket.mock.calls[0][0];

      const res2 = await handler.handle(new Request('http://localhost/connect-client?runId=run123'));
      const ws2 = mockState.acceptWebSocket.mock.calls[1][0];

      expect(res1.status).toBe(101);
      expect(res2.status).toBe(101);
      expect(stateManager.clients.get('run123')?.size).toBe(2);
      expect(stateManager.clients.get('run123')?.has(ws1)).toBe(true);
      expect(stateManager.clients.get('run123')?.has(ws2)).toBe(true);
    });
  });
});
