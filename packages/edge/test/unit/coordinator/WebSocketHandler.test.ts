import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketHandler } from '../../../src/coordinator/WebSocketHandler';
import { StateManager } from '../../../src/coordinator/StateManager';
import { QueueService } from '../../../src/coordinator/QueueService';

const mockGetCachedSwaggerDetails = vi.fn();
const mockUpsertSwaggerCache = vi.fn();

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
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.clients.set('run-123', new Set([mockWs]));
    await handler.handleClose(mockWs, 1000, 'Normal', true);

    expect(stateManager.clients.has('run-123')).toBe(false);
  });

  it('should authenticate a pending runner with a valid challenge response', async () => {
    mockState.getTags.mockReturnValue(['runner-pending', 'aabbccddeeff']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);
    const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

    stateManager.pendingChallenges.set(mockWs, 'challenge-nonce-123');

    const msg = {
      type: 'challenge_response',
      signature: '1122334455'
    };

    // Spy on checkAndDispatchQueuedScans
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
    // basePath should be rewritten because JWT_SECRET = 'test-secret' and bbad.secmy.app is present
    expect(body.basePath).toBe('http://127.0.0.1:8788/api');
    // rawSpec should be deleted from client payload
    expect(body.rawSpec).toBeUndefined();

    // R2 storage should have been updated in background (allow async loop to trigger)
    await new Promise(resolve => setTimeout(resolve, 10));
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
});
