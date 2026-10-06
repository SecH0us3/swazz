// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunner, preview, previewResponse, toSummary } from './useRunner.js';
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

    it('should send proxy request using sendRequest', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 200, body: '{"ok":true}', duration: 15 })
        });

        const { result } = renderHook(() => useRunner(proxyUrl));
        const res = await result.current.sendRequest({
            url: 'http://example.com/api',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cookies: {},
            body: { test: true }
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${proxyUrl}/api/proxy`,
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    url: 'http://example.com/api',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    cookies: {},
                    body: { test: true }
                })
            })
        );
        expect(res.status).toBe(200);
    });

    it('should throw an error with status when sendRequest receives 4xx error', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 403,
            json: async () => ({ error: 'Target host not authorized for replay' }),
        });

        const { result } = renderHook(() => useRunner(proxyUrl));
        await expect(result.current.sendRequest({
            url: 'https://unauthorized.com/api',
            method: 'GET',
            headers: {},
            cookies: {},
            body: undefined,
        })).rejects.toMatchObject({
            message: 'Target host not authorized for replay',
            status: 403,
        });
    });

    it('should connect to existing run via websocket using connectToExisting', async () => {
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
            await result.current.connectToExisting('existing-run-123', onResult, onComplete);
        });

        expect(useAppStore.getState().isRunning).toBe(true);
        expect(wsInstance).not.toBeNull();

        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'result', data: { status: 200 } }) });
        });
        expect(onResult).toHaveBeenCalled();
    });

    it('should ignore start call if already running', async () => {
        useAppStore.setState({ isRunning: true });
        const { result } = renderHook(() => useRunner(proxyUrl));
        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should ignore connectToExisting call if already running', async () => {
        useAppStore.setState({ isRunning: true });
        const { result } = renderHook(() => useRunner(proxyUrl));
        await act(async () => {
            await result.current.connectToExisting('run-999', vi.fn(), vi.fn());
        });
        expect(useAppStore.getState().isRunning).toBe(true);
    });

    it('should do nothing on stop, pause, resume if no run has started', async () => {
        const { result } = renderHook(() => useRunner(proxyUrl));
        await act(async () => {
            await result.current.stop();
            await result.current.pause();
            await result.current.resume();
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should pass CSRF and auth tokens in start, stop, pause, resume, and sendRequest', async () => {
        useAppStore.setState({ csrfToken: 'test-csrf-token' });
        localStorage.setItem('swazz_token', 'test-auth-jwt');

        // 1. Test start
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'run-auth-test' }) });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.start({ projectId: 'proj-1', target: 'http://test' }, vi.fn(), vi.fn(), 'client-run-id');
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${proxyUrl}/api/runs`,
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'test-csrf-token',
                    Authorization: 'Bearer test-auth-jwt',
                }),
                body: JSON.stringify({
                    config: { target: 'http://test' },
                    projectId: 'proj-1',
                    runId: 'client-run-id',
                }),
            })
        );

        // 2. Test pause
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true });
        await act(async () => {
            await result.current.pause();
        });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${proxyUrl}/api/runs/run-auth-test/pause`,
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'test-csrf-token',
                    Authorization: 'Bearer test-auth-jwt',
                }),
            })
        );

        // 3. Test resume
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true });
        await act(async () => {
            await result.current.resume();
        });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${proxyUrl}/api/runs/run-auth-test/resume`,
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'test-csrf-token',
                    Authorization: 'Bearer test-auth-jwt',
                }),
            })
        );

        // 4. Test stop
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true });
        await act(async () => {
            await result.current.stop();
        });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${proxyUrl}/api/runs/run-auth-test/stop`,
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'test-csrf-token',
                    Authorization: 'Bearer test-auth-jwt',
                }),
            })
        );

        // 5. Test sendRequest
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: 200, body: 'ok' }) });
        await act(async () => {
            await result.current.sendRequest({
                url: 'http://example.com',
                method: 'GET',
                headers: {},
                cookies: {},
                body: null,
            });
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${proxyUrl}/api/proxy`,
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'test-csrf-token',
                    Authorization: 'Bearer test-auth-jwt',
                }),
            })
        );

        localStorage.removeItem('swazz_token');
        useAppStore.setState({ csrfToken: null });
    });

    it('should format array endpoints into include/exclude structure in start', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ep-run' }) });
        const { result } = renderHook(() => useRunner(proxyUrl));

        await act(async () => {
            await result.current.start({
                endpoints: [
                    { method: 'GET', path: '/users' },
                    { method: 'POST', path: '/users' }
                ],
                disabled_endpoints: ['DELETE /users']
            }, vi.fn(), vi.fn());
        });

        const [url, options] = (globalThis.fetch as any).mock.calls[0];
        expect(url).toBe(`${proxyUrl}/api/runs`);
        expect(JSON.parse(options.body)).toEqual({
            config: {
                endpoints: {
                    include: ['GET /users', 'POST /users'],
                    exclude: ['DELETE /users'],
                },
                disabled_endpoints: ['DELETE /users'],
                endpoint_definitions: [
                    { method: 'GET', path: '/users' },
                    { method: 'POST', path: '/users' },
                ],
            },
            projectId: '',
        });
    });

    it('should handle start failure when server returns !res.ok without error message', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({
            ok: false,
            json: async () => ({}),
        });

        const { result } = renderHook(() => useRunner(proxyUrl));
        await expect(act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        })).rejects.toThrow('Failed to start run');
        expect(useAppStore.getState().isRunning).toBe(false);
    });

    it('should handle resume failure when server returns !res.ok', async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '123' }) })
            .mockResolvedValueOnce({ ok: false });

        const { result } = renderHook(() => useRunner(proxyUrl));
        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        await expect(act(async () => {
            await result.current.resume();
        })).rejects.toThrow('Failed to resume');
    });

    it('should throttle progress updates and handle ws error and malformed message', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ws-test-run' }) });
        let wsInstance: any = null;
        (globalThis as any).WebSocket = vi.fn().mockImplementation(function() {
            wsInstance = {
                close: vi.fn(),
                send: vi.fn(),
            };
            return wsInstance;
        });

        const { result } = renderHook(() => useRunner(proxyUrl));
        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        // 1. Malformed JSON message
        act(() => {
            wsInstance.onmessage({ data: 'not-json-content' });
        });

        // 2. First progress message updates stats
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'progress', data: { requests: 10 } }) });
        });
        expect(useAppStore.getState().stats).toEqual({ requests: 10 });

        // 3. Immediate second progress message is throttled
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'progress', data: { requests: 11 } }) });
        });
        expect(useAppStore.getState().stats).toEqual({ requests: 10 });

        // 4. WebSocket error event
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'error', data: 'fatal' }) });
        });
        expect(useAppStore.getState().isRunning).toBe(false);
        expect(wsInstance.close).toHaveBeenCalled();

        // 5. Trigger onerror callback directly
        act(() => {
            wsInstance.onerror();
        });
        expect(useAppStore.getState().isRunning).toBe(false);
    });

    it('should close websocket on unmount', async () => {
        (globalThis.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ws-unmount' }) });
        let wsInstance: any = null;
        (globalThis as any).WebSocket = vi.fn().mockImplementation(function() {
            wsInstance = {
                close: vi.fn(),
                send: vi.fn(),
            };
            return wsInstance;
        });

        const { result, unmount } = renderHook(() => useRunner(proxyUrl));
        await act(async () => {
            await result.current.start({}, vi.fn(), vi.fn());
        });

        unmount();
        expect(wsInstance.close).toHaveBeenCalled();
    });

    it('handles connectToExisting message types: progress, complete, error, onerror, invalid json', async () => {
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
            await result.current.connectToExisting('existing-run-99', onResult, onComplete);
        });

        // Queued
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'queued' }) });
        });
        expect(useAppStore.getState().isQueued).toBe(true);

        // Invalid JSON
        act(() => {
            wsInstance.onmessage({ data: '{broken-json' });
        });

        // Progress
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'progress', data: { requests: 42 } }) });
        });
        expect(useAppStore.getState().isQueued).toBe(false);
        expect(useAppStore.getState().stats).toEqual({ requests: 42 });

        // Error message
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'error', data: 'fail' }) });
        });
        expect(useAppStore.getState().isRunning).toBe(false);

        // onerror
        act(() => {
            wsInstance.onerror();
        });
        expect(useAppStore.getState().isRunning).toBe(false);

        // Reconnect and test complete
        await act(async () => {
            await result.current.connectToExisting('existing-run-100', onResult, onComplete);
        });
        act(() => {
            wsInstance.onmessage({ data: JSON.stringify({ type: 'complete', data: { total: 100 } }) });
        });
        expect(useAppStore.getState().isRunning).toBe(false);
        expect(onComplete).toHaveBeenCalledWith({ total: 100 });
    });
});

