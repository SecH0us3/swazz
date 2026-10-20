// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A scan that fails must end on the dashboard, with a reason the user can act on: whether the
// runner reports the error, the dashboard connects after the fact, or the runner disappears.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketHandler } from '../../../src/coordinator/WebSocketHandler';
import { StateManager } from '../../../src/coordinator/StateManager';
import { QueueService } from '../../../src/coordinator/QueueService';
import { RequestHandler } from '../../../src/coordinator/RequestHandler';
import { failStalledScans, STALLED_SCAN_MESSAGE, STALLED_IDLE_MINUTES, UNOWNED_GRACE_MS } from '../../../src/coordinator/watchdog';
import { jobRunnerKey } from '../../../src/coordinator/utils';
import { UNKNOWN_FAILURE } from '../../../src/utils/runnerMessages';

const mockLogError = vi.fn();
vi.mock('../../../../common/logging/logger', () => ({
  logError: (...args: any[]) => mockLogError(...args),
  logWarn: vi.fn(),
}));

const repo = {
  getScan: vi.fn(),
  getFailureReasons: vi.fn(),
  getStalledActiveScans: vi.fn(),
  markFailedIfActive: vi.fn(),
  processFindingsQueueMessages: vi.fn(),
  getActiveScans: vi.fn(),
};
vi.mock('../../../src/repositories/scans', () => ({
  ScansRepository: vi.fn().mockImplementation(function () { return repo; }),
}));

function fakeWs(attachment: Record<string, unknown> = {}): any {
  let att: any = structuredClone(attachment);
  return {
    deserializeAttachment: vi.fn(() => structuredClone(att)),
    serializeAttachment: vi.fn((v: any) => { att = structuredClone(v); }),
    send: vi.fn(),
    close: vi.fn(),
  };
}

function fakeStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: vi.fn(async (k: any) => Array.isArray(k) ? new Map(k.filter((x: string) => data.has(x)).map((x: string) => [x, data.get(x)])) : data.get(k)),
    put: vi.fn(async (k: string, v: unknown) => { data.set(k, v); }),
    delete: vi.fn(async (k: any) => { for (const x of Array.isArray(k) ? k : [k]) data.delete(x); return true; }),
  };
}

const sent = (ws: any) => ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));

