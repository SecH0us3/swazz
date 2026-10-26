// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestHandler } from '../../../src/coordinator/RequestHandler';
import { StateManager } from '../../../src/coordinator/StateManager';
import { QueueService } from '../../../src/coordinator/QueueService';
import { ulid } from 'ulidx';

const deletedKeys = (state: any): string[] => state.storage.delete.mock.calls.flatMap((c: any[]) => c[0]);

const mockGetCachedSwagger = vi.fn();
const mockGetScan = vi.fn().mockResolvedValue(null);
const mockUpdateScanStatus = vi.fn().mockResolvedValue(true);
const mockGetScanStatus = vi.fn().mockResolvedValue('queued');
const mockMarkFailedIfActive = vi.fn().mockResolvedValue(true);

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(function () {
      return {
        getCachedSwagger: mockGetCachedSwagger,
        getScan: mockGetScan,
        updateScanStatus: mockUpdateScanStatus,
        getScanStatus: mockGetScanStatus,
        markFailedIfActive: mockMarkFailedIfActive,
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

  const createMockWs = (): any => {
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

    mockGetScanStatus.mockResolvedValue('queued');
    mockMarkFailedIfActive.mockResolvedValue(true);

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
        put: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true)
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
      const res = await handler.handle(new Request('http://localhost/sse?connectionId=conn1&userId=u1&origin=http%3A%2F%2Ftest.com'));
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(stateManager.sseStreams.get('conn1')?.userId).toBe('u1');

      // Trigger cancel to clean up
      const reader = res.body?.getReader();
      await reader?.cancel();
      expect(stateManager.sseStreams.has('conn1')).toBe(false);
    });

    it('creates a stream without origin query parameter', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/sse?connectionId=conn1&userId=u1'));
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
      stateManager.sseStreams.set('conn1', { controller: mockController, userId: 'u1' });

      const res = await handler.handle(new Request('http://localhost/sse-send?connectionId=conn1&userId=u1', { method: 'POST', body: 'hello-world' }));
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
      stateManager.sseStreams.set('conn1', { controller: mockController, userId: 'u1' });

      const res = await handler.handle(new Request('http://localhost/sse-send?connectionId=conn1&userId=u1', { method: 'POST', body: 'hello-world' }));
      expect(res.status).toBe(410);
      expect(stateManager.sseStreams.has('conn1')).toBe(false);
    });
  });

  describe('MCP connection ownership', () => {
    it('refuses /sse without the user who opens it', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/sse?connectionId=conn1'));
      expect(res.status).toBe(400);
      expect(stateManager.sseStreams.has('conn1')).toBe(false);
    });

    it("answers someone else's connection like a missing one, and writes nothing to it", async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const mockController = { enqueue: vi.fn() } as any;
      stateManager.sseStreams.set('conn1', { controller: mockController, userId: 'u1' });

      for (const query of ['connectionId=conn1&userId=u2', 'connectionId=conn1']) {
        const send = await handler.handle(new Request(`http://localhost/sse-send?${query}`, { method: 'POST', body: '{"forged":true}' }));
        expect(send.status).toBe(404);
        const owner = await handler.handle(new Request(`http://localhost/sse-owner?${query}`));
        expect(owner.status).toBe(404);
      }
      expect(mockController.enqueue).not.toHaveBeenCalled();
      expect(stateManager.sseStreams.has('conn1')).toBe(true);

      const owner = await handler.handle(new Request('http://localhost/sse-owner?connectionId=conn1&userId=u1'));
      expect(owner.status).toBe(204);
      const missing = await handler.handle(new Request('http://localhost/sse-owner?connectionId=nope&userId=u1'));
      expect(missing.status).toBe(404);
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
      mockState.getTags.mockReturnValue(['runner', 'shared']); // shared runner
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

    it('returns 503 and leaves scan state in DO storage when compatible runner has reached MAX_ACTIVE_JOBS_PER_RUNNER', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      mockWs.serializeAttachment({ activeJobs: Array.from({ length: 10 }, (_, i) => `job-${i}`) });
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-queued', config: { base_url: 'http://example.com' } })
      }));

      expect(res.status).toBe(503);
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(stateManager.jobs.has('run-queued')).toBe(false);
      // Config stays stored so QueueService can dispatch it when a job finishes
      expect(mockState.storage.put).toHaveBeenCalledWith('config:run-queued', { base_url: 'http://example.com' });
      expect(deletedKeys(mockState)).not.toContain('config:run-queued');
    });

    it('skips full runner and dispatches to a second runner with a free slot', async () => {
      const stateManager = new StateManager(mockState);
      const fullRunner = createMockWs();
      fullRunner.serializeAttachment({ activeJobs: Array.from({ length: 10 }, (_, i) => `job-${i}`) });
      const freeRunner = createMockWs();
      freeRunner.serializeAttachment({ activeJobs: ['job-other'] });

      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(fullRunner);
      stateManager.runners.add(freeRunner);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: {} })
      }));

      expect(res.status).toBe(200);
      expect(fullRunner.send).not.toHaveBeenCalled();
      expect(freeRunner.send).toHaveBeenCalledTimes(1);
      expect(stateManager.jobs.get('run1')).toBe(freeRunner);
    });

    it('queues scan (503) instead of falling back to a shared runner when the user private runner is full (Review #4)', async () => {
      const stateManager = new StateManager(mockState);
      const privateRunner = createMockWs();
      privateRunner.serializeAttachment({ activeJobs: Array.from({ length: 10 }, (_, i) => `job-${i}`) });
      const sharedRunner = createMockWs();
      sharedRunner.serializeAttachment({ activeJobs: [] });

      mockState.getTags.mockImplementation((ws: any) => {
        if (ws === privateRunner) return ['runner', 'pubkey-user', 'user_id:user-1'];
        return ['runner', 'shared']; // shared
      });
      stateManager.runners.add(privateRunner);
      stateManager.runners.add(sharedRunner);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-private', config: {}, userPublicKey: 'pubkey-user', userId: 'user-1' })
      }));

      expect(res.status).toBe(503);
      expect(privateRunner.send).not.toHaveBeenCalled();
      expect(sharedRunner.send).not.toHaveBeenCalled();
      expect(stateManager.jobs.has('run-private')).toBe(false);
    });

    it('fails closed (returns 503) when runner attachment deserialization throws (Review #8)', async () => {
      const stateManager = new StateManager(mockState);
      const corruptRunner = createMockWs();
      corruptRunner.deserializeAttachment.mockImplementation(() => {
        throw new Error('corrupt attachment');
      });
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(corruptRunner);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-corrupt', config: {} })
      }));

      expect(res.status).toBe(503);
      expect(corruptRunner.send).not.toHaveBeenCalled();
    });

    it('dispatches job to compatible runner', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']); // shared runner
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
      expect(deletedKeys(mockState)).toContain('config:run1');
    });

    it('forces allow_private_ips off for a job sent to a shared runner', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: { base_url: 'http://169.254.169.254/', security: { allow_private_ips: true, timeout: 5 } } })
      }));

      expect(res.status).toBe(200);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.payload.config.security).toEqual({ allow_private_ips: false, timeout: 5 });
    });

    it('keeps allow_private_ips for a job sent to the owner\'s own runner', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'user_id:user-1']);
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', userId: 'user-1', config: { security: { allow_private_ips: true } } })
      }));

      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.payload.config.security.allow_private_ips).toBe(true);
    });

    it('never sends another user\'s scan to a runner connected with a user API token', async () => {
      const stateManager = new StateManager(mockState);
      // Keyless, not shared: a runner some other user connected with their own API key.
      mockState.getTags.mockReturnValue(['runner', 'user_id:attacker']);
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', userId: 'victim', config: { global_headers: { Authorization: 'Bearer secret' } } })
      }));

      expect(res.status).toBe(503);
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('does not fall back to a shared runner for an owner who registered a private runner key', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', userId: 'user-1', userPublicKey: 'pubkey-offline', config: {} })
      }));

      expect(res.status).toBe(503);
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('dispatches job to the private runner owned by the scan owner', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc', 'user_id:user-1']); // private runner
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: {}, userPublicKey: 'pubkey-abc', userId: 'user-1' })
      }));

      expect(res.status).toBe(200);
      expect(stateManager.jobs.get('run1')).toBe(mockWs);
    });

    it('never dispatches to another user\'s private runner, even when the scan owner claimed its key', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc', 'user_id:victim']);
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: {}, userPublicKey: 'pubkey-abc', userId: 'attacker' })
      }));

      expect(res.status).toBe(503);
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('handles dispatch failure gracefully', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
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

    it('loads config from R2 and honours settings.disable_shared_runners from R2 (Threat model invariant 6)', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']); // shared runner
      stateManager.runners.add(mockWs);

      const configKey = `scans/configs/run1/${crypto.randomUUID()}.json`;
      mockEnv.STORAGE.get = vi.fn().mockResolvedValue({
        text: async () => JSON.stringify({ settings: { disable_shared_runners: true } })
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey })
      }));

      expect(res.status).toBe(503);
      expect(mockState.storage.put).toHaveBeenCalledWith('config_ref:run1', configKey);
      expect(mockState.storage.put).toHaveBeenCalledWith('config_meta:run1', { disableShared: true });
    });

    it('returns 200 on second /dispatch for the same runId after already dispatched without re-sending or reading R2', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.jobs.set('run1', mockWs); // already dispatched

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey: `scans/configs/run1/${crypto.randomUUID()}.json` })
      }));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Already dispatched');
      expect(mockEnv.STORAGE.get).not.toHaveBeenCalled();
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(mockState.storage.put).not.toHaveBeenCalled();
    });

    it('returns 200 without deleting R2 if job was assigned during getScanConfig await (Round 4 item 2)', async () => {
      const stateManager = new StateManager(mockState);
      const configKey = `scans/configs/run1/${crypto.randomUUID()}.json`;
      mockEnv.STORAGE.get = vi.fn().mockImplementation(async () => {
        // Another path assigns the job during getScanConfig await
        stateManager.jobs.set('run1', mockWs);
        return {
          text: async () => JSON.stringify({ base_url: 'http://example.com' })
        };
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey })
      }));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Already dispatched');
      expect(mockEnv.STORAGE.delete).not.toHaveBeenCalled();
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('returns 409 and deletes storage keys and R2 object if scan is not queued (Round 4 item 4)', async () => {
      const stateManager = new StateManager(mockState);
      const configKey = `scans/configs/run1/${crypto.randomUUID()}.json`;
      mockEnv.STORAGE.get = vi.fn().mockResolvedValue({
        text: async () => JSON.stringify({ base_url: 'http://example.com' })
      });
      mockGetScanStatus.mockResolvedValueOnce('cancelled');

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey })
      }));

      expect(res.status).toBe(409);
      expect(await res.text()).toBe('Scan not dispatchable');
      expect(mockGetScanStatus).toHaveBeenCalledWith('run1');
      expect(deletedKeys(mockState)).toContain('config:run1');
      expect(deletedKeys(mockState)).toContain('config_ref:run1');
      expect(deletedKeys(mockState)).toContain('config_meta:run1');
      expect(deletedKeys(mockState)).toContain('user_public_key:run1');
      expect(mockEnv.STORAGE.delete).toHaveBeenCalledWith(configKey);
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('returns 409 and deletes storage keys if scan is not queued on legacy config path (Round 4 item 4)', async () => {
      const stateManager = new StateManager(mockState);
      mockGetScanStatus.mockResolvedValueOnce('failed');

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', config: { base_url: 'http://example.com' } })
      }));

      expect(res.status).toBe(409);
      expect(await res.text()).toBe('Scan not dispatchable');
      expect(mockGetScanStatus).toHaveBeenCalledWith('run1');
      expect(deletedKeys(mockState)).toContain('config:run1');
      expect(deletedKeys(mockState)).toContain('config_ref:run1');
      expect(deletedKeys(mockState)).toContain('config_meta:run1');
      expect(deletedKeys(mockState)).toContain('user_public_key:run1');
      expect(mockEnv.STORAGE.delete).not.toHaveBeenCalled();
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('deletes R2 object and config_ref after successful send (Threat model invariant 7)', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(mockWs);

      const configKey = `scans/configs/run1/${crypto.randomUUID()}.json`;
      mockEnv.STORAGE.get = vi.fn().mockResolvedValue({
        text: async () => JSON.stringify({ base_url: 'http://test' })
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      const dispatchMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(dispatchMsg.type).toBe('job_dispatch');
      expect(dispatchMsg.payload.runId).toBe('run1');
      expect(dispatchMsg.payload.config).toEqual({ base_url: 'http://test', security: { allow_private_ips: false } });
      expect(dispatchMsg.payload.configKey).toBeUndefined();

      expect(deletedKeys(mockState)).toContain('config_ref:run1');
      expect(deletedKeys(mockState)).toContain('config_meta:run1');
      expect(mockEnv.STORAGE.delete).toHaveBeenCalledWith(configKey);
    });

    it('keeps R2 object and storage ref after send failure (Threat model invariant 7)', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      mockWs.send.mockImplementation(() => {
        throw new Error('send error');
      });
      stateManager.runners.add(mockWs);

      const configKey = `scans/configs/run1/${crypto.randomUUID()}.json`;
      mockEnv.STORAGE.get = vi.fn().mockResolvedValue({
        text: async () => JSON.stringify({ base_url: 'http://test' })
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey })
      }));

      expect(res.status).toBe(500);
      expect(deletedKeys(mockState)).not.toContain('config_ref:run1');
      expect(mockEnv.STORAGE.delete).not.toHaveBeenCalledWith(configKey);
    });

    it('returns 400 for invalid configKey (Threat model invariant 3)', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey: '../bad-key' })
      }));

      expect(res.status).toBe(400);
    });

    it('returns 400 when configKey belongs to run A but payload.runId is run B without reading R2 (Threat model T3)', async () => {
      const stateManager = new StateManager(mockState);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const configKeyRunA = `scans/configs/run-A/${crypto.randomUUID()}.json`;

      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-B', configKey: configKeyRunA })
      }));

      expect(res.status).toBe(400);
      expect(mockEnv.STORAGE.get).not.toHaveBeenCalled();
      expect(mockState.storage.put).not.toHaveBeenCalled();
    });

    it('returns 500 when R2 object is missing and nothing is dispatched (Threat model invariant 6)', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);

      const configKey = `scans/configs/run1/${crypto.randomUUID()}.json`;
      mockEnv.STORAGE.get = vi.fn().mockResolvedValue(null);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run1', configKey })
      }));

      expect(res.status).toBe(500);
      expect(mockWs.send).not.toHaveBeenCalled();
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

    it('cleans up undispatched scan on stop command by marking failed in D1, then deleting storage keys and R2 object (Threat model invariant 7)', async () => {
      const stateManager = new StateManager(mockState);
      const configKey = `scans/configs/run-stopped/${crypto.randomUUID()}.json`;
      mockState.storage.get = vi.fn().mockImplementation(async (key: string) => {
        if (key === 'config_ref:run-stopped') return configKey;
        return null;
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-stopped', command: 'stop' })
      }));

      expect(res.status).toBe(404);
      expect(mockMarkFailedIfActive).toHaveBeenCalledWith('run-stopped', expect.any(String));
      expect(deletedKeys(mockState)).toContain('config_ref:run-stopped');
      expect(deletedKeys(mockState)).toContain('config_meta:run-stopped');
      expect(deletedKeys(mockState)).toContain('config:run-stopped');
      expect(deletedKeys(mockState)).toContain('user_public_key:run-stopped');
      expect(mockEnv.STORAGE.delete).toHaveBeenCalledWith(configKey);
    });

    it('deletes nothing if D1 update throws on stop of undispatched scan', async () => {
      const stateManager = new StateManager(mockState);
      const configKey = `scans/configs/run-stopped/${crypto.randomUUID()}.json`;
      mockState.storage.get = vi.fn().mockImplementation(async (key: string) => {
        if (key === 'config_ref:run-stopped') return configKey;
        return null;
      });
      mockMarkFailedIfActive.mockRejectedValueOnce(new Error('D1 update error'));

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-stopped', command: 'stop' })
      }));

      expect(res.status).toBe(404);
      expect(mockMarkFailedIfActive).toHaveBeenCalledWith('run-stopped', expect.any(String));
      expect(mockState.storage.delete).not.toHaveBeenCalled();
      expect(mockEnv.STORAGE.delete).not.toHaveBeenCalled();
    });

    it('deletes nothing if markFailedIfActive returns false on stop (scan already completed or failed) (Round 4 item 3)', async () => {
      const stateManager = new StateManager(mockState);
      const configKey = `scans/configs/run-stopped/${crypto.randomUUID()}.json`;
      mockState.storage.get = vi.fn().mockImplementation(async (key: string) => {
        if (key === 'config_ref:run-stopped') return configKey;
        return null;
      });
      mockMarkFailedIfActive.mockResolvedValueOnce(false);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-stopped', command: 'stop' })
      }));

      expect(res.status).toBe(404);
      expect(mockMarkFailedIfActive).toHaveBeenCalledWith('run-stopped', expect.any(String));
      expect(mockState.storage.delete).not.toHaveBeenCalled();
      expect(mockEnv.STORAGE.delete).not.toHaveBeenCalled();
    });

    it('does not delete anything and preserves running job lifecycle when runner holds job on stop', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.jobs.set('run-running', mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-running', command: 'stop' })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
      expect(mockUpdateScanStatus).not.toHaveBeenCalled();
      expect(mockState.storage.delete).not.toHaveBeenCalled();
      expect(mockEnv.STORAGE.delete).not.toHaveBeenCalled();
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
      mockState.getTags.mockReturnValue(['runner', 'shared']);
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
        body: JSON.stringify({ url: 'http://example.com/swagger.json', userId: 'caller' })
      }));

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.fromCache).toBe(true);
      expect(data.basePath).toBe('http://127.0.0.1:8788');
      expect(data.endpoints).toEqual({ '/api': {} });
    });

    it('looks up and fills the spec cache only under the caller\'s own key', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(mockWs);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      const pending = handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://internal-api.corp.example/openapi.json', userId: 'tenant-b' })
      }));
      await vi.waitFor(() => expect(stateManager.pendingParseUrls.size).toBe(1));

      expect(mockGetCachedSwagger).toHaveBeenCalledWith('user:tenant-b|https://internal-api.corp.example/openapi.json');
      const [reqId, cacheKey] = [...stateManager.pendingParseUrls.entries()][0];
      expect(cacheKey).toBe('user:tenant-b|https://internal-api.corp.example/openapi.json');
      expect(stateManager.pendingParseRunners.get(reqId)).toBe(mockWs);
      stateManager.pendingParses.get(reqId)!(new Response('{}'));
      await pending;
    });

    it('logs error and falls back on cache DB retrieval fail', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'shared']);

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
        body: JSON.stringify({ url: 'http://example.com/swagger.json', userId: 'caller' })
      }));

      expect(res.status).toBe(200);
      expect(mockLogError).toHaveBeenCalled();
    });

    it.each([
      ['an anonymous caller', { url: 'http://example.com/swagger.json' }],
      ['a caller sending headers', { url: 'http://example.com/swagger.json', userId: 'caller', headers: { Authorization: 'Bearer t' } }],
      ['a caller sending cookies', { url: 'http://example.com/swagger.json', userId: 'caller', cookies: { sid: 's' } }],
    ])('neither reads nor fills the spec cache for %s', async (_who, body) => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(mockWs);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockClear();

      const pending = handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }));
      await vi.waitFor(() => expect(stateManager.pendingParseUrls.size).toBe(1));

      expect(mockGetCachedSwagger).not.toHaveBeenCalled();
      const [reqId, cacheKey] = [...stateManager.pendingParseUrls.entries()][0];
      expect(cacheKey).toBe('rawSpec');
      stateManager.pendingParses.get(reqId)!(new Response('{}'));
      await pending;
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

    it('uses any connected runner when auth is disabled (local mode has no tenants)', async () => {
      mockEnv.AUTH_ENABLED = 'false';
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'user_id:anon-dev-user']);
      stateManager.runners.add(mockWs);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      const pending = handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json', userId: '' })
      }));
      await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());
      const reqId = [...stateManager.pendingParses.keys()][0];
      stateManager.pendingParses.get(reqId)!(new Response('{}'));
      expect((await pending).status).toBe(200);

      const startRes = await handler.handle(new Request('http://localhost/start-run?runId=r-local', {
        method: 'POST',
        body: JSON.stringify({ config: {} })
      }));
      expect(startRes.status).toBe(200);
      delete mockEnv.AUTH_ENABLED;
    });

    it('never sends a parse request (with its headers and cookies) to another tenant\'s runner', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc', 'user_id:someone-else']); // Private runner
      stateManager.runners.add(mockWs);

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      mockGetCachedSwagger.mockResolvedValue(null);

      const res = await handler.handle(new Request('http://localhost/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://example.com/swagger.json', userId: 'caller', headers: { Authorization: 'Bearer secret' } })
      }));

      expect(res.status).toBe(503);
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(stateManager.pendingParseUrls.size).toBe(0);
    });

    it('sends parse_request to matching private runner and awaits response', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc', 'user_id:caller']); // Private runner

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
        body: JSON.stringify({ url: 'http://example.com/swagger.json', userPublicKey: 'pubkey-abc', userId: 'caller' })
      }));

      expect(res.status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('sends parse_request to runner and awaits response', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'shared']);

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
      mockState.getTags.mockReturnValue(['runner', 'shared']);
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
      mockState.getTags.mockReturnValue(['runner', 'shared']);

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
    it('does not reserve a runner slot for a body that fails to parse', async () => {
      const stateManager = new StateManager(mockState);
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      stateManager.runners.add(mockWs);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);

      const res = await handler.handle(new Request('http://localhost/start-run?runId=bad-1', { method: 'POST', body: '{not json' }));

      expect(res.status).toBe(400);
      expect(stateManager.jobs.has('bad-1')).toBe(false);
      expect(mockWs.serializeAttachment).not.toHaveBeenCalled();
    });

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
      mockState.getTags.mockReturnValue(['runner', 'shared']); // shared runner

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
      mockState.getTags.mockReturnValue(['runner', 'shared']);
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
      mockState.getTags.mockReturnValue(['runner', 'name:runner-1', 'version:v1.2.3', 'pubkey-abc', 'user_id:user-1']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123', activeJobs: ['job1'] });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners'));

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.runners.length).toBe(1);
      expect(data.runners[0]).toEqual({
        connectionId: 'conn123',
        name: 'runner-1',
        ownerId: 'user-1',
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
      mockState.getTags.mockReturnValue(['runner', 'shared']);
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
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc', 'user_id:user-1']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123&userId=user-1', {
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
      mockState.getTags.mockReturnValue(['runner', 'shared']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123', {
        method: 'POST'
      }));

      expect(res.status).toBe(403);
    });

    it('lets anyone restart a runner when auth is disabled (local mode has no tenants)', async () => {
      mockEnv.AUTH_ENABLED = 'false';
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'user_id:anon-dev-user']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123&userId=real-user', { method: 'POST' }));
      expect(res.status).toBe(200);
      delete mockEnv.AUTH_ENABLED;
    });

    it('returns 403 if the caller does not own the runner', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc', 'user_id:victim']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123&userId=attacker', {
        method: 'POST'
      }));

      expect(res.status).toBe(403);
    });

    it('returns 500 if send restart command throws error', async () => {
      const stateManager = new StateManager(mockState);
      stateManager.runners.add(mockWs);
      mockState.getTags.mockReturnValue(['runner', 'pubkey-abc', 'user_id:user-1']);
      mockWs.deserializeAttachment.mockReturnValue({ connectionId: 'conn123' });
      mockWs.send.mockImplementation(() => {
        throw new Error('dropped connection');
      });

      const handler = new RequestHandler(mockEnv, mockState, stateManager, mockQueueService);
      const res = await handler.handle(new Request('http://localhost/runners/restart?connectionId=conn123&userId=user-1', {
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
