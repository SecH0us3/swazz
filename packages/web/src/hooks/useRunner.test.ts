import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunner } from './useRunner.js';
import { useAppStore } from '../store/appStore.js';

describe('useRunner', () => {
    const proxyUrl = 'http://localhost:8080';

    beforeEach(() => {
        vi.restoreAllMocks();
        globalThis.fetch = vi.fn();
        (globalThis as any).EventSource = vi.fn().mockImplementation(() => ({
            addEventListener: vi.fn(),
            close: vi.fn(),
            onerror: null,
        }));
        useAppStore.setState({ isRunning: false, isPaused: false, stats: null });
    });

    it('should handle successful stop', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.stop();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/fuzz/stop`, { method: 'POST' });
        expect(useAppStore.getState().isRunning).toBe(false);
    });

    it('should handle failed stop and still set isRunning to false', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Some error' }),
        });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await expect(result.current.stop()).rejects.toThrow("Failed to stop run");
        });

        expect(useAppStore.getState().isRunning).toBe(false);
    });

    it('should handle successful pause', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.pause();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/fuzz/pause`, { method: 'POST' });
        expect(useAppStore.getState().isPaused).toBe(true);
    });

    it('should handle failed pause', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Some error' }),
        });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await expect(act(async () => {
            await result.current.pause();
        })).rejects.toThrow('Failed to pause');

        expect(useAppStore.getState().isPaused).toBe(false);
    });

    it('should handle successful resume', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.resume();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/fuzz/resume`, { method: 'POST' });
        expect(useAppStore.getState().isPaused).toBe(false);
    });
});
