import { describe, test, expect, vi, beforeEach } from 'vitest';
import { RunnersService } from '../../../src/services/runners';
import { IRunnersRepository } from '../../../src/repositories/runners';
import { IRbacRepository } from '../../../src/repositories/rbac';
import { Env } from '../../../src/env';

describe('RunnersService Unit Tests', () => {
  let runnersService: RunnersService;
  let mockEnv: Env;
  let mockRunnersRepo: any;
  let mockRbacRepo: any;

  beforeEach(() => {
    mockEnv = {
      AUTH_ENABLED: 'true',
      SCAN_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      COORDINATOR_DO: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id-1' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ runners: [{ publicKey: 'test-key' }], status: 'ok' }))),
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
    (mockEnv.COORDINATOR_DO.get().fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'r1', status: 'queued' }) });
    const res = await runnersService.queueRun({ scanId: 'scan-1' }, 'user-1', true, false);
    expect(res.id).toBeDefined();
    expect(res.status).toBe('queued');
    expect(mockRunnersRepo.createScanRecord).toHaveBeenCalled();
  });

  test('queueRun should cover createScanRecord error log', async () => {
    mockRunnersRepo.createScanRecord.mockRejectedValueOnce(new Error('db error'));
    const res = await runnersService.queueRun({ scanId: 'scan-1' }, 'user-1', true, false);
    expect(res.id).toBeDefined();
    expect(mockRunnersRepo.createScanRecord).toHaveBeenCalled();
  });

  test('queueRun should cover getUserPublicKey error log', async () => {
    mockRunnersRepo.getUserPublicKey.mockRejectedValueOnce(new Error('db error'));
    const res = await runnersService.queueRun({ scanId: 'scan-1' }, 'user-1', true, false);
    expect(res.id).toBeDefined();
  });

  test('queueRun should throw if anon limit reached', async () => {
    mockEnv.LIMIT_ANONYMOUS = 'true';
    await expect(
      runnersService.queueRun({ config: { endpoints: Array(51).fill('test') } }, 'anon', true, true)
    ).rejects.toThrow('Anonymous limit reached: You can only scan up to 50 endpoints.|403');
  });

  test('queueRun should throw if projectId present and isAnon', async () => {
    await expect(runnersService.queueRun({ projectId: 'p1' }, 'anon', true, true)).rejects.toThrow('Forbidden|403');
  });

  test('queueRun should throw if isWeb, has projectId and no rbac permission', async () => {
    mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
    await expect(runnersService.queueRun({ projectId: 'p1' }, 'user-1', true, false)).rejects.toThrow('Forbidden|403');
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
    (mockEnv.COORDINATOR_DO.get().fetch as any).mockResolvedValueOnce({ ok: true });
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
    (mockEnv.COORDINATOR_DO.get().fetch as any).mockResolvedValueOnce({ ok: false, text: async () => 'DO Error', status: 400 });
    await expect(runnersService.restartRunner('conn-1', 'user-1')).rejects.toThrow('DO Error|400');
  });
});
