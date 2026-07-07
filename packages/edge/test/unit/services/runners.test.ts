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
    const res = await runnersService.queueRun({ scanId: 'scan-1' }, 'user-1', true, false);
    expect(res.id).toBeDefined();
    expect(res.status).toBe('queued');
    expect(mockRunnersRepo.createScanRecord).toHaveBeenCalled();
  });

  test('stopRun should succeed', async () => {
    const res = await runnersService.stopRun('scan-1', 'user-1');
    expect(res.status).toBe('stopped');
  });

  test('pauseRun should succeed', async () => {
    const res = await runnersService.pauseRun('scan-1', 'user-1');
    expect(res.status).toBe('paused');
  });

  test('resumeRun should succeed', async () => {
    const res = await runnersService.resumeRun('scan-1', 'user-1');
    expect(res.status).toBe('resumed');
  });

  test('restartRunner should reboot active runner', async () => {
    const res = await runnersService.restartRunner('conn-1', 'user-1');
    expect(res.status).toBe('restarted');
  });
});
