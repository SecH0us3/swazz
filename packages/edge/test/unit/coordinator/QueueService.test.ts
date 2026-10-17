// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueService, MAX_ACTIVE_JOBS_PER_RUNNER } from '../../../src/coordinator/QueueService';
import { StateManager } from '../../../src/coordinator/StateManager';

const deletedKeys = (state: any): string[] => state.storage.delete.mock.calls.flatMap((c: any[]) => c[0]);

const mockGetActiveScans = vi.fn();
const mockUpdateScanStatus = vi.fn();
const mockMarkFailedIfActive = vi.fn();
const mockGetScanConfigByProject = vi.fn();

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(function () {
      return {
        getActiveScans: mockGetActiveScans,
        updateScanStatus: mockUpdateScanStatus,
        markFailedIfActive: mockMarkFailedIfActive,
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
    mockMarkFailedIfActive.mockResolvedValue(true);
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
    expect(deletedKeys(mockState)).toContain('config:scan-1');
    expect(deletedKeys(mockState)).toContain('user_public_key:scan-1');
  });

  it('dispatches every compatible queued scan on one reconnect, not only the first', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']); // shared runner
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, status: 'dispatched', target_url: 'http://a.example.com' },
      { id: 'scan-2', userPublicKey: null, status: 'queued', target_url: 'http://b.example.com' },
      { id: 'scan-3', userPublicKey: 'key-other', status: 'queued', target_url: 'http://c.example.com' },
      { id: 'scan-4', userPublicKey: null, status: 'queued', target_url: 'http://d.example.com' }
    ]);
    let attachment: any = {};
    mockWs.deserializeAttachment = vi.fn(() => attachment);
    mockWs.serializeAttachment = vi.fn((a: any) => { attachment = a; });

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    const sentRunIds = mockWs.send.mock.calls.map((c: any[]) => JSON.parse(c[0]).payload.runId);
    // scan-3 belongs to a private runner key and must stay queued
    expect(sentRunIds).toEqual(['scan-1', 'scan-2', 'scan-4']);
    expect(attachment.activeJobs).toEqual(['scan-1', 'scan-2', 'scan-4']);
    expect(stateManager.jobs.has('scan-3')).toBe(false);
    expect(mockUpdateScanStatus).toHaveBeenCalledWith('scan-4', 'dispatched');
  });

  it('stops at MAX_ACTIVE_JOBS_PER_RUNNER and leaves the rest queued', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    const scans = Array.from({ length: MAX_ACTIVE_JOBS_PER_RUNNER + 3 }, (_, i) => (
      { id: `scan-${i}`, userPublicKey: null, status: 'queued', target_url: 'http://example.com' }
    ));
    mockGetActiveScans.mockResolvedValue(scans);
    let attachment: any = { activeJobs: ['already-running'] };
    mockWs.deserializeAttachment = vi.fn(() => attachment);
    mockWs.serializeAttachment = vi.fn((a: any) => { attachment = a; });

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalledTimes(MAX_ACTIVE_JOBS_PER_RUNNER - 1);
    expect(attachment.activeJobs).toHaveLength(MAX_ACTIVE_JOBS_PER_RUNNER);
    expect(stateManager.jobs.has(`scan-${MAX_ACTIVE_JOBS_PER_RUNNER - 1}`)).toBe(false);
    expect(mockUpdateScanStatus).not.toHaveBeenCalledWith(`scan-${MAX_ACTIVE_JOBS_PER_RUNNER - 1}`, 'dispatched');
  });

  it('rolls back the assignment and stops when send fails, keeping later scans queued', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, status: 'queued', target_url: 'http://a.example.com' },
      { id: 'scan-2', userPublicKey: null, status: 'queued', target_url: 'http://b.example.com' },
      { id: 'scan-3', userPublicKey: null, status: 'queued', target_url: 'http://c.example.com' }
    ]);
    let attachment: any = {};
    mockWs.deserializeAttachment = vi.fn(() => attachment);
    mockWs.serializeAttachment = vi.fn((a: any) => { attachment = a; });
    mockWs.send = vi.fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('socket closed'); });

    const stateManager = new StateManager(mockState);
    stateManager.runners.add(mockWs);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalledTimes(2);
    expect(stateManager.jobs.get('scan-1')).toBe(mockWs);
    expect(stateManager.jobs.has('scan-2')).toBe(false);
    expect(stateManager.jobs.has('scan-3')).toBe(false);
    expect(stateManager.runners.has(mockWs)).toBe(false);
    expect(attachment.activeJobs).toEqual(['scan-1']);
    expect(mockUpdateScanStatus).not.toHaveBeenCalledWith('scan-2', 'dispatched');
    expect(deletedKeys(mockState)).not.toContain('config:scan-2');
  });

  it('does not re-dispatch a scan already running on a connected runner', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, status: 'dispatched', target_url: 'http://a.example.com' },
      { id: 'scan-2', userPublicKey: null, status: 'queued', target_url: 'http://b.example.com' }
    ]);
    const stateManager = new StateManager(mockState);
    const otherRunner: any = { send: vi.fn() };
    stateManager.jobs.set('scan-1', otherRunner);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockWs.send.mock.calls[0][0]).payload.runId).toBe('scan-2');
    expect(stateManager.jobs.get('scan-1')).toBe(otherRunner);
  });

  it('does not re-dispatch a recently finished scan still marked dispatched in D1 (Task 150 pitfall)', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']);
    // scan-finished was just cleaned up from stateManager.jobs and moved to recentJobs,
    // while FINDINGS_QUEUE has not yet updated its D1 status from 'dispatched' to 'completed'.
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-finished', userPublicKey: null, status: 'dispatched', target_url: 'http://a.example.com' },
      { id: 'scan-other-recent', userPublicKey: null, status: 'dispatched', target_url: 'http://b.example.com' },
      { id: 'scan-queued', userPublicKey: null, status: 'queued', target_url: 'http://c.example.com' }
    ]);

    let attachment: any = { activeJobs: [], recentJobs: ['scan-finished'] };
    mockWs.deserializeAttachment = vi.fn(() => attachment);
    mockWs.serializeAttachment = vi.fn((a: any) => { attachment = a; });

    const otherRunner: any = {
      deserializeAttachment: vi.fn().mockReturnValue({ activeJobs: [], recentJobs: ['scan-other-recent'] }),
      send: vi.fn()
    };

    const stateManager = new StateManager(mockState);
    stateManager.runners.add(mockWs);
    stateManager.runners.add(otherRunner);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockWs.send.mock.calls[0][0]).payload.runId).toBe('scan-queued');
    expect(stateManager.jobs.has('scan-finished')).toBe(false);
    expect(stateManager.jobs.has('scan-other-recent')).toBe(false);
    expect(stateManager.jobs.get('scan-queued')).toBe(mockWs);
  });

  it('skips dispatch if scan enters recentJobs during R2 await', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    let attachment: any = { activeJobs: [], recentJobs: [] };
    mockWs.deserializeAttachment = vi.fn(() => attachment);
    mockWs.serializeAttachment = vi.fn((a: any) => { attachment = a; });

    mockEnv.STORAGE.get = vi.fn().mockImplementation(async () => {
      attachment = { activeJobs: [], recentJobs: ['scan-1'] };
      return {
        text: async () => JSON.stringify({ base_url: 'http://example.com' })
      };
    });

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(stateManager.jobs.has('scan-1')).toBe(false);
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

  it('should resolve config from R2 via config_ref and delete config_ref, config_meta and R2 object on dispatch', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
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
    expect(deletedKeys(mockState)).toContain('config_ref:scan-1');
    expect(deletedKeys(mockState)).toContain('config_meta:scan-1');
    expect(mockEnv.STORAGE.delete).toHaveBeenCalledWith(configKey);
  });

  it('marks scan failed in D1 and deletes storage keys when R2 config retrieval fails (Issue 4c)', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: 'key-123', project_id: 'proj-123', profile: 'default', target_url: 'http://example.com' }
    ]);
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    // R2 read fails
    mockEnv.STORAGE.get = vi.fn().mockResolvedValue(null);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockGetScanConfigByProject).not.toHaveBeenCalled();
    expect(mockMarkFailedIfActive).toHaveBeenCalledWith('scan-1');
    expect(deletedKeys(mockState)).toContain('config_ref:scan-1');
    expect(deletedKeys(mockState)).toContain('config_meta:scan-1');
    expect(deletedKeys(mockState)).toContain('user_public_key:scan-1');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('marks scan failed in D1 and deletes storage keys when config_ref is invalid without reading R2 (Issue 4c)', async () => {
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', '../bad-ref');
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockEnv.STORAGE.get).not.toHaveBeenCalled();
    expect(mockMarkFailedIfActive).toHaveBeenCalledWith('scan-1');
    expect(deletedKeys(mockState)).toContain('config_ref:scan-1');
    expect(deletedKeys(mockState)).toContain('config_meta:scan-1');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('marks scan failed in D1 and deletes storage keys without reading R2 when config_ref belongs to another run (Threat model T3)', async () => {
    const configKeyOtherRun = `scans/configs/other-run/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKeyOtherRun);
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockEnv.STORAGE.get).not.toHaveBeenCalled();
    expect(mockMarkFailedIfActive).toHaveBeenCalledWith('scan-1');
    expect(deletedKeys(mockState)).toContain('config_ref:scan-1');
    expect(deletedKeys(mockState)).toContain('config_meta:scan-1');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('compatibility uses meta without reading R2 for non-selected scans (Issue 4b)', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']); // shared runner
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, target_url: 'http://example1.com' },
      { id: 'scan-2', userPublicKey: null, target_url: 'http://example2.com' }
    ]);

    const configKey1 = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const configKey2 = `scans/configs/scan-2/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey1);
    mockStorageMap.set('config_meta:scan-1', { disableShared: true });
    mockStorageMap.set('config_ref:scan-2', configKey2);
    mockStorageMap.set('config_meta:scan-2', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    mockEnv.STORAGE.get = vi.fn().mockResolvedValue({
      text: async () => JSON.stringify({ base_url: 'http://example2.com' })
    });

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).toHaveBeenCalledTimes(1);
    const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentMsg.payload.runId).toBe('scan-2');

    // R2 must NOT have been read for scan-1, ONLY for scan-2!
    expect(mockEnv.STORAGE.get).toHaveBeenCalledTimes(1);
    expect(mockEnv.STORAGE.get).toHaveBeenCalledWith(configKey2);
    expect(mockEnv.STORAGE.get).not.toHaveBeenCalledWith(configKey1);
  });

  it('missing meta is treated as disableShared=true and not given to a shared runner (Issue 4b)', async () => {
    mockState.getTags = vi.fn().mockReturnValue(['runner']); // shared runner
    mockGetActiveScans.mockResolvedValue([
      { id: 'scan-1', userPublicKey: null, target_url: 'http://example.com' }
    ]);

    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    // config_meta:scan-1 is intentionally omitted (missing)
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockEnv.STORAGE.get).not.toHaveBeenCalled();
  });

  it('skips dispatch without sending if another path assigned job during R2 await (Issue 5)', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const otherWs = { send: vi.fn() };
    const stateManager = new StateManager(mockState);

    // Mock getScanConfig to resolve after DispatchHandler assigns the job in stateManager
    mockEnv.STORAGE.get = vi.fn().mockImplementation(async () => {
      // Simulate race: another handler assigns the job while we await R2
      stateManager.jobs.set('scan-1', otherWs as any);
      return {
        text: async () => JSON.stringify({ base_url: 'http://example.com' })
      };
    });

    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    // mockWs should NOT send because the job was assigned to otherWs during R2 await
    expect(mockWs.send).not.toHaveBeenCalled();
    expect(stateManager.jobs.get('scan-1')).toBe(otherWs);
  });

  it('skips scan before R2 load if job already assigned in stateManager (Round 4 item 1a)', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const otherWs = { send: vi.fn() };
    const stateManager = new StateManager(mockState);
    stateManager.jobs.set('scan-1', otherWs as any);

    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockEnv.STORAGE.get).not.toHaveBeenCalled();
    expect(mockMarkFailedIfActive).not.toHaveBeenCalled();
  });

  it('does not mark scan failed or delete storage keys on transient R2 error (Round 4 item 1b)', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    // Transient R2 error (not ScanConfigNotFoundError)
    mockEnv.STORAGE.get = vi.fn().mockRejectedValue(new Error('R2 network timeout'));

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockMarkFailedIfActive).not.toHaveBeenCalled();
    expect(mockState.storage.delete).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.anything(),
      'Coordinator',
      expect.stringContaining('Failed to load scan config from R2'),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('does not delete storage keys if markFailedIfActive returns false on missing R2 object (Round 4 item 1b)', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    // R2 read returns null -> ScanConfigNotFoundError
    mockEnv.STORAGE.get = vi.fn().mockResolvedValue(null);
    mockMarkFailedIfActive.mockResolvedValueOnce(false);

    const stateManager = new StateManager(mockState);
    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockMarkFailedIfActive).toHaveBeenCalledWith('scan-1');
    expect(mockState.storage.delete).not.toHaveBeenCalled();
  });

  it('skips without marking failed if job assigned during R2 await and R2 throws (Round 4 item 1b)', async () => {
    const configKey = `scans/configs/scan-1/${crypto.randomUUID()}.json`;
    const mockStorageMap = new Map();
    mockStorageMap.set('config_ref:scan-1', configKey);
    mockStorageMap.set('config_meta:scan-1', { disableShared: false });
    mockState.storage.get = vi.fn().mockResolvedValue(mockStorageMap);

    const otherWs = { send: vi.fn() };
    const stateManager = new StateManager(mockState);

    mockEnv.STORAGE.get = vi.fn().mockImplementation(async () => {
      stateManager.jobs.set('scan-1', otherWs as any);
      throw new Error('R2 network timeout');
    });

    const queueService = new QueueService(mockEnv, mockState, stateManager);

    await queueService.checkAndDispatchQueuedScans(mockWs);

    expect(mockWs.send).not.toHaveBeenCalled();
    expect(mockMarkFailedIfActive).not.toHaveBeenCalled();
    expect(mockState.storage.delete).not.toHaveBeenCalled();
  });
});
