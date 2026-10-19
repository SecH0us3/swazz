// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A runner whose WebSocket drops mid-scan reconnects and keeps sending that scan's events. The
// coordinator must accept them on the new connection (resume) only for runs dispatched to the
// same runner identity, and must stop treating connections that died silently as live runners.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketHandler } from '../../../src/coordinator/WebSocketHandler';
import { StateManager, RUNNER_HEARTBEAT_TIMEOUT_MS, MAX_ACTIVE_JOBS_PER_RUNNER } from '../../../src/coordinator/StateManager';
import { resumeRuns, parseResumeParam } from '../../../src/coordinator/resume';
import { ACK_EVERY, DELIVERY_HEADER, deliveredSeqKey } from '../../../src/coordinator/delivery';
import { QueueService } from '../../../src/coordinator/QueueService';
import { RequestHandler } from '../../../src/coordinator/RequestHandler';
import { runnerIdentity } from '../../../src/coordinator/runnerAccess';
import { jobRunnerKey, FINISHED_SCANS_KEY, MAX_FINISHED_SCANS, markScanFinished } from '../../../src/coordinator/utils';

const mockLogError = vi.fn();
const mockLogWarn = vi.fn();
vi.mock('../../../../common/logging/logger', () => ({
  logError: (...args: any[]) => mockLogError(...args),
  logWarn: (...args: any[]) => mockLogWarn(...args),
}));

const mockGetScanStatus = vi.fn();
const mockProcessFindings = vi.fn();
vi.mock('../../../src/repositories/scans', () => ({
  ScansRepository: vi.fn().mockImplementation(function () {
    return {
      getActiveScans: vi.fn().mockResolvedValue([]),
      updateScanStatus: vi.fn().mockResolvedValue(true),
      getScanStatus: mockGetScanStatus,
      markFailedIfActive: vi.fn().mockResolvedValue(true),
      processFindingsQueueMessages: mockProcessFindings,
    };
  }),
}));

/** A WebSocket stand-in whose attachment round-trips like the real one. */
function fakeWs(attachment: Record<string, unknown> = {}): any {
  let att: any = structuredClone(attachment);
  return {
    deserializeAttachment: vi.fn(() => (att === null ? null : structuredClone(att))),
    serializeAttachment: vi.fn((v: any) => { att = structuredClone(v); }),
    send: vi.fn(),
    close: vi.fn(),
  };
}