describe('scan failures reach the dashboard', () => {
  let state: any;
  let env: any;
  let tagsOf: Map<any, string[]>;

  const setup = () => {
    const stateManager = new StateManager(state);
    const queueService = new QueueService(env, state, stateManager);
    vi.spyOn(queueService, 'checkAndDispatchQueuedScans').mockResolvedValue();
    const handler = new WebSocketHandler(env, state, stateManager, queueService);
    return { stateManager, queueService, handler, context: { env, state, stateManager, queueService } };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repo.getFailureReasons.mockResolvedValue(new Map());
    repo.getStalledActiveScans.mockResolvedValue([]);
    repo.markFailedIfActive.mockResolvedValue(true);
    repo.processFindingsQueueMessages.mockResolvedValue(undefined);
    repo.getActiveScans.mockResolvedValue([]);
    tagsOf = new Map();
    state = {
      storage: fakeStorage(),
      getWebSockets: vi.fn().mockReturnValue([]),
      getTags: vi.fn((ws: any) => tagsOf.get(ws) ?? []),
      getWebSocketAutoResponseTimestamp: vi.fn(() => null),
      acceptWebSocket: vi.fn((ws: any, tags: string[]) => tagsOf.set(ws, tags)),
      waitUntil: vi.fn(),
    };
    env = { VERSION: '1.0.0', JWT_SECRET: 'prod-secret', FINDINGS_QUEUE: { send: vi.fn().mockResolvedValue(undefined) } };
  });

  afterEach(() => vi.restoreAllMocks());

  // The runner's {"error": ...} carries no type; forwarded as is, the dashboard ignored it and
  // showed the scan running forever.
  it('forwards a runner error to the dashboard as a typed, cleaned-up error', async () => {
    const { handler, stateManager } = setup();
    const runner = fakeWs({ activeJobs: ['run-1', 'run-2'] });
    tagsOf.set(runner, ['runner', 'shared']);
    stateManager.runners.add(runner);
    stateManager.jobs.set('run-1', runner);
    stateManager.jobs.set('run-2', runner);
    const dashboard1 = fakeWs();
    const dashboard2 = fakeWs();
    stateManager.clients.set('run-1', new Set([dashboard1]));
    stateManager.clients.set('run-2', new Set([dashboard2]));

    await handler.handleMessage(runner, JSON.stringify({
      type: 'error', runId: 'run-1',
      payload: { error: 'could not connect to the MCP server: status 401\ngoroutine 9 [running]:\n/srv/x.go:1' },
    }));
    await handler.handleMessage(runner, JSON.stringify({ type: 'error', runId: 'run-2', payload: {} }));

    expect(sent(dashboard1)).toEqual([{ type: 'error', data: { message: 'could not connect to the MCP server: status 401' } }]);
    expect(sent(dashboard2)).toEqual([{ type: 'error', data: { message: UNKNOWN_FAILURE } }]);
    // The scan is over on the coordinator too.
    expect(stateManager.jobs.has('run-1')).toBe(false);
  });

  it('tells a dashboard that connects after the scan failed why it failed', async () => {
    const { stateManager, queueService } = setup();
    repo.getScan.mockResolvedValue({ id: 'run-1', status: 'failed', summary_stats: null });
    repo.getFailureReasons.mockResolvedValue(new Map([['run-1', 'MCP server rejected the runner']]));
    const server = fakeWs();
    const OrigPair = (globalThis as any).WebSocketPair;
    (globalThis as any).WebSocketPair = function () { return { 0: fakeWs(), 1: server }; };
    try {
      const requests = new RequestHandler(env, state, stateManager, queueService);
      await requests.handle(new Request('http://do/connect-client?runId=run-1')).catch(() => undefined);
    } finally {
      (globalThis as any).WebSocketPair = OrigPair;
    }
    expect(sent(server)).toEqual([{ type: 'error', data: { message: 'MCP server rejected the runner' } }]);
  });

  describe('stalled scan watchdog', () => {
    const T0 = 1_000_000_000_000;

    it('ends a scan no runner owns, only after it stayed unowned for the grace period', async () => {
      const { context, stateManager } = setup();
      repo.getStalledActiveScans.mockResolvedValue(['lost']);
      const dashboard = fakeWs();
      stateManager.clients.set('lost', new Set([dashboard]));
      await state.storage.put(jobRunnerKey('lost'), 'shared');

      expect(await failStalledScans(context, T0)).toEqual([]);
      expect(await failStalledScans(context, T0 + UNOWNED_GRACE_MS - 1)).toEqual([]);
      expect(repo.markFailedIfActive).not.toHaveBeenCalled();

      expect(await failStalledScans(context, T0 + UNOWNED_GRACE_MS)).toEqual(['lost']);
      expect(repo.getStalledActiveScans).toHaveBeenCalledWith(STALLED_IDLE_MINUTES, expect.any(Number));
      expect(repo.processFindingsQueueMessages).toHaveBeenCalledWith([{ body: { scanId: 'lost', type: 'error', payload: { error: STALLED_SCAN_MESSAGE } } }]);
      expect(sent(dashboard)).toEqual([{ type: 'error', data: { message: STALLED_SCAN_MESSAGE } }]);
      expect(state.storage.data.has(jobRunnerKey('lost'))).toBe(false);
      // A message for the user: no internals.
      expect(STALLED_SCAN_MESSAGE).not.toMatch(/runId|job_runner|Durable|D1|storage/i);
    });

    it('leaves a scan a runner owns, and starts the grace period over when it is owned again', async () => {
      const { context, stateManager } = setup();
      repo.getStalledActiveScans.mockResolvedValue(['quiet']);
      await failStalledScans(context, T0);

      // The runner reconnected and resumed it.
      stateManager.jobs.set('quiet', fakeWs());
      expect(await failStalledScans(context, T0 + UNOWNED_GRACE_MS)).toEqual([]);

      stateManager.jobs.delete('quiet');
      expect(await failStalledScans(context, T0 + UNOWNED_GRACE_MS + 1)).toEqual([]);
      expect(await failStalledScans(context, T0 + 2 * UNOWNED_GRACE_MS)).toEqual([]);
      expect(await failStalledScans(context, T0 + 2 * UNOWNED_GRACE_MS + 1)).toEqual(['quiet']);
    });

    it('forgets a scan that is no longer a candidate (it reported again, or finished)', async () => {
      const { context, stateManager } = setup();
      repo.getStalledActiveScans.mockResolvedValueOnce(['a']);
      await failStalledScans(context, T0);
      repo.getStalledActiveScans.mockResolvedValueOnce([]);
      await failStalledScans(context, T0 + 1);
      expect(stateManager.unownedSince.size).toBe(0);
    });

    it('does nothing more for a scan that finished in the meantime', async () => {
      const { context } = setup();
      repo.getStalledActiveScans.mockResolvedValue(['done']);
      repo.markFailedIfActive.mockResolvedValue(false);
      await failStalledScans(context, T0);
      expect(await failStalledScans(context, T0 + UNOWNED_GRACE_MS)).toEqual([]);
      expect(repo.processFindingsQueueMessages).not.toHaveBeenCalled();
    });

    it('one scan that cannot be ended does not stop the others', async () => {
      const { context } = setup();
      repo.getStalledActiveScans.mockResolvedValue(['broken', 'ok']);
      repo.markFailedIfActive.mockImplementation(async (id: string) => {
        if (id === 'broken') throw new Error('D1 down');
        return true;
      });
      await failStalledScans(context, T0);
      expect(await failStalledScans(context, T0 + UNOWNED_GRACE_MS)).toEqual(['ok']);
      expect(mockLogError).toHaveBeenCalled();
    });

    it('is reachable only as the internal /watchdog route', async () => {
      const { stateManager, queueService } = setup();
      const requests = new RequestHandler(env, state, stateManager, queueService);
      const res = await requests.handle(new Request('http://do/watchdog', { method: 'POST' }));
      expect(await res.json()).toEqual({ failed: 0 });
    });
  });
});
