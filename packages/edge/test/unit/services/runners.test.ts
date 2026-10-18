// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { RunnersService, filterRunnersForUser, isSharedRunnerToken } from '../../../src/services/runners';
import { configForRunner } from '../../../src/coordinator/runnerAccess';
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
    mockCoordinatorFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runners: [{ publicKey: 'test-key', ownerId: 'user-1' }], status: 'ok' })));
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

  describe('connect: who a token runner works for', () => {
    const OPERATOR_TOKEN = 'op_' + 'x'.repeat(40);
    const forwardedUrl = () => new URL(mockCoordinatorFetch.mock.calls.at(-1)![0].url);

    test('a user API token connects a runner bound to that user, never a shared one', async () => {
      mockEnv.SHARED_RUNNER_TOKEN = OPERATOR_TOKEN;
      await runnersService.connect('websocket', 'swazz_live_user', undefined, 'http://localhost/connect', {});
      expect(forwardedUrl().searchParams.get('user_id')).toBe('user-1');
      expect(forwardedUrl().searchParams.has('shared')).toBe(false);
    });

    test('the operator token connects a shared runner with no owner', async () => {
      mockEnv.SHARED_RUNNER_TOKEN = OPERATOR_TOKEN;
      await runnersService.connect('websocket', OPERATOR_TOKEN, undefined, 'http://localhost/connect', {});
      expect(forwardedUrl().searchParams.get('shared')).toBe('1');
      expect(forwardedUrl().searchParams.has('user_id')).toBe(false);
      expect(mockRunnersRepo.getUserByApiKey).not.toHaveBeenCalled();
    });

    test('a client cannot make itself shared or pick an owner through the query string', async () => {
      mockEnv.SHARED_RUNNER_TOKEN = OPERATOR_TOKEN;
      await runnersService.connect('websocket', 'swazz_live_user', undefined, 'http://localhost/connect?shared=1&user_id=victim', {});
      expect(forwardedUrl().searchParams.has('shared')).toBe(false);
      expect(forwardedUrl().searchParams.getAll('user_id')).toEqual(['user-1']);
    });

    test('a short or missing operator token never grants shared status', async () => {
      expect(await isSharedRunnerToken('short', 'short')).toBe(false);
      expect(await isSharedRunnerToken('anything', undefined)).toBe(false);
      expect(await isSharedRunnerToken(OPERATOR_TOKEN, OPERATOR_TOKEN)).toBe(true);
      expect(await isSharedRunnerToken(OPERATOR_TOKEN + 'y', OPERATOR_TOKEN)).toBe(false);
    });
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

  test('queueRun rejects a config that is not an object before storing anything', async () => {
    for (const config of ['x', 5, true, [1]]) {
      await expect(runnersService.queueRun({ config }, 'user-1', false, false)).rejects.toThrow('config must be an object|400');
    }
    expect(mockRunnersRepo.createScanRecord).not.toHaveBeenCalled();
    expect(mockEnv.SCAN_QUEUE.send).not.toHaveBeenCalled();
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

  test('restartRunner asks the coordinator to check ownership by user id, not by public key', async () => {
    await runnersService.restartRunner('conn-1', 'user-1');
    const url = new URL(mockCoordinatorFetch.mock.calls.at(-1)![0].url);
    expect(url.searchParams.get('userId')).toBe('user-1');
    expect(url.searchParams.has('userPublicKey')).toBe(false);
    expect(mockRunnersRepo.getUserPublicKey).not.toHaveBeenCalled();
  });

  test('restartRunner should throw error if DO returns !ok', async () => {
    mockCoordinatorFetch.mockResolvedValueOnce({ ok: false, text: async () => 'DO Error', status: 400 });
    await expect(runnersService.restartRunner('conn-1', 'user-1')).rejects.toThrow('DO Error|400');
  });
});

describe('filterRunnersForUser', () => {
  const runners = [
    { connectionId: 'c-mine', name: 'mine', ownerId: 'user-1', publicKey: 'k1', isShared: false, status: 'connected', version: 'v1', activeJobs: ['r1'] },
    { connectionId: 'c-other', name: 'theirs', ownerId: 'user-2', publicKey: 'k2', isShared: false, status: 'connected', version: 'v1', activeJobs: ['r2'] },
    { connectionId: 'c-shared', name: 'pool', ownerId: null, publicKey: null, isShared: true, status: 'connected', version: 'v1', activeJobs: ['r3'] },
  ];

  test('shows the caller their own runners in full', () => {
    const mine = filterRunnersForUser(runners, 'user-1').find(r => r.name === 'mine');
    expect(mine).toMatchObject({ connectionId: 'c-mine', publicKey: 'k1', activeJobs: ['r1'], isMine: true });
    expect(mine).not.toHaveProperty('ownerId');
  });

  test('hides other tenants\' runners entirely', () => {
    const visible = filterRunnersForUser(runners, 'user-1');
    expect(visible.map(r => r.name)).not.toContain('theirs');
    expect(JSON.stringify(visible)).not.toContain('k2');
    expect(JSON.stringify(visible)).not.toContain('r2');
  });

  test('shows shared runners without connection ids, keys or job ids', () => {
    const shared = filterRunnersForUser(runners, 'user-1').find(r => r.name === 'pool');
    expect(shared).toEqual({ name: 'pool', status: 'connected', isShared: true, version: 'v1', isMine: false });
  });
});

describe('configForRunner', () => {
  const config = { base_url: 'http://10.0.0.5', security: { allow_private_ips: true, timeout: 5 } };

  test('forces allow_private_ips off for shared runners', () => {
    expect(configForRunner(config, ['runner', 'shared'], {}).security).toEqual({ allow_private_ips: false, timeout: 5 });
    expect(config.security.allow_private_ips).toBe(true); // input not mutated
  });

  test('leaves configs for a user\'s own runner untouched', () => {
    expect(configForRunner(config, ['runner', 'user_id:u1'], {})).toBe(config);
    expect(configForRunner(config, ['runner', 'k', 'user_id:u1'], {})).toBe(config);
  });

  test('honours the operator opt-in for shared runners', () => {
    expect(configForRunner(config, ['runner', 'shared'], { SHARED_RUNNERS_ALLOW_PRIVATE_IPS: 'true' })).toBe(config);
  });

  // The Go agent decodes with encoding/json, which matches keys case-insensitively (with Unicode
  // folding) and keeps the last match. Each of these turned private IPs back on before the fix,
  // verified against the real Go decoder.
  test.each([
    { security: { allow_private_ips: true, ALLOW_PRIVATE_IPS: true } },
    { security: {}, Security: { allow_private_ips: true } },
    { '\u017fecurity': { 'allow_private_ip\u017f': true } },
    { security: { Allow_Private_IPs: true } },
  ])('leaves no key the agent could read as allow_private_ips: %j', (attack) => {
    const out = configForRunner(attack, ['runner', 'shared'], {});
    const keys = (o: object) => Object.keys(o).map(k => k.toUpperCase().toLowerCase());
    expect(keys(out).filter(k => k === 'security')).toEqual(['security']);
    expect(keys(out.security).filter(k => k === 'allow_private_ips')).toEqual(['allow_private_ips']);
    expect(out.security.allow_private_ips).toBe(false);
  });

  test('keeps the other security settings from every security-like key', () => {
    const out = configForRunner({ security: { timeout: 5 }, Security: { retries: 2 }, base_url: 'x' }, ['runner', 'shared'], {});
    expect(out).toEqual({ base_url: 'x', security: { timeout: 5, retries: 2, allow_private_ips: false } });
  });

  test('adds the guard when the config has no security block', () => {
    expect(configForRunner({ base_url: 'x' }, ['runner', 'shared'], {})).toEqual({ base_url: 'x', security: { allow_private_ips: false } });
  });
});
