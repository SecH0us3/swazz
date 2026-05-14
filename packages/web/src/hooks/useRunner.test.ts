import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunner } from './useRunner.js';

describe('useRunner', () => {
    const proxyUrl = 'http://localhost:8080';

    beforeEach(() => {
        vi.restoreAllMocks();
        global.fetch = vi.fn();
        (global as any).EventSource = vi.fn().mockImplementation(() => ({
            addEventListener: vi.fn(),
            close: vi.fn(),
            onerror: null,
        }));
    });

    it('should handle successful stop', async () => {
        (global.fetch as any).mockResolvedValueOnce({ ok: true });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.stop();
        });

        expect(global.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/fuzz/stop`, { method: 'POST' });
        expect(result.current.isRunning).toBe(false);
    });

    it('should handle failed stop and still set isRunning to false', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Some error' }),
        });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await expect(act(async () => {
            await result.current.stop();
        })).rejects.toThrow('Some error');

        expect(result.current.isRunning).toBe(false);
    });

    it('should handle successful pause', async () => {
        (global.fetch as any).mockResolvedValueOnce({ ok: true });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.pause();
        });

        expect(global.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/fuzz/pause`, { method: 'POST' });
        expect(result.current.isPaused).toBe(true);
    });

    it('should handle failed pause', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Pause failed' }),
        });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await expect(act(async () => {
            await result.current.pause();
        })).rejects.toThrow('Pause failed');

        expect(result.current.isPaused).toBe(false);
    });

    it('should handle successful resume', async () => {
        (global.fetch as any).mockResolvedValueOnce({ ok: true });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.resume();
        });

        expect(global.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/fuzz/resume`, { method: 'POST' });
        expect(result.current.isPaused).toBe(false);
    });
});
