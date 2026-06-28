import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunner } from './useRunner.js';
import { useAppStore } from '../store/appStore.js';

describe('useRunner', () => {
    const proxyUrl = 'http://localhost:8080';

    beforeEach(() => {
        vi.restoreAllMocks();
        globalThis.fetch = vi.fn();
        (globalThis as any).WebSocket = vi.fn().mockImplementation(function() {
            return {
                close: vi.fn(),
                send: vi.fn(),
            };
        });
        useAppStore.setState({ isRunning: false, isPaused: false, stats: null });
    });

    it('should handle successful stop', async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '123' }) }) // start
            .mockResolvedValueOnce({ ok: true }); // stop

        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        await act(async () => {
            await result.current.stop();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/runs/123/stop`, {
            method: 'POST',
            headers: {}
        });
        expect(useAppStore.getState().isRunning).toBe(false);
    });

    it('should handle failed stop and still set isRunning to false', async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '123' }) }) // start
            .mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Some error' }),
            }); // stop

        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        await act(async () => {
            await expect(result.current.stop()).rejects.toThrow("Failed to stop run");
        });

        expect(useAppStore.getState().isRunning).toBe(false);
    });

    it('should handle successful pause', async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '123' }) }) // start
            .mockResolvedValueOnce({ ok: true }); // pause

        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        await act(async () => {
            await result.current.pause();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/runs/123/pause`, {
            method: 'POST',
            headers: {}
        });
        expect(useAppStore.getState().isPaused).toBe(true);
    });

    it('should handle failed pause', async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '123' }) }) // start
            .mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Some error' }),
            }); // pause

        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        await expect(act(async () => {
            await result.current.pause();
        })).rejects.toThrow('Failed to pause');

        expect(useAppStore.getState().isPaused).toBe(false);
    });

    it('should handle successful resume', async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '123' }) }) // start
            .mockResolvedValueOnce({ ok: true }); // resume

        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        await act(async () => {
            await result.current.resume();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/runs/123/resume`, {
            method: 'POST',
            headers: {}
        });
        expect(useAppStore.getState().isPaused).toBe(false);
    });

    it('should handle websocket events and update isQueued, running, complete states', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: '123' }) });

        let wsInstance: any = null;
        (globalThis as any).WebSocket = vi.fn().mockImplementation(function() {
            wsInstance = {
                close: vi.fn(),
                send: vi.fn(),
            };
            return wsInstance;
        });

        const { result } = renderHook(() => useRunner(proxyUrl));
        const onResult = vi.fn();
        const onComplete = vi.fn();

        await act(async () => {
            await result.current.start({}, onResult, onComplete);
        });

        expect(wsInstance).not.toBeNull();
        expect(wsInstance.onmessage).toBeDefined();

        // 1. Send queued event
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'queued' }) });
        });
        expect(useAppStore.getState().isQueued).toBe(true);

        // 2. Send result event
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'result', data: 'some_data' }) });
        });
        expect(useAppStore.getState().isQueued).toBe(false);
        expect(onResult).toHaveBeenCalledWith('some_data');

        // 3. Send progress event
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'progress', data: 'progress_data' }) });
        });
        expect(useAppStore.getState().isQueued).toBe(false);

        // 4. Send complete event
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'complete', data: 'final_stats' }) });
        });
        expect(useAppStore.getState().isQueued).toBe(false);
        expect(useAppStore.getState().isRunning).toBe(false);
        expect(onComplete).toHaveBeenCalledWith('final_stats');
    });
});
