// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { RunnersService } from '../../../src/services/runners';
import { IRunnersRepository } from '../../../src/repositories/runners';
import { IRbacRepository } from '../../../src/repositories/rbac';
import { Env } from '../../../src/env';

const mockUpdateScanStatus = vi.fn();

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(function () {
      return {
        updateScanStatus: mockUpdateScanStatus,
      };
    })
  };
});

describe('RunnersService Unit Tests', () => {
  let runnersService: RunnersService;
  let mockEnv: Env;
  let mockRunnersRepo: any;
  let mockRbacRepo: any;
  let mockCoordinatorFetch = vi.fn();

  let store: Map<string, { value: string; httpMetadata?: any }>;
  let mockStorage: any;

  beforeEach(() => {
    store = new Map();
    mockStorage = {
      put: vi.fn(async (key: string, value: string, opts?: any) => {
        store.set(key, { value, httpMetadata: opts?.httpMetadata });
      }),
      get: vi.fn(async (key: string) => {
        const item = store.get(key);
        if (!item) return null;
        return {
          text: async () => item.value,
          httpMetadata: item.httpMetadata,
        };
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    };
    mockCoordinatorFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runners: [{ publicKey: 'test-key' }], status: 'ok' })));
    mockEnv = {
      AUTH_ENABLED: 'true',
      STORAGE: mockStorage,
      SCAN_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      COORDINATOR_DO: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id-1' }),
        get: vi.fn().mockReturnValue({
          fetch: mockCoordinatorFetch,
        }),
      },
    } as any;

    mockRunnersRepo = {
      getScanDetails: vi.fn().mockResolvedValue({ id: 'scan-1', project_id: 'proj-1', user_id: 'user-1' }),
      getUserByPublicKey: vi.fn().mockResolvedValue({ id: 'user-1' }),
      getUserByApiKey: vi.fn().mockResolvedValue({ id: 'user-1' }),
      updateUserApiKey: vi.fn().mockResolvedValue(undefined),
      getDeleteRequestedAt: vi.fn().mockResolvedValue(null),
      getUserPublicKey: vi.fn().mockResolvedValue('test-key'),
      updateScanStatus: vi.fn().mockResolvedValue(undefined),
      createScanRecord: vi.fn().mockResolvedValue(undefined),
    };

    mockRbacRepo = {
      checkPermission: vi.fn().mockResolvedValue(true),
    };

    runnersService = new RunnersService(mockEnv, mockRunnersRepo as IRunnersRepository, mockRbacRepo as IRbacRepository);
  });

  test('connect should upgrade web socket and connect runner via DO', async () => {
    const res = await runnersService.connect(
      'websocket',
      undefined,
      'test-key',
      'http://localhost/connect',
      {}
    );

    expect(res).toBeDefined();
    expect(mockEnv.COORDINATOR_DO.idFromName).toHaveBeenCalled();
  });

  test('connect should reject if not websocket upgrade', async () => {
    const res = await runnersService.connect(
      undefined,
      undefined,
      'test-key',
      'http://localhost/connect',
      {}
    );

    expect(res.status).toBe(426);
  });

  test('connect should validate token if public key is not provided', async () => {
    const res = await runnersService.connect(
      'websocket',
      'test-token',
      undefined,
      'http://localhost/connect',
      {}
    );

    expect(res.status).toBe(200);
    expect(mockRunnersRepo.getUserByApiKey).toHaveBeenCalled();
  });

  test('getRunners should return mapped runners', async () => {
    const res = await runnersService.getRunners('user-1');
    expect(res.runners).toHaveLength(1);
    expect(res.runners[0].isMine).toBe(true);
  });

  test('getRunners should throw if unauthorized', async () => {
    await expect(runnersService.getRunners(null)).rejects.toThrow('Unauthorized|401');
  });

  test('connectClient should upgrade websocket for clients', async () => {
    const res = await runnersService.connectClient(
      'scan-1',
      'user-1',
      'websocket',
      'http://localhost/connect-client',
      {}
    );
    expect(res.status).toBe(200);
  });

  test('queueRun should update scan status and return run info', async () => {
    mockCoordinatorFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'r1', status: 'queued' }) });
    const res = await runnersService.queueRun({ scanId: 'scan-1' }, 'user-1', true, false);
    expect(res.id).toBeDefined();
    expect(res.status).toBe('queued');
    expect(mockRunnersRepo.createScanRecord).toHaveBeenCalled();
  });

  test('a second queueRun with an existing runId returns 409 and writes no R2 and queues nothing (Threat model T1)', async () => {
    mockRunnersRepo.createScanRecord.mockRejectedValueOnce(new Error('UNIQUE constraint failed: scans.id'));
    await expect(
      runnersService.queueRun({ runId: 'victim-run', config: { base_url: 'http://attacker.com' } }, 'attacker', false, false)
    ).rejects.toThrow('Run already exists|409');
    expect(mockEnv.STORAGE.put).not.toHaveBeenCalled();
    expect(mockEnv.SCAN_QUEUE.send).not.toHaveBeenCalled();
  });

  test('a generic D1 error returns 500 and nothing is queued or written to R2 (Threat model T1)', async () => {
    mockRunnersRepo.createScanRecord.mockRejectedValueOnce(new Error('database connection lost'));
    await expect(
      runnersService.queueRun({ runId: 'run-1', config: {} }, 'user-1', false, false)
    ).rejects.toThrow('Failed to create scan|500');
    expect(mockEnv.STORAGE.put).not.toHaveBeenCalled();
    expect(mockEnv.SCAN_QUEUE.send).not.toHaveBeenCalled();
  });

  test('an R2 write failure after INSERT marks scan failed in D1 and rethrows 500 (Threat model T1)', async () => {
    mockStorage.put.mockRejectedValueOnce(new Error('R2 write error'));
    let thrownError: any = null;
    try {
      await runnersService.queueRun({ runId: 'run-r2-fail', config: {} }, 'user-1', false, false);
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe('Failed to queue scan|500');
    expect(thrownError.message).not.toContain('R2 write error');
    expect(mockRunnersRepo.createScanRecord).toHaveBeenCalled();
    expect(mockUpdateScanStatus).toHaveBeenCalledWith('run-r2-fail', 'failed');
    expect(mockEnv.SCAN_QUEUE.send).not.toHaveBeenCalled();
  });

  test('a queue send failure after INSERT marks scan failed in D1 and rethrows 500 (Threat model T1)', async () => {
    (mockEnv.SCAN_QUEUE.send as any).mockRejectedValueOnce(new Error('Queue unavailable'));
    let thrownError: any = null;
    try {
      await runnersService.queueRun({ runId: 'run-q-fail', config: {} }, 'user-1', false, false);
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError.message).toBe('Failed to queue scan|500');
    expect(thrownError.message).not.toContain('Queue unavailable');
    expect(mockRunnersRepo.createScanRecord).toHaveBeenCalled();
    expect(mockUpdateScanStatus).toHaveBeenCalledWith('run-q-fail', 'failed');
  });

  test('queueRun should cover getUserPublicKey error log', async () => {
    mockRunnersRepo.getUserPublicKey.mockRejectedValueOnce(new Error('db error'));
    const res = await runnersService.queueRun({ scanId: 'scan-1' }, 'user-1', true, false);
    expect(res.id).toBeDefined();
  });

  test('queueRun should throw if anon limit reached and not write to R2 (Threat model invariant 5)', async () => {
    mockEnv.LIMIT_ANONYMOUS = 'true';
    await expect(
      runnersService.queueRun({ config: { endpoints: Array(51).fill('test') } }, 'anon', true, true)
    ).rejects.toThrow('Anonymous limit reached: You can only scan up to 50 endpoints.|403');
    expect(mockEnv.STORAGE.put).not.toHaveBeenCalled();
  });

  test('queueRun should throw if projectId present and isAnon and not write to R2 (Threat model invariant 5)', async () => {
    await expect(runnersService.queueRun({ projectId: 'p1' }, 'anon', true, true)).rejects.toThrow('Forbidden|403');
    expect(mockEnv.STORAGE.put).not.toHaveBeenCalled();
  });

  test('queueRun should throw if isWeb, has projectId and no rbac permission and not write to R2 (Threat model invariant 5)', async () => {
    mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
    await expect(runnersService.queueRun({ projectId: 'p1' }, 'user-1', true, false)).rejects.toThrow('Forbidden|403');
    expect(mockEnv.STORAGE.put).not.toHaveBeenCalled();
  });

  test('queued message has configKey and no config, and R2 object exists and equals body.config', async () => {
    const config = { base_url: 'https://example.com', endpoints: ['/test'] };
    const res = await runnersService.queueRun({ config }, 'user-1', false, false);
    expect(res.status).toBe('queued');

    expect(mockEnv.SCAN_QUEUE.send).toHaveBeenCalledTimes(1);
    const sent = (mockEnv.SCAN_QUEUE.send as any).mock.calls[0][0];
    expect(sent.configKey).toBeDefined();
    expect(sent.config).toBeUndefined();
    expect(sent.runId).toBe(res.id);

    expect(mockEnv.STORAGE.put).toHaveBeenCalled();
    const storedObj = await mockEnv.STORAGE.get(sent.configKey);
    expect(storedObj).not.toBeNull();
    expect(JSON.parse(await storedObj!.text())).toEqual(config);
  });

  test('a config of about 300 KB succeeds (regression for 128KB limit)', async () => {
    const largeEndpoints = Array.from({ length: 500 }, (_, i) => ({
      path: `/api/v1/endpoint_${i}`,
      method: 'POST',
      padding: 'x'.repeat(600)
    }));
    const config = { base_url: 'https://api.example.com', endpoints: largeEndpoints };
    const size = new TextEncoder().encode(JSON.stringify(config)).byteLength;
    expect(size).toBeGreaterThan(250 * 1024);

    const res = await runnersService.queueRun({ config }, 'user-1', false, false);
    expect(res.status).toBe('queued');
    const sent = (mockEnv.SCAN_QUEUE.send as any).mock.calls[0][0];
    expect(sent.configKey).toBeDefined();
    expect(sent.config).toBeUndefined();
  });

  test('an invalid runId returns 400 and does not write to R2 or D1 (Threat model invariant 2)', async () => {
    await expect(
      runnersService.queueRun({ runId: '../traversal', config: {} }, 'user-1', false, false)
    ).rejects.toThrow('Invalid runId|400');
    expect(mockEnv.STORAGE.put).not.toHaveBeenCalled();
    expect(mockRunnersRepo.createScanRecord).not.toHaveBeenCalled();
    expect(mockEnv.SCAN_QUEUE.send).not.toHaveBeenCalled();
  });

  test('an oversized config returns 413 and no D1 row is created (Threat model invariant 4)', async () => {
    const oversized = { padding: 'y'.repeat(21 * 1024 * 1024) };
    await expect(
      runnersService.queueRun({ config: oversized }, 'user-1', false, false)
    ).rejects.toThrow(/Scan config too large.*\|413/);
    expect(mockRunnersRepo.createScanRecord).not.toHaveBeenCalled();
    expect(mockEnv.STORAGE.put).not.toHaveBeenCalled();
  });

  test('stopRun should succeed', async () => {
    mockEnv.COORDINATOR_DO.get = vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'stopped' }) })
    });
    const res = await runnersService.stopRun('scan-1', 'user-1');
    expect(res.status).toBe('stopped');
  });

  test('stopRun should throw 401 if unauthorized', async () => {
    await expect(runnersService.stopRun('scan-1', null)).rejects.toThrow('Unauthorized|401');
  });

  test('stopRun should throw if checkScanAccess fails', async () => {
    mockRunnersRepo.getScanDetails.mockResolvedValueOnce(null);
    await expect(runnersService.stopRun('scan-1', 'user-1')).rejects.toThrow('Run/Scan not found|404');
  });

  test('pauseRun should succeed', async () => {
    mockEnv.COORDINATOR_DO.get = vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'paused' }) })
    });
    const res = await runnersService.pauseRun('scan-1', 'user-1');
    expect(res.status).toBe('paused');
  });

  test('pauseRun should throw 401 if unauthorized', async () => {
    await expect(runnersService.pauseRun('scan-1', null)).rejects.toThrow('Unauthorized|401');
  });

  test('resumeRun should succeed', async () => {
    mockEnv.COORDINATOR_DO.get = vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'resumed' }) })
    });
    const res = await runnersService.resumeRun('scan-1', 'user-1');
    expect(res.status).toBe('resumed');
  });

  test('resumeRun should throw 401 if unauthorized', async () => {
    await expect(runnersService.resumeRun('scan-1', null)).rejects.toThrow('Unauthorized|401');
  });

  test('restartRunner should reboot active runner', async () => {
    mockCoordinatorFetch.mockResolvedValueOnce({ ok: true });
    const res = await runnersService.restartRunner('conn-1', 'user-1');
    expect(res.status).toBe('restarted');
  });

  test('restartRunner should throw 500 on db error', async () => {
    mockRunnersRepo.getUserPublicKey.mockRejectedValueOnce(new Error('db error'));
    await expect(runnersService.restartRunner('conn-1', 'user-1')).rejects.toThrow('Internal Server Error|500');
  });

  test('restartRunner should throw 403 if no public key', async () => {
    mockRunnersRepo.getUserPublicKey.mockResolvedValueOnce(null);
    await expect(runnersService.restartRunner('conn-1', 'user-1')).rejects.toThrow('Forbidden: You do not own any runners|403');
  });

  test('restartRunner should throw error if DO returns !ok', async () => {
    mockCoordinatorFetch.mockResolvedValueOnce({ ok: false, text: async () => 'DO Error', status: 400 });
    await expect(runnersService.restartRunner('conn-1', 'user-1')).rejects.toThrow('DO Error|400');
  });
});
