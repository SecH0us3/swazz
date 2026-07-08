import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketHandler } from '../../../src/coordinator/WebSocketHandler';
import { StateManager } from '../../../src/coordinator/StateManager';
import { QueueService } from '../../../src/coordinator/QueueService';

const mockGetCachedSwaggerDetails = vi.fn();
const mockUpsertSwaggerCache = vi.fn();
const mockLogError = vi.fn();
const mockLogWarn = vi.fn();

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(function () {
      return {
        getCachedSwaggerDetails: mockGetCachedSwaggerDetails,
        upsertSwaggerCache: mockUpsertSwaggerCache,
      };
    })
  };
});

vi.mock('../../../../common/logging/logger', () => ({
  logError: (...args: any[]) => mockLogError(...args),
  logWarn: (...args: any[]) => mockLogWarn(...args)
}));

describe('WebSocketHandler', () => {
  let mockState: any;
  let mockEnv: any;
  let mockWs: any;
  let mockClientWs: any;
  let spyImportKey: any;
  let spyVerify: any;
  let spyDigest: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWs = {
      deserializeAttachment: vi.fn().mockReturnValue({}),
      serializeAttachment: vi.fn(),
      send: vi.fn(),
      close: vi.fn()
    };

    mockClientWs = {
      send: vi.fn()
    };

    mockState = {
      getWebSockets: vi.fn().mockReturnValue([]),
      getTags: vi.fn().mockReturnValue(['client', 'run-123']),
      waitUntil: vi.fn(),
      storage: {
        get: vi.fn().mockResolvedValue(new Map()),
        delete: vi.fn().mockResolvedValue(true)
      }
    };

    mockEnv = {
      VERSION: '1.0.0',
      JWT_SECRET: 'test-secret',
      STORAGE: {
        put: vi.fn().mockResolvedValue(true)
      },
      FINDINGS_QUEUE: {
        send: vi.fn().mockResolvedValue(true)
      }
    };

    spyImportKey = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue('mock-crypto-key' as any);
    spyVerify = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);
    spyDigest = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  });

  afterEach(() => {
    spyImportKey.mockRestore();
    spyVerify.mockRestore();
    spyDigest.mockRestore();
  });

  it('should correctly handle WebSocket close for clients', async () => {
    mockState.getTags.mockReturnValue(['client', 'name:cli', 'version:1.0', 'user_id:admin', 'run-123']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.clients.set('run-123', new Set([mockWs]));
    await handler.handleClose(mockWs, 1000, 'Normal', true);

    expect(stateManager.clients.has('run-123')).toBe(false);
  });

  it('should authenticate a pending runner with a valid challenge response', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'name:test-runner', 'version:1.2.3', 'user_id:user-1', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.pendingChallenges.set(mockWs, 'challenge-nonce-123');

    const msg = {
      type: 'challenge_response',
      signature: '1122334455'
    };

    const spyDispatch = vi.spyOn(queueService, 'checkAndDispatchQueuedScans').mockResolvedValue();

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    expect(spyImportKey).toHaveBeenCalled();
    expect(spyVerify).toHaveBeenCalled();
    expect(stateManager.runners.has(mockWs)).toBe(true);
    expect(stateManager.pendingChallenges.has(mockWs)).toBe(false);
    expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth_ok' }));
    expect(spyDispatch).toHaveBeenCalledWith(mockWs);
  });

  it('should reject pending runner if signature is invalid', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.pendingChallenges.set(mockWs, 'challenge-nonce-123');
    spyVerify.mockResolvedValue(false);

    const msg = {
      type: 'challenge_response',
      signature: '1122334455'
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    expect(stateManager.runners.has(mockWs)).toBe(false);
    expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth_failed', error: 'Invalid challenge signature' }));
    expect(mockWs.close).toHaveBeenCalledWith(1008, 'Authentication failed');
  });

  it('should process parse_result message, cache details, and resolve the pending parse', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    const mockResolve = vi.fn();
    stateManager.pendingParses.set('req-123', mockResolve);
    stateManager.pendingParseUrls.set('req-123', 'http://api.target/swagger.json');

    mockGetCachedSwaggerDetails.mockResolvedValue(null);

    const msg = {
      type: 'parse_result',
      reqId: 'req-123',
      payload: {
        basePath: 'http://bbad.secmy.app/api',
        endpoints: [{ path: '/users', method: 'GET' }],
        rawSpec: 'raw-swagger-content'
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    expect(mockResolve).toHaveBeenCalled();
    const responseArg = mockResolve.mock.calls[0][0];
    expect(responseArg).toBeInstanceOf(Response);
    expect(responseArg.status).toBe(200);

    const body = await responseArg.json();
    expect(body.basePath).toBe('http://127.0.0.1:8788/api');
    expect(body.rawSpec).toBeUndefined();

    const waitUntilPromise = mockState.waitUntil.mock.calls[0]?.[0];
    if (waitUntilPromise) {
      await waitUntilPromise;
    }
    expect(mockEnv.STORAGE.put).toHaveBeenCalled();
    expect(mockUpsertSwaggerCache).toHaveBeenCalled();
  });

  it('should send events to FINDINGS_QUEUE and broadcast to clients', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.clients.set('run-456', new Set([mockClientWs]));

    const msg = {
      type: 'event',
      runId: 'run-456',
      payload: {
        type: 'log',
        message: 'Scan started'
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    expect(mockState.waitUntil).toHaveBeenCalled();
    expect(mockEnv.FINDINGS_QUEUE.send).toHaveBeenCalledWith({
      scanId: 'run-456',
      type: 'event',
      payload: msg.payload
    });
    expect(mockClientWs.send).toHaveBeenCalledWith(JSON.stringify(msg.payload));
  });

  it('should cleanup active jobs on scan error or complete events', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.jobs.set('run-456', mockWs);
    mockWs.deserializeAttachment.mockReturnValue({ activeJobs: ['run-456'] });

    const msg = {
      type: 'error',
      runId: 'run-456',
      payload: {
        error: 'Scan failed'
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    expect(stateManager.jobs.has('run-456')).toBe(false);
    expect(mockWs.serializeAttachment).toHaveBeenCalledWith({
      activeJobs: []
    });
  });

  it('should handle runner connection close by deleting runner resources', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.runners.add(mockWs);
    stateManager.pendingChallenges.set(mockWs, 'nonce');
    stateManager.jobs.set('run-789', mockWs);

    await handler.handleClose(mockWs, 1001, 'Going Away', true);

    expect(stateManager.runners.has(mockWs)).toBe(false);
    expect(stateManager.pendingChallenges.has(mockWs)).toBe(false);
    expect(stateManager.jobs.has('run-789')).toBe(false);
  });

  it('should handle handleError by closing with code 1011', async () => {
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    const spyClose = vi.spyOn(handler, 'handleClose').mockResolvedValue();

    await handler.handleError(mockWs, new Error('Websocket crash'));

    expect(spyClose).toHaveBeenCalledWith(mockWs, 1011, 'Error', false);
  });

  it('should decode and parse ArrayBuffer messages correctly', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'name:test-runner', 'version:1.2.3', 'user_id:user-1', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.pendingChallenges.set(mockWs, 'challenge-nonce-123');

    const msg = {
      type: 'challenge_response',
      signature: '1122334455'
    };

    const arrayBuffer = new TextEncoder().encode(JSON.stringify(msg)).buffer;
    vi.spyOn(queueService, 'checkAndDispatchQueuedScans').mockResolvedValue();

    await handler.handleMessage(mockWs, arrayBuffer);

    expect(spyImportKey).toHaveBeenCalled();
    expect(spyVerify).toHaveBeenCalled();
    expect(stateManager.runners.has(mockWs)).toBe(true);
  });

  it('should return early on message if type is invalid', async () => {
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    await handler.handleMessage(mockWs, {} as any);
    expect(spyImportKey).not.toHaveBeenCalled();
  });

  it('should log verify fail if verification throws error', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.pendingChallenges.set(mockWs, 'challenge-nonce-123');
    spyVerify.mockRejectedValue(new Error('verification logic failure'));

    const msg = {
      type: 'challenge_response',
      signature: '1122334455'
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));
    expect(mockLogError).toHaveBeenCalled();
    expect(mockWs.close).toHaveBeenCalledWith(1008, 'Authentication failed');
  });

  it('should close pending runner with Invalid auth request format if message JSON is invalid', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.pendingChallenges.set(mockWs, 'challenge-nonce-123');

    await handler.handleMessage(mockWs, 'invalid_json');
    expect(mockLogError).toHaveBeenCalled();
    expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid auth request format');
  });

  it('should log error if background swagger cache write fails', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    const mockResolve = vi.fn();
    stateManager.pendingParses.set('req-123', mockResolve);
    stateManager.pendingParseUrls.set('req-123', 'http://api.target/swagger.json');

    mockGetCachedSwaggerDetails.mockRejectedValue(new Error('R2 write error'));

    const msg = {
      type: 'parse_result',
      reqId: 'req-123',
      payload: {
        basePath: 'http://example.com',
        endpoints: []
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    const waitUntilPromise = mockState.waitUntil.mock.calls[0]?.[0];
    if (waitUntilPromise) {
      await waitUntilPromise;
    }
    expect(mockLogError).toHaveBeenCalled();
  });

  it('should catch and log error if clientPayload.basePath is not a string', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    const mockResolve = vi.fn();
    stateManager.pendingParses.set('req-123', mockResolve);
    stateManager.pendingParseUrls.set('req-123', 'http://api.target/swagger.json');

    const msg = {
      type: 'parse_result',
      reqId: 'req-123',
      payload: {
        basePath: 1234, // not a string
        endpoints: []
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));
    expect(mockLogError).toHaveBeenCalled();
  });

  it('should log error if FINDINGS_QUEUE.send fails', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    mockEnv.FINDINGS_QUEUE.send.mockRejectedValue(new Error('Queue unavailable'));

    const msg = {
      type: 'event',
      runId: 'run-456',
      payload: {
        type: 'log',
        message: 'Scan started'
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    const waitUntilPromise = mockState.waitUntil.mock.calls[0]?.[0];
    if (waitUntilPromise) {
      await waitUntilPromise;
    }
    expect(mockLogError).toHaveBeenCalled();
  });

  it('should log error if runner message is invalid JSON', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    await handler.handleMessage(mockWs, 'invalid_json');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('should handle client connection ws.send throwing error gracefully', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    const throwingClientWs = {
      send: vi.fn().mockImplementation(() => {
        throw new Error('connection closed');
      })
    };
    stateManager.clients.set('run-456', new Set([throwingClientWs as any]));

    const msg = {
      type: 'event',
      runId: 'run-456',
      payload: {
        type: 'log',
        message: 'Scan status'
      }
    };

    await expect(handler.handleMessage(mockWs, JSON.stringify(msg))).resolves.not.toThrow();
  });

  it('should support cleanups when event payload has type: complete', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.jobs.set('run-456', mockWs);
    mockWs.deserializeAttachment.mockReturnValue({ activeJobs: ['run-456'] });

    const msg = {
      type: 'event',
      runId: 'run-456',
      payload: {
        type: 'complete'
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    expect(stateManager.jobs.has('run-456')).toBe(false);
  });

  it('should close pending runner when challenge authentication state is missing from pendingChallenges', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    const msg = {
      type: 'challenge_response',
      signature: '1122334455'
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));
    expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid authentication state');
  });

  it('should log warning if verified private runner version is outdated', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'name:my-runner', 'version:v0.9.0', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.pendingChallenges.set(mockWs, 'challenge-nonce-123');

    const msg = {
      type: 'challenge_response',
      signature: '1122334455'
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('should write cache to R2 when existing swagger details endpoints hash differs from new endpoints hash', async () => {
    mockState.getTags.mockReturnValue(['runner']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    const mockResolve = vi.fn();
    stateManager.pendingParses.set('req-123', mockResolve);
    stateManager.pendingParseUrls.set('req-123', 'http://api.target/swagger.json');

    mockGetCachedSwaggerDetails.mockResolvedValue({
      endpoints_hash: 'different-old-hash',
      endpoints_r2_key: 'specs/parsed/old-key.json',
      raw_spec_r2_key: 'specs/raw/old-key.json'
    });

    const msg = {
      type: 'parse_result',
      reqId: 'req-123',
      payload: {
        basePath: 'http://example.com',
        endpoints: [{ path: '/users', method: 'GET' }],
        rawSpec: 'raw-swagger-content'
      }
    };

    await handler.handleMessage(mockWs, JSON.stringify(msg));

    const waitUntilPromise = mockState.waitUntil.mock.calls[0]?.[0];
    if (waitUntilPromise) {
      await waitUntilPromise;
    }
    expect(mockEnv.STORAGE.put).toHaveBeenCalled();
    expect(mockUpsertSwaggerCache).toHaveBeenCalled();
  });
});