/** In-memory DO storage with the Map-returning multi-key get the coordinator relies on. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (keys: string | string[]) => {
      if (Array.isArray(keys)) {
        const out = new Map<string, unknown>();
        for (const k of keys) if (data.has(k)) out.set(k, data.get(k));
        return out;
      }
      return data.get(keys);
    }),
    put: vi.fn(async (k: string, v: unknown) => { data.set(k, v); }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
      return true;
    }),
  };
}

describe('runner reconnect', () => {
  let tagsOf: Map<any, string[]>;
  let pongAt: Map<any, Date>;
  let state: any;
  let env: any;

  const setup = (storage = fakeStorage()) => {
    state.storage = storage;
    const stateManager = new StateManager(state);
    const queueService = new QueueService(env, state, stateManager);
    vi.spyOn(queueService, 'checkAndDispatchQueuedScans').mockResolvedValue();
    const handler = new WebSocketHandler(env, state, stateManager, queueService);
    return { stateManager, queueService, handler, storage };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetScanStatus.mockResolvedValue('dispatched');
    tagsOf = new Map();
    pongAt = new Map();
    state = {
      getWebSockets: vi.fn().mockReturnValue([]),
      getTags: vi.fn((ws: any) => tagsOf.get(ws) ?? []),
      getWebSocketAutoResponseTimestamp: vi.fn((ws: any) => pongAt.get(ws) ?? null),
      acceptWebSocket: vi.fn((ws: any, tags: string[]) => tagsOf.set(ws, tags)),
      waitUntil: vi.fn(),
    };
    env = {
      VERSION: '1.0.0',
      JWT_SECRET: 'prod-secret',
      FINDINGS_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
    };
  });

  it('identifies runners by the shared pool or by owner, never by name', () => {
    expect(runnerIdentity(['runner', 'name:a', 'shared'])).toBe('shared');
    expect(runnerIdentity(['runner', 'name:a', 'user_id:u1'])).toBe('user:u1');
    expect(runnerIdentity(['runner', 'name:a'])).toBeNull();
  });

  describe('resume', () => {
    it('hands a run claimed in the connection URL to the new connection before dispatching (the lost-results bug)', async () => {
      const { handler, stateManager, queueService } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'shared' }));
      // The old connection died without the coordinator noticing: it still holds the run.
      const oldWs = fakeWs({ activeJobs: ['run-1'] });
      tagsOf.set(oldWs, ['runner', 'shared']);
      stateManager.runners.add(oldWs);
      stateManager.jobs.set('run-1', oldWs);
      const dispatch = queueService.checkAndDispatchQueuedScans as any;
      dispatch.mockImplementation(async () => {
        // Dispatch must already see the run as taken, or it would be handed out a second time.
        expect(stateManager.jobs.get('run-1')).not.toBe(oldWs);
      });
      const requests = new RequestHandler(env, state, stateManager, queueService);

      const res = await requests.handle(new Request('http://do/connect-runner?name=r1&shared=1&resume=run-1'));
      expect(res.status).toBe(101);
      const newWs = state.acceptWebSocket.mock.calls[0][0];
      expect(stateManager.jobs.get('run-1')).toBe(newWs);
      expect(newWs.deserializeAttachment().activeJobs).toEqual(['run-1']);
      expect(dispatch).toHaveBeenCalledWith(newWs);
      // The dead socket no longer claims the run, so a state rebuild cannot bring it back.
      expect(oldWs.deserializeAttachment().activeJobs).toEqual([]);

      const event = { type: 'event', runId: 'run-1', payload: { type: 'result', data: {} } };
      await handler.handleMessage(newWs, JSON.stringify(event));
      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledWith({ scanId: 'run-1', type: 'event', payload: event.payload });
    });

    it('drops the events of a run the connection never resumed', async () => {
      const { handler, stateManager } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'shared' }));
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'shared']);
      stateManager.runners.add(ws);
      await handler.handleMessage(ws, JSON.stringify({ type: 'event', runId: 'run-1', payload: { type: 'result' } }));
      expect(env.FINDINGS_QUEUE.send).not.toHaveBeenCalled();
    });

    it('lets an owner\'s runner resume only that owner\'s runs', async () => {
      const { stateManager } = setup(fakeStorage({
        [jobRunnerKey('mine')]: 'user:u1',
        [jobRunnerKey('theirs')]: 'user:u2',
        [jobRunnerKey('pooled')]: 'shared',
      }));
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'user_id:u1']);
      stateManager.runners.add(ws);

      const accepted = await resumeRuns({ env, state, stateManager }, ws, ['mine', 'theirs', 'pooled', 'unknown']);

      expect(accepted).toEqual(['mine']);
      expect(ws.deserializeAttachment().activeJobs).toEqual(['mine']);
      expect(stateManager.jobs.has('theirs')).toBe(false);
      expect(stateManager.jobs.has('pooled')).toBe(false);
      expect(mockLogWarn).toHaveBeenCalledWith(expect.anything(), 'Coordinator', expect.stringContaining('3 run(s)'), expect.anything());
    });

    it('does not let a user\'s runner take over a shared-pool run', async () => {
      const { stateManager } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'shared' }));
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'user_id:attacker']);
      expect(await resumeRuns({ env, state, stateManager }, ws, ['run-1'])).toEqual([]);
      expect(stateManager.jobs.has('run-1')).toBe(false);
    });

    it('refuses malformed ids and runners without an identity', async () => {
      const { stateManager } = setup(fakeStorage({ [jobRunnerKey('done')]: 'shared' }));
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'shared']);
      expect(await resumeRuns({ env, state, stateManager }, ws, ['../x', 42, null])).toEqual([]);

      const anonymous = fakeWs();
      tagsOf.set(anonymous, ['runner']);
      expect(await resumeRuns({ env, state, stateManager }, anonymous, ['done'])).toEqual([]);
      expect(anonymous.serializeAttachment).not.toHaveBeenCalled();
      expect(stateManager.jobs.size).toBe(0);
    });

    it('parses the resume list defensively', () => {
      expect(parseResumeParam(null)).toEqual([]);
      expect(parseResumeParam('a,b,a,,../x,' + 'z'.repeat(65))).toEqual(['a', 'b']);
      expect(parseResumeParam(Array.from({ length: 50 }, (_, i) => `r${i}`).join(','))).toHaveLength(MAX_ACTIVE_JOBS_PER_RUNNER);
    });

    it('resumes a keyed runner\'s runs only after it proves its key', async () => {
      const { handler, stateManager, queueService } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'user:u1' }));
      const requests = new RequestHandler(env, state, stateManager, queueService);
      await requests.handle(new Request('http://do/connect-runner?public_key=ab&user_id=u1&name=r1&resume=run-1'));
      const ws = state.acceptWebSocket.mock.calls[0][0];
      vi.spyOn(ws, 'send').mockImplementation(() => {});
      vi.spyOn(ws, 'close').mockImplementation(() => {});
      expect(stateManager.jobs.has('run-1')).toBe(false); // not before the challenge

      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValueOnce('key' as any);
      vi.spyOn(crypto.subtle, 'verify').mockResolvedValueOnce(false);
      await handler.handleMessage(ws, JSON.stringify({ type: 'challenge_response', signature: '00' }));
      expect(stateManager.jobs.has('run-1')).toBe(false); // nor after a failed one
    });

    it('resumes a keyed runner\'s runs once the challenge succeeds, before dispatching', async () => {
      const { handler, stateManager, queueService } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'user:u1' }));
      const requests = new RequestHandler(env, state, stateManager, queueService);
      await requests.handle(new Request('http://do/connect-runner?public_key=ab&user_id=u1&name=r1&resume=run-1'));
      const ws = state.acceptWebSocket.mock.calls[0][0];
      vi.spyOn(ws, 'send').mockImplementation(() => {});
      vi.spyOn(ws, 'close').mockImplementation(() => {});
      const dispatch = queueService.checkAndDispatchQueuedScans as any;
      dispatch.mockImplementation(async () => { expect(stateManager.jobs.get('run-1')).toBe(ws); });

      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValueOnce('key' as any);
      vi.spyOn(crypto.subtle, 'verify').mockResolvedValueOnce(true);
      await handler.handleMessage(ws, JSON.stringify({ type: 'challenge_response', signature: '00' }));

      expect(stateManager.jobs.get('run-1')).toBe(ws);
      expect(ws.deserializeAttachment()).not.toHaveProperty('resume');
      expect(dispatch).toHaveBeenCalledWith(ws);
    });

    it('does not bring back a run that was stopped or failed meanwhile', async () => {
      const { stateManager, storage } = setup(fakeStorage({ [jobRunnerKey('stopped')]: 'shared' }));
      mockGetScanStatus.mockResolvedValue('failed');
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'shared']);

      expect(await resumeRuns({ env, state, stateManager }, ws, ['stopped'])).toEqual([]);
      expect(stateManager.jobs.has('stopped')).toBe(false);
      expect(storage.data.has(jobRunnerKey('stopped'))).toBe(false); // and the stale record is gone
    });

    it('fails closed when D1 cannot confirm the run is still active', async () => {
      const { stateManager, storage } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'shared' }));
      mockGetScanStatus.mockRejectedValue(new Error('D1 unavailable'));
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'shared']);

      expect(await resumeRuns({ env, state, stateManager }, ws, ['run-1'])).toEqual([]);
      expect(storage.data.has(jobRunnerKey('run-1'))).toBe(true); // may succeed on the next attempt
    });

    it('a stop while the runner is gone keeps the agent from taking the run back', async () => {
      const { stateManager, queueService, storage } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'shared' }));
      const requests = new RequestHandler(env, state, stateManager, queueService);
      // The runner was pruned: no socket holds the run, so the stop takes the no-runner path.
      await requests.handle(new Request('http://do/command', {
        method: 'POST',
        body: JSON.stringify({ runId: 'run-1', command: 'stop' }),
      }));
      expect(storage.data.has(jobRunnerKey('run-1'))).toBe(false);

      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'shared']);
      expect(await resumeRuns({ env, state, stateManager }, ws, ['run-1'])).toEqual([]);
    });

    it('accepts only the late log lines of a run that already completed', async () => {
      const { handler, stateManager } = setup(fakeStorage({
        [jobRunnerKey('done')]: 'shared',
        [FINISHED_SCANS_KEY]: ['done'],
      }));
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'shared']);
      stateManager.runners.add(ws);

      expect(await resumeRuns({ env, state, stateManager }, ws, ['done'])).toEqual([]);
      expect(stateManager.jobs.has('done')).toBe(false);
      expect(ws.deserializeAttachment().recentJobs).toEqual(['done']);

      const log = { type: 'event', runId: 'done', payload: { type: 'runner_log', data: { message: 'WAF rules' } } };
      await handler.handleMessage(ws, JSON.stringify(log));
      await handler.handleMessage(ws, JSON.stringify({ type: 'event', runId: 'done', payload: { type: 'result' } }));
      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledTimes(1);
      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledWith({ scanId: 'done', type: 'event', payload: log.payload });
    });

    it('keeps a completed run\'s record until it leaves finished_runs', async () => {
      const { handler, stateManager, storage } = setup(fakeStorage({ [jobRunnerKey('run-1')]: 'shared' }));
      const ws = fakeWs({ activeJobs: ['run-1'] });
      tagsOf.set(ws, ['runner', 'shared']);
      stateManager.runners.add(ws);
      stateManager.jobs.set('run-1', ws);

      await handler.handleMessage(ws, JSON.stringify({ type: 'event', runId: 'run-1', payload: { type: 'complete' } }));
      expect(storage.data.has(jobRunnerKey('run-1'))).toBe(true);

      // Finishing MAX_FINISHED_SCANS more runs evicts run-1, and its record with it.
      for (let i = 0; i < MAX_FINISHED_SCANS; i++) await markScanFinished(storage as any, `r${i}`);
      expect((storage.data.get(FINISHED_SCANS_KEY) as string[]).includes('run-1')).toBe(false);
      expect(storage.data.has(jobRunnerKey('run-1'))).toBe(false);
    });
  });

  describe('heartbeat', () => {
    const now = 10_000_000;

    it('drops a heartbeat runner that went silent and releases its runs for resume', () => {
      const { stateManager } = setup();
      const dead = fakeWs({ heartbeat: true, connectedAt: now - 10 * 60_000, activeJobs: ['run-1'] });
      const alive = fakeWs({ heartbeat: true, connectedAt: now - 10 * 60_000 });
      const fresh = fakeWs({ heartbeat: true, connectedAt: now - 1000 }); // has not pinged yet
      const legacy = fakeWs({ connectedAt: now - 10 * 60_000 }); // agent without heartbeat support
      pongAt.set(dead, new Date(now - RUNNER_HEARTBEAT_TIMEOUT_MS - 1));
      pongAt.set(alive, new Date(now - 5000));
      for (const ws of [dead, alive, fresh, legacy]) stateManager.runners.add(ws);
      stateManager.jobs.set('run-1', dead);

      stateManager.pruneDeadRunners(now);

      expect([...stateManager.runners]).toEqual([alive, fresh, legacy]);
      expect(stateManager.jobs.has('run-1')).toBe(false);
      expect(dead.close).toHaveBeenCalledWith(1011, 'heartbeat timeout');
      // Its attachment still names the run, so the agent's next connection can resume it.
      expect(dead.deserializeAttachment().activeJobs).toEqual(['run-1']);
    });

    it('counts from the connection time until the first ping arrives', () => {
      const { stateManager } = setup();
      const neverPinged = fakeWs({ heartbeat: true, connectedAt: now - RUNNER_HEARTBEAT_TIMEOUT_MS - 1 });
      stateManager.runners.add(neverPinged);
      stateManager.pruneDeadRunners(now);
      expect(stateManager.runners.size).toBe(0);
    });

    it('hides dead runners from the runner list', async () => {
      const { stateManager, queueService } = setup();
      const dead = fakeWs({ heartbeat: true, connectedAt: Date.now() - 10 * 60_000 });
      const alive = fakeWs({ heartbeat: true, connectedAt: Date.now() });
      tagsOf.set(dead, ['runner', 'name:runner-1', 'shared']);
      tagsOf.set(alive, ['runner', 'name:runner-1', 'shared']);
      stateManager.runners.add(dead);
      stateManager.runners.add(alive);
      const requests = new RequestHandler(env, state, stateManager, queueService);

      const res = await requests.handle(new Request('http://do/runners'));
      const { runners } = await res.json() as { runners: any[] };
      expect(runners).toHaveLength(1);
    });

    it('marks connections from heartbeat agents, and only those', async () => {
      const { stateManager, queueService } = setup();
      const requests = new RequestHandler(env, state, stateManager, queueService);

      await requests.handle(new Request('http://do/connect-runner?name=r1&shared=1&heartbeat=1'));
      await requests.handle(new Request('http://do/connect-runner?name=r2&shared=1'));
      const [withHeartbeat, without] = state.acceptWebSocket.mock.calls.map((c: any[]) => c[0]);

      expect(withHeartbeat.deserializeAttachment()).toMatchObject({ heartbeat: true, connectedAt: expect.any(Number) });
      expect(without.deserializeAttachment().heartbeat).toBeUndefined();
    });
  });

  describe('acknowledged delivery', () => {
    const EXEC = 'exec-1';
    const event = (seq: number, type = 'result', exec = EXEC, runId = 'run-1') =>
      JSON.stringify({ type: 'event', runId, exec, seq, payload: { type } });
    const acks = (ws: any) => ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0])).filter((m: any) => m.type === 'ack');
    const ack = (seq: number, exec = EXEC, runId = 'run-1') => ({ type: 'ack', runId, exec, seq });
    // Acknowledgements go out once persistence settles, in waitUntil.
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    const activeRunner = (stateManager: StateManager) => {
      const ws = fakeWs({ activeJobs: ['run-1'] });
      tagsOf.set(ws, ['runner', 'shared']);
      stateManager.runners.add(ws);
      stateManager.jobs.set('run-1', ws);
      return ws;
    };

    it('drops a replayed event it already processed, and tells the agent how far it is once', async () => {
      const { handler, stateManager } = setup();
      const ws = activeRunner(stateManager);

      await handler.handleMessage(ws, event(1));
      await handler.handleMessage(ws, event(2));
      await handler.handleMessage(ws, event(1)); // replayed after a reconnect
      await handler.handleMessage(ws, event(2));
      await handler.handleMessage(ws, event(3));
      await flush();

      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledTimes(3);
      expect(acks(ws)).toEqual([ack(2)]);
    });

    it('records every processed seq and acknowledges every ACK_EVERY events and every terminal event', async () => {
      const { handler, stateManager, storage } = setup();
      const ws = activeRunner(stateManager);

      for (let seq = 1; seq <= ACK_EVERY + 3; seq++) await handler.handleMessage(ws, event(seq));
      await flush();
      expect(acks(ws)).toEqual([ack(ACK_EVERY)]);
      expect(storage.data.get(deliveredSeqKey('run-1'))).toEqual({ exec: EXEC, seq: ACK_EVERY + 3 });

      await handler.handleMessage(ws, event(ACK_EVERY + 4, 'complete'));
      await flush();
      expect(acks(ws).at(-1)).toEqual(ack(ACK_EVERY + 4));
    });

    // Hibernation drops the Durable Object's memory whenever it idles, not only on rare restarts.
    it('remembers what it processed across hibernation', async () => {
      const storage = fakeStorage();
      const first = setup(storage);
      const ws = activeRunner(first.stateManager);
      for (let seq = 1; seq <= 3; seq++) await first.handler.handleMessage(ws, event(seq));

      const woken = setup(storage);
      woken.stateManager.runners.add(ws);
      for (let seq = 1; seq <= 4; seq++) await woken.handler.handleMessage(ws, event(seq));
      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledTimes(4);
    });

    // A run dispatched again (to another runner, or after a restart) is a new execution numbered
    // from 1, which the coordinator recognizes by its exec id instead of resetting at dispatch.
    it('starts over for a new execution of the run, and dedups within it', async () => {
      const { handler, stateManager } = setup(fakeStorage({ [deliveredSeqKey('run-1')]: { exec: 'old', seq: 40 } }));
      const ws = activeRunner(stateManager);

      await handler.handleMessage(ws, event(1));
      await handler.handleMessage(ws, event(1));
      await handler.handleMessage(ws, event(2));
      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledTimes(2);
    });

    it('leaves the delivery record alone when a run is dispatched', async () => {
      mockGetScanStatus.mockResolvedValue('queued');
      const mark = { exec: EXEC, seq: 300 };
      const { stateManager, queueService, storage } = setup(fakeStorage({ [deliveredSeqKey('run-9')]: mark }));
      const ws = fakeWs();
      tagsOf.set(ws, ['runner', 'shared']);
      stateManager.runners.add(ws);
      const requests = new RequestHandler(env, state, stateManager, queueService);

      await requests.handle(new Request('http://do/dispatch', { method: 'POST', body: JSON.stringify({ runId: 'run-9', config: {} }) }));
      // An agent still executing the run ignores the dispatch and goes on numbering; its replays
      // must stay duplicates.
      expect(storage.data.get(deliveredSeqKey('run-9'))).toEqual(mark);
      expect(await stateManager.delivery.accept('run-9', EXEC, 300)).toBe('duplicate');
    });

    it('acknowledges only once the events it covers are persisted', async () => {
      const { handler, stateManager } = setup();
      const ws = activeRunner(stateManager);
      let release!: () => void;
      env.FINDINGS_QUEUE.send.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));

      await handler.handleMessage(ws, event(1));
      await handler.handleMessage(ws, event(2, 'complete'));
      await flush();
      expect(acks(ws)).toEqual([]);

      release();
      await flush();
      expect(acks(ws)).toEqual([ack(2)]);
    });

    it('writes any event straight to D1 when the queue fails', async () => {
      const { handler, stateManager } = setup();
      const ws = activeRunner(stateManager);
      env.FINDINGS_QUEUE.send.mockRejectedValueOnce(new Error('queue down'));

      await handler.handleMessage(ws, event(1));
      await flush();
      expect(mockProcessFindings).toHaveBeenCalledWith([{ body: { scanId: 'run-1', type: 'event', payload: { type: 'result' } } }]);
    });

    it('acknowledges what the agent asks for, including events of runs it refused', async () => {
      const { handler, stateManager } = setup();
      const ws = activeRunner(stateManager);
      await handler.handleMessage(ws, event(1, 'runner_log'));
      await handler.handleMessage(ws, JSON.stringify({ type: 'ack_request', runId: 'run-1', exec: EXEC, seq: 1 }));

      for (let seq = 1; seq <= 3; seq++) await handler.handleMessage(ws, event(seq, 'result', 'other', 'not-mine'));
      await handler.handleMessage(ws, JSON.stringify({ type: 'ack_request', runId: 'not-mine', exec: 'other', seq: 3 }));
      await flush();

      expect(acks(ws)).toEqual([ack(1), ack(3, 'other', 'not-mine')]);
      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledTimes(1);
      // A replay of refused events is logged once, not once per event.
      expect(mockLogError.mock.calls.filter(c => String(c[2]).includes('not-mine'))).toHaveLength(1);
    });

    it('rejects a malformed seq, exec or ack request', async () => {
      const { handler, stateManager } = setup();
      const ws = activeRunner(stateManager);
      for (const seq of [0, -1, 1.5, '2', null]) {
        await handler.handleMessage(ws, JSON.stringify({ type: 'event', runId: 'run-1', exec: EXEC, seq, payload: { type: 'result' } }));
      }
      for (const exec of [undefined, '', 7, 'x'.repeat(65)]) {
        await handler.handleMessage(ws, JSON.stringify({ type: 'event', runId: 'run-1', exec, seq: 1, payload: { type: 'result' } }));
      }
      await handler.handleMessage(ws, JSON.stringify({ type: 'ack_request', runId: 'run-1', exec: EXEC, seq: 0 }));
      await flush();
      expect(env.FINDINGS_QUEUE.send).not.toHaveBeenCalled();
      expect(acks(ws)).toEqual([]);
    });

    it('handles agents that send no seq exactly as before', async () => {
      const { handler, stateManager } = setup();
      const ws = activeRunner(stateManager);
      const legacy = JSON.stringify({ type: 'event', runId: 'run-1', payload: { type: 'result' } });
      await handler.handleMessage(ws, legacy);
      await handler.handleMessage(ws, legacy);
      await flush();
      expect(env.FINDINGS_QUEUE.send).toHaveBeenCalledTimes(2);
      expect(acks(ws)).toEqual([]);
    });

    it('announces support on the runner WebSocket upgrade', async () => {
      const { stateManager, queueService } = setup();
      const requests = new RequestHandler(env, state, stateManager, queueService);
      const res = await requests.handle(new Request('http://do/connect-runner?name=r1&shared=1'));
      expect(res.headers.get(DELIVERY_HEADER)).toBe('ack');
    });

    it('drops the delivery state of a stopped run and of runs evicted from finished_runs', async () => {
      const { stateManager, queueService, storage } = setup(fakeStorage({
        [deliveredSeqKey('stopped')]: { exec: EXEC, seq: 3 },
        [deliveredSeqKey('old')]: { exec: EXEC, seq: 9 },
      }));
      const requests = new RequestHandler(env, state, stateManager, queueService);
      await requests.handle(new Request('http://do/command', { method: 'POST', body: JSON.stringify({ runId: 'stopped', command: 'stop' }) }));
      expect(storage.data.has(deliveredSeqKey('stopped'))).toBe(false);

      await markScanFinished(storage as any, 'old');
      for (let i = 0; i < MAX_FINISHED_SCANS; i++) await markScanFinished(storage as any, `r${i}`);
      expect(storage.data.has(deliveredSeqKey('old'))).toBe(false);
    });
  });

  it('records which runner identity a dispatched run went to', async () => {
    mockGetScanStatus.mockResolvedValue('queued');
    const { stateManager, queueService, storage } = setup();
    const ws = fakeWs();
    tagsOf.set(ws, ['runner', 'shared']);
    stateManager.runners.add(ws);
    const requests = new RequestHandler(env, state, stateManager, queueService);

    const res = await requests.handle(new Request('http://do/dispatch', {
      method: 'POST',
      body: JSON.stringify({ runId: 'run-9', userId: 'u1', config: {} }),
    }));
    expect(res.status).toBe(200);
    expect(storage.data.get(jobRunnerKey('run-9'))).toBe('shared');
  });
});
