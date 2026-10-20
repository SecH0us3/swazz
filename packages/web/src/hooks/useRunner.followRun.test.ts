// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// A scan must end on the dashboard however it ends: an error event in any shape, the stream
// dropping, or the scan going quiet. It must never be left looking like it is still running.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { followRun, RUN_STALL_AFTER_MS, RUN_STATUS_CHECK_MS, RUN_MAX_RECONNECTS } from './useRunner.js';
import { useAppStore } from '../store/appStore.js';

class FakeSocket {
    static instances: FakeSocket[] = [];
    static CLOSED = 3;
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    constructor(public url: string) { FakeSocket.instances.push(this); }
    send = vi.fn();
    close = vi.fn(() => { this.readyState = 3; });
    emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
    drop() { this.readyState = 3; this.onclose?.(); }
    open() { this.onopen?.(); }
}

const status = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });

describe('followRun', () => {
    let handlers: { onResult: any; onComplete: any; onError: any };
    let wsRef: { current: WebSocket | null };

    beforeEach(() => {
        vi.useFakeTimers();
        FakeSocket.instances = [];
        vi.stubGlobal('WebSocket', FakeSocket);
        vi.stubGlobal('fetch', status({ scan: { status: 'dispatched' } }));
        handlers = { onResult: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
        wsRef = { current: null };
        useAppStore.setState({ isRunning: true, isPaused: false, isQueued: false, scanIssue: null, runWarnings: { count: 0, recent: [] }, runStalled: false, stats: null });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const socket = () => FakeSocket.instances.at(-1)!;

    it('ends the scan on a runner error and says why, with a hint', () => {
        followRun('r1', '', handlers, wsRef);
        socket().emit({ type: 'error', data: { message: 'could not connect to the MCP server: SSE connection failed with status 401' } });

        const state = useAppStore.getState();
        expect(state.isRunning).toBe(false);
        expect(state.scanIssue).toMatchObject({ level: 'error', title: 'The scan failed' });
        expect(state.scanIssue?.details[0]).toContain('status 401');
        expect(state.scanIssue?.hint?.action?.tab).toBe('project_settings');
        expect(handlers.onError).toHaveBeenCalledWith(expect.stringContaining('status 401'));
        expect(socket().close).toHaveBeenCalled();
    });

    // What production sent before this change: the scan stayed "running" forever.
    it('ends the scan on an untyped runner error from an older coordinator', () => {
        followRun('r1', '', handlers, wsRef);
        socket().emit({ error: 'failed to connect to MCP server: SSE connection failed with status 401' });
        expect(useAppStore.getState().isRunning).toBe(false);
        expect(handlers.onError).toHaveBeenCalled();
    });

    it('reports warnings the runner logged when the scan completes', () => {
        followRun('r1', '', handlers, wsRef);
        socket().emit({ type: 'runner_log', data: { level: 'info', message: 'Scan targets: 3 API endpoint(s)' } });
        socket().emit({ type: 'runner_log', data: { level: 'warn', message: '[MCP] ⚠️ could not connect to the MCP server: status 401. The MCP part of the scan is skipped' } });
        socket().emit({ type: 'complete', data: { totalRequests: 9 } });

        const state = useAppStore.getState();
        expect(handlers.onComplete).toHaveBeenCalledWith({ totalRequests: 9 });
        expect(state.scanIssue).toMatchObject({ level: 'warning', title: 'The scan completed with 1 warning' });
        expect(state.scanIssue?.hint?.action?.tab).toBe('project_settings');
    });

    it('shows nothing after a clean scan', () => {
        followRun('r1', '', handlers, wsRef);
        socket().emit({ type: 'complete', data: {} });
        expect(useAppStore.getState().scanIssue).toBeNull();
    });

    it('keeps only the latest few warnings, but counts them all', () => {
        followRun('r1', '', handlers, wsRef);
        for (let i = 0; i < 8; i++) socket().emit({ type: 'runner_log', data: { level: 'error', message: `e${i}` } });
        expect(useAppStore.getState().runWarnings).toEqual({ count: 8, recent: ['e3', 'e4', 'e5', 'e6', 'e7'] });
    });

    it('settles a scan whose stream dropped from its status: failed', async () => {
        vi.stubGlobal('fetch', status({ scan: { status: 'failed', failure_reason: 'Runner lost' } }));
        followRun('r1', '', handlers, wsRef);
        socket().drop();
        await vi.runOnlyPendingTimersAsync();
        expect(useAppStore.getState().isRunning).toBe(false);
        expect(handlers.onError).toHaveBeenCalledWith('Runner lost');
    });

    it('settles a scan whose stream dropped from its status: completed, saying results may be missing', async () => {
        vi.stubGlobal('fetch', status({ scan: { status: 'completed' } }));
        followRun('r1', '', handlers, wsRef);
        socket().emit({ type: 'progress', data: { totalRequests: 4 } });
        socket().drop();
        await vi.runOnlyPendingTimersAsync();
        expect(handlers.onComplete).toHaveBeenCalledWith({ totalRequests: 4 });
        expect(useAppStore.getState().scanIssue?.title).toMatch(/connection to this scan was lost/);
    });

    // It completed before a single progress event arrived: the scan's own stats, not null.
    it('takes a scan\'s final stats from the API when the stream had none', async () => {
        vi.stubGlobal('fetch', status({ scan: { status: 'completed', summary_stats: JSON.stringify({ totalRequests: 42 }) } }));
        followRun('r1', '', handlers, wsRef);
        socket().drop();
        await vi.runOnlyPendingTimersAsync();
        expect(handlers.onComplete).toHaveBeenCalledWith({ totalRequests: 42 });
        expect(useAppStore.getState().stats).toEqual({ totalRequests: 42 });
    });

    it('reconnects while the scan is still running, a bounded number of times', async () => {
        followRun('r1', '', handlers, wsRef);
        for (let i = 0; i < RUN_MAX_RECONNECTS; i++) {
            socket().drop();
            await vi.advanceTimersByTimeAsync(1000 * (i + 1) + 10);
        }
        expect(FakeSocket.instances).toHaveLength(RUN_MAX_RECONNECTS + 1);
        socket().drop();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeSocket.instances).toHaveLength(RUN_MAX_RECONNECTS + 1);
        expect(useAppStore.getState().runStalled).toBe(true);
        expect(useAppStore.getState().isRunning).toBe(true);
    });

    // A long scan on a flaky network: each reconnect works, so the stream must keep coming back.
    it('keeps reconnecting after drops that each recovered', async () => {
        followRun('r1', '', handlers, wsRef);
        for (let i = 0; i < RUN_MAX_RECONNECTS * 2; i++) {
            socket().drop();
            await vi.advanceTimersByTimeAsync(1000 + 10);
            socket().emit({ type: 'progress', data: {} });
        }
        expect(FakeSocket.instances).toHaveLength(RUN_MAX_RECONNECTS * 2 + 1);
        expect(useAppStore.getState().runStalled).toBe(false);
    });

    it('says so when the scan goes quiet, and ends it once its status is known', async () => {
        followRun('r1', '', handlers, wsRef);
        await vi.advanceTimersByTimeAsync(RUN_STALL_AFTER_MS + RUN_STATUS_CHECK_MS);
        expect(useAppStore.getState().runStalled).toBe(true);
        expect(useAppStore.getState().isRunning).toBe(true);

        // Activity clears it.
        socket().emit({ type: 'progress', data: {} });
        expect(useAppStore.getState().runStalled).toBe(false);

        vi.stubGlobal('fetch', status({ scan: { status: 'failed', failure_reason: 'The runner executing this scan stopped responding' } }));
        await vi.advanceTimersByTimeAsync(RUN_STALL_AFTER_MS + RUN_STATUS_CHECK_MS);
        expect(useAppStore.getState().isRunning).toBe(false);
        expect(useAppStore.getState().scanIssue?.hint?.action?.tab).toBe('settings');
    });

    it('does not warn about a queued scan being quiet, but still checks it', async () => {
        const fetchStatus = status({ scan: { status: 'queued' } });
        vi.stubGlobal('fetch', fetchStatus);
        followRun('r1', '', handlers, wsRef);
        socket().emit({ type: 'queued' });
        await vi.advanceTimersByTimeAsync(RUN_STALL_AFTER_MS + RUN_STATUS_CHECK_MS);
        expect(useAppStore.getState().runStalled).toBe(false);
        expect(fetchStatus).toHaveBeenCalled();
    });

    // A scan can fail before the dashboard's stream connects: its error event was never seen.
    it('ends a scan that failed before the stream connected, as soon as it connects', async () => {
        vi.stubGlobal('fetch', status({ scan: { status: 'failed', failure_reason: 'could not connect to the MCP server: status 401' } }));
        followRun('r1', '', handlers, wsRef);
        socket().open();
        await vi.advanceTimersByTimeAsync(0);
        expect(useAppStore.getState().isRunning).toBe(false);
        expect(handlers.onError).toHaveBeenCalledWith('could not connect to the MCP server: status 401');
    });

    it('keeps checking a scan it has heard nothing from, without waiting for the stall', async () => {
        const fetchStatus = status({ scan: { status: 'dispatched' } });
        vi.stubGlobal('fetch', fetchStatus);
        followRun('r1', '', handlers, wsRef);
        await vi.advanceTimersByTimeAsync(RUN_STATUS_CHECK_MS);
        expect(fetchStatus).toHaveBeenCalledTimes(1);
        socket().emit({ type: 'progress', data: {} });
        await vi.advanceTimersByTimeAsync(RUN_STATUS_CHECK_MS * 2);
        expect(fetchStatus).toHaveBeenCalledTimes(1);
    });

    it('includes warnings the runner logged before the dashboard connected', async () => {
        const logs = [
            { payload: JSON.stringify({ type: 'runner_log', data: { level: 'info', message: 'Scan targets: 3 API endpoint(s)' } }) },
            { payload: JSON.stringify({ type: 'runner_log', data: { level: 'warn', message: '[MCP] ⚠️ could not connect to the MCP server: status 401' } }) },
        ];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith('/runner-logs') ? { logs } : { scan: { status: 'dispatched' } }) })));
        followRun('r1', '', handlers, wsRef);
        socket().emit({ type: 'complete', data: {} });
        expect(useAppStore.getState().scanIssue).toBeNull();
        await vi.advanceTimersByTimeAsync(0);
        expect(useAppStore.getState().scanIssue).toMatchObject({ level: 'warning', title: 'The scan completed with 1 warning' });
        expect(useAppStore.getState().scanIssue?.hint?.action?.tab).toBe('project_settings');
    });

    it('does not bring back an issue the user dismissed meanwhile', async () => {
        let release!: () => void;
        // More than the live stream saw, so only the dismissal can keep it from being shown.
        const logs = [
            { payload: JSON.stringify({ level: 'warn', message: 'early warning' }) },
            { payload: JSON.stringify({ level: 'warn', message: 'live warning' }) },
        ];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.endsWith('/runner-logs')) await new Promise<void>(r => { release = r; });
            return { ok: true, status: 200, json: async () => (url.endsWith('/runner-logs') ? { logs } : { scan: { status: 'dispatched' } }) };
        }));
        followRun('r1', '', handlers, wsRef);
        socket().emit({ type: 'runner_log', data: { level: 'warn', message: 'live warning' } });
        socket().emit({ type: 'complete', data: {} });
        expect(useAppStore.getState().scanIssue?.level).toBe('warning');
        useAppStore.setState({ scanIssue: null });
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(useAppStore.getState().scanIssue).toBeNull();
    });

    it('does nothing more once stopped', async () => {
        const stop = followRun('r1', '', handlers, wsRef);
        const first = socket();
        stop();
        first.drop();
        first.emit({ type: 'error', data: { message: 'late' } });
        await vi.advanceTimersByTimeAsync(RUN_STALL_AFTER_MS * 2);
        expect(handlers.onError).not.toHaveBeenCalled();
        expect(FakeSocket.instances).toHaveLength(1);
    });
});
