import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunner, previewPayload, previewResponse, preview, toSummary } from './useRunner.js';
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

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/runs/123/stop`, { method: 'POST' });
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

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/runs/123/pause`, { method: 'POST' });
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

        expect(globalThis.fetch).toHaveBeenCalledWith(`${proxyUrl}/api/runs/123/resume`, { method: 'POST' });
        expect(useAppStore.getState().isPaused).toBe(false);
    });

    describe('helper functions', () => {
        it('preview should format and truncate strings and objects', () => {
            expect(preview(null)).toBe('');
            expect(preview(undefined)).toBe('');
            expect(preview('abc')).toBe('abc');
            
            const longStr = 'a'.repeat(100);
            expect(preview(longStr)).toBe('a'.repeat(80) + '… (20 chars)');

            const obj = { key: 'a'.repeat(100) };
            const truncatedObj = JSON.parse(preview(obj));
            expect(truncatedObj.key).toBe('a'.repeat(80) + '… (20 chars)');

            const arr = ['a', 'b', 'c', 'd'];
            const truncatedArr = JSON.parse(preview(arr));
            expect(truncatedArr).toHaveLength(4);
            expect(truncatedArr[3]).toContain('more items');
        });

        it('previewPayload should call preview', () => {
            expect(previewPayload('abc')).toBe('abc');
        });

        it('previewResponse should handle and truncate string and objects', () => {
            expect(previewResponse(null)).toBe('');
            expect(previewResponse(undefined)).toBe('');
            expect(previewResponse('abc')).toBe('abc');
            
            const longStr = 'a'.repeat(2100);
            expect(previewResponse(longStr)).toContain('chars more');

            const obj = { key: 'a'.repeat(500) };
            const parsed = JSON.parse(previewResponse(obj));
            expect(parsed.key).toContain('chars');

            const arr = [1, 2, 3, 4, 5, 6];
            const parsedArr = JSON.parse(previewResponse(arr));
            expect(parsedArr).toHaveLength(6);
            expect(parsedArr[5]).toContain('more items');
        });

        it('toSummary should correctly convert raw results', () => {
            const raw = {
                id: '1',
                timestamp: 1000,
                method: 'GET',
                endpoint: '/users',
                resolvedPath: '/users/123',
                status: 200,
                profile: 'random',
                duration: 50,
                payloadSize: 10,
                retries: 0,
                payloadPreview: 'payload',
                responsePreview: 'response',
                error: 'err',
                responseSize: 100,
                responseHeaders: { 'Content-Type': ['application/json'] },
                requestHeaders: { 'Authorization': 'Bearer ...' },
                hasHeaderInjection: true,
                analyzerFindings: [{ ruleId: 'rule1' }],
                identity: 'user1',
                owaspCategory: ['A1'],
                triage: 'none'
            };
            const summary = toSummary(raw);
            expect(summary.id).toBe('1');
            expect(summary.payloadPreview).toBe('payload');
            expect(summary.responsePreview).toBe('response');
            expect(summary.error).toBe('err');
            expect(summary.responseHeaders).toEqual({ 'Content-Type': ['application/json'] });
            expect(summary.requestHeaders).toEqual({ 'Authorization': 'Bearer ...' });
            expect(summary.hasHeaderInjection).toBe(true);
            expect(summary.analyzerFindings).toHaveLength(1);
            expect(summary.identity).toBe('user1');
            expect(summary.owaspCategory).toEqual(['A1']);
            expect(summary.triage).toBe('none');
        });
    });
});