describe('useRunner helpers: preview, previewResponse, toSummary', () => {
    describe('preview', () => {
        it('returns empty string for null and undefined', () => {
            expect(preview(null)).toBe('');
            expect(preview(undefined)).toBe('');
        });

        it('returns short strings directly', () => {
            expect(preview('hello world')).toBe('hello world');
        });

        it('truncates strings longer than 80 chars', () => {
            const longStr = 'a'.repeat(100);
            const res = preview(longStr);
            expect(res).toBe('a'.repeat(80) + '… (20 chars)');
        });

        it('handles arrays with <= 3 items and > 3 items', () => {
            const smallArr = ['one', 'two'];
            expect(JSON.parse(preview(smallArr))).toEqual(['one', 'two']);

            const bigArr = ['one', 'two', 'three', 'four', 'five'];
            const res = JSON.parse(preview(bigArr));
            expect(res).toHaveLength(4);
            expect(res[3]).toBe('… (2 more items)');
        });

        it('handles nested objects and primitives', () => {
            const obj = {
                num: 123,
                bool: true,
                nil: null,
                nested: { str: 'b'.repeat(90) }
            };
            const parsed = JSON.parse(preview(obj));
            expect(parsed.num).toBe(123);
            expect(parsed.bool).toBe(true);
            expect(parsed.nil).toBeNull();
            expect(parsed.nested.str).toBe('b'.repeat(80) + '… (10 chars)');
        });

        it('returns non-object non-string primitives as stringified JSON', () => {
            expect(preview(42)).toBe('42');
            expect(preview(true)).toBe('true');
        });
    });

    describe('previewResponse', () => {
        it('returns empty string for null and undefined', () => {
            expect(previewResponse(null)).toBe('');
            expect(previewResponse(undefined)).toBe('');
        });

        it('returns string <= 2000 chars as is', () => {
            expect(previewResponse('simple response')).toBe('simple response');
        });

        it('truncates string > 2000 chars', () => {
            const longRes = 'x'.repeat(2100);
            const res = previewResponse(longRes);
            expect(res).toBe('x'.repeat(2000) + '\n… (100 chars more)');
        });

        it('handles array with <= 5 items and > 5 items', () => {
            const small = [1, 2, 3, 4, 5];
            expect(JSON.parse(previewResponse(small))).toEqual([1, 2, 3, 4, 5]);

            const large = [1, 2, 3, 4, 5, 6, 7];
            const parsed = JSON.parse(previewResponse(large));
            expect(parsed).toHaveLength(6);
            expect(parsed[5]).toBe('… (2 more items)');
        });

        it('handles object with string > 400 chars and null values', () => {
            const obj = {
                str: 'c'.repeat(450),
                nil: null,
                undef: undefined,
                num: 99
            };
            const parsed = JSON.parse(previewResponse(obj));
            expect(parsed.str).toBe('c'.repeat(400) + '… (50 chars)');
            expect(parsed.nil).toBeNull();
            expect(parsed.num).toBe(99);
        });

        it('returns non-object non-string primitives as stringified JSON', () => {
            expect(previewResponse(555)).toBe('555');
            expect(previewResponse(false)).toBe('false');
        });
    });

    describe('toSummary', () => {
        it('converts full raw result object accurately', () => {
            const raw = {
                id: 'res-1',
                timestamp: 123456789,
                method: 'POST',
                endpoint: '/api/v1/user',
                resolvedPath: '/api/v1/user',
                requestUri: 'http://test/api/v1/user',
                status: 200,
                profile: 'AUTH',
                duration: 45,
                payloadSize: 120,
                retries: 1,
                payloadPreview: 'custom-payload-preview',
                responsePreview: 'custom-response-preview',
                error: undefined,
                responseSize: 500,
                responseHeaders: { 'content-type': ['application/json'] },
                requestHeaders: { authorization: 'bearer token' },
                hasHeaderInjection: true,
                analyzerFindings: [{ id: 'f-1', title: 'Finding 1' }],
                identity: 'admin',
                owaspCategory: ['API1:2023'],
                owaspApiCategory: ['BOLA'],
                cweIds: ['CWE-284'],
                triage: 'acknowledged',
            };

            const summary = toSummary(raw);
            expect(summary.id).toBe('res-1');
            expect(summary.payloadPreview).toBe('custom-payload-preview');
            expect(summary.responsePreview).toBe('custom-response-preview');
            expect(summary.hasHeaderInjection).toBe(true);
            expect(summary.analyzerFindings).toHaveLength(1);
            expect(summary.triage).toBe('acknowledged');
        });

        it('applies defaults and generates previews when fields are missing', () => {
            const rawMinimal = {
                id: 'res-minimal',
                timestamp: 123456789,
                method: 'GET',
                endpoint: '/api/v1/status',
                resolvedPath: '/api/v1/status',
                status: 200,
                profile: 'DEFAULT',
                duration: 10,
                payload: { key: 'val' },
                responseBody: 'ok',
            };

            const summary = toSummary(rawMinimal);
            expect(summary.payloadSize).toBe(0);
            expect(summary.retries).toBe(0);
            expect(summary.responseSize).toBe(0);
            expect(summary.responseHeaders).toEqual({});
            expect(summary.requestHeaders).toEqual({});
            expect(summary.hasHeaderInjection).toBe(false);
            expect(summary.analyzerFindings).toEqual([]);
            expect(summary.owaspCategory).toEqual([]);
            expect(summary.owaspApiCategory).toEqual([]);
            expect(summary.cweIds).toEqual([]);
            expect(summary.payloadPreview).toContain('"key": "val"');
            expect(summary.responsePreview).toBe('ok');
        });
    });
});
