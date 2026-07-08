import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueService } from '../../../src/coordinator/QueueService';
import { StateManager } from '../../../src/coordinator/StateManager';

const mockGetQueuedScans = vi.fn();
const mockUpdateScanStatus = vi.fn();
const mockGetScanConfigByProject = vi.fn();

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(function () {
      return {
        getQueuedScans: mockGetQueuedScans,
        updateScanStatus: mockUpdateScanStatus,
        getScanConfigByProject: mockGetScanConfigByProject,
      };
    })
  };
});

describe('QueueService', () => {
  let mockState: any;
  let mockEnv: any;
  let mockWs: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWs = {
      deserializeAttachment: vi.fn().mockReturnValue({}),
      serializeAttachment: vi.fn(),
      send: vi.fn()
    };

    mockState = {
      getWebSockets: vi.fn().mockReturnValue([]),
      getTags: vi.fn().mockReturnValue(['runner', 'key-123']),
      storage: {
        get: vi.fn().mockResolvedValue(new Map()),
        delete: vi.fn().mockResolvedValue(true)
      }
    };

    mockEnv = {};
    
    mockGetQueuedScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', target_url: 'http://example.com' }
    ]);
    mockUpdateScanStatus.mockResolvedValue(true);
    mockGetScanConfigByProject.mockResolvedValue(null);
  });

  it('should dispatch scan matching user public key', async () => {
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalled();
    const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentMsg.type).toBe('job_dispatch');
    expect(sentMsg.payload.runId).toBe('scan-1');
    expect(sentMsg.payload.userPublicKey).toBe('key-123');
    expect(stateManager.jobs.get('scan-1')).toBe(mockWs);
    expect(mockState.storage.delete).toHaveBeenCalledWith('config:scan-1');
    expect(mockState.storage.delete).toHaveBeenCalledWith('user_public_key:scan-1');
  });

  it('should not dispatch private scan if public key mismatches', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner', 'key-different']);
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(stateManager.jobs.get('scan-1')).toBeUndefined();
  });

  it('should dispatch public scan to shared runner (no public key tag)', async () => {
    // Runner has no public key tag, is a shared runner
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    // Scan is public (no userPublicKey)
    mockGetQueuedScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, target_url: 'http://example.com' }
    ]);
    
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalled();
    const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentMsg.payload.userPublicKey).toBe('');
    expect(stateManager.jobs.get('scan-1')).toBe(mockWs);
  });

  it('should not dispatch public scan to shared runner if disable_shared_runners is set to true', async () => {
    // Runner is a shared runner
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    // Scan is public (no userPublicKey)
    mockGetQueuedScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, target_url: 'http://example.com' }
    ]);
    // Config in storage disables shared runners
    const mockStorageMap = new Map();
    mockStorageMap.set('config:scan-1', { settings: { disable_shared_runners: true } });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(stateManager.jobs.get('scan-1')).toBeUndefined();
  });

  it('should fallback to fetching scan config from project in DB if not in DO storage', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner', 'key-123']);
    mockGetQueuedScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', project_id: 'proj-123', profile: 'default', target_url: 'http://example.com' }
    ]);
    
    mockGetScanConfigByProject.mockResolvedValue(JSON.stringify({
      base_url: 'http://custom-url.com',
      settings: { disable_shared_runners: false }
    }));

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockGetScanConfigByProject).toHaveBeenCalledWith('proj-123', 'default');
    expect(mockWs.send).toHaveBeenCalled();
    const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentMsg.payload.config.base_url).toBe('http://custom-url.com');
  });

  it('should default base_url to target_url if not present in config', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner', 'key-123']);
    mockGetQueuedScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', target_url: 'http://example.com' }
    ]);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalled();
    const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentMsg.payload.config.base_url).toBe('http://example.com');
  });

  it('should handle DB errors during scan status update gracefully without failing execution', async () => {
    mockGetQueuedScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', target_url: 'http://example.com' }
    ]);
    mockUpdateScanStatus.mockRejectedValue(new Error('D1 connection failure'));

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    // Should not throw
    await expect(queueService.checkAndDispatchQueuedScans(mockWs)).resolves.not.toThrow();
    expect(mockWs.send).toHaveBeenCalled();
  });
});
