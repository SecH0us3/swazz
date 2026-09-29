// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueService } from '../../../src/coordinator/QueueService';
import { StateManager } from '../../../src/coordinator/StateManager';

const mockGetActiveScans = vi.fn();
const mockUpdateScanStatus = vi.fn();
const mockGetScanConfigByProject = vi.fn();

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(function () {
      return {
        getActiveScans: mockGetActiveScans,
        updateScanStatus: mockUpdateScanStatus,
        getScanConfigByProject: mockGetScanConfigByProject,
      };
    })
  };
});

const mockLogError = vi.fn();

vi.mock('../../../../common/logging/logger', () => ({
  logError: (...args: any[]) => mockLogError(...args),
  logWarn: vi.fn()
}));

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

    mockEnv = {
      STORAGE: {
        get: vi.fn(),
        delete: vi.fn().mockResolvedValue(true)
      }
    };
    
    mockGetActiveScans.mockResolvedValue([
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
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    mockGetActiveScans.mockResolvedValue([
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
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, target_url: 'http://example.com' }
    ]);
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
    mockGetActiveScans.mockResolvedValue([
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
    mockGetActiveScans.mockResolvedValue([
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
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', target_url: 'http://example.com' }
    ]);
    mockUpdateScanStatus.mockRejectedValue(new Error('D1 connection failure'));

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await expect(queueService.checkAndDispatchQueuedScans(mockWs)).resolves.not.toThrow();
    expect(mockWs.send).toHaveBeenCalled();
  });

  it('should handle errors during config fetching from DB gracefully', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner', 'key-123']);
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', project_id: 'proj-123', profile: 'default', target_url: 'http://example.com' }
    ]);
    mockGetScanConfigByProject.mockRejectedValue(new Error('DB failure'));

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await expect(queueService.checkAndDispatchQueuedScans(mockWs)).resolves.not.toThrow();
    expect(mockLogError).toHaveBeenCalled();
  });

  it('should handle general runtime errors gracefully by logging', async () => {
    // Force a runtime error (e.g. mockGetActiveScans rejects)
    mockGetActiveScans.mockRejectedValue(new Error('Fetch queue error'));
    
    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await expect(queueService.checkAndDispatchQueuedScans(mockWs)).resolves.not.toThrow();
    expect(mockLogError).toHaveBeenCalled();
  });

  it('should resolve config from R2 via config_ref and delete config_ref and R2 object on dispatch', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    mockEnv.STORAGE.get = vi.fn().mockResolvedValue({
      text: async () => JSON.stringify({ base_url: 'http://r2-config.com' })
    });

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalled();
    const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentMsg.payload.config.base_url).toBe('http://r2-config.com');
    expect(mockState.storage.delete).toHaveBeenCalledWith('config_ref:scan-1');
    expect(mockEnv.STORAGE.delete).toHaveBeenCalledWith(configKey);
  });

  it('skips scan when R2 config retrieval fails without sending {} or falling through to project config (Threat model invariant 6)', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', project_id: 'proj-123', profile: 'default', target_url: 'http://example.com' }
    ]);
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    // R2 read fails
    mockEnv.STORAGE.get = vi.fn().mockResolvedValue(null);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockGetScanConfigByProject).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalled();
  });

  it('skips scan when config_ref is invalid without reading R2 or dispatching (Threat model invariant 3)', async () => {
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', '../bad-ref');
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockEnv.STORAGE.get).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalled();
  });

  it('honours disable_shared_runners from R2 config in QueueService (Threat model invariant 6)', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']); // shared runner
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, target_url: 'http://example.com' }
    ]);

    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    mockEnv.STORAGE.get = vi.fn().mockResolvedValue({
      text: async () => JSON.stringify({ settings: { disable_shared_runners: true } })
    });

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
  });
});
