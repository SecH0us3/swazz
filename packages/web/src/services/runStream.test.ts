// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, afterEach } from 'vitest';
import { interpretRunMessage, fetchScanStatus, UNKNOWN_FAILURE } from './runStream.js';

describe('interpretRunMessage', () => {
    it('classifies the stream events', () => {
        expect(interpretRunMessage({ type: 'queued' })).toEqual({ kind: 'queued' });
        expect(interpretRunMessage({ type: 'result', data: { id: 1 } })).toEqual({ kind: 'result', data: { id: 1 } });
        expect(interpretRunMessage({ type: 'progress', data: { totalRequests: 2 } })).toEqual({ kind: 'progress', stats: { totalRequests: 2 } });
        expect(interpretRunMessage({ type: 'complete', data: { totalRequests: 3 } })).toEqual({ kind: 'complete', stats: { totalRequests: 3 } });
    });

    // Every shape an error arrives in must end the scan: ignoring one left it "running" forever.
    it('recognizes errors in every shape, with a message for the user', () => {
        expect(interpretRunMessage({ type: 'error', data: { message: 'MCP 401' } })).toEqual({ kind: 'error', message: 'MCP 401' });
        expect(interpretRunMessage({ type: 'error', data: 'plain' })).toEqual({ kind: 'error', message: 'plain' });
        expect(interpretRunMessage({ type: 'error', data: { totalRequests: 0 } })).toEqual({ kind: 'error', message: UNKNOWN_FAILURE });
        expect(interpretRunMessage({ type: 'error' })).toEqual({ kind: 'error', message: UNKNOWN_FAILURE });
        // A coordinator that predates typed errors forwards the runner's payload as is.
        expect(interpretRunMessage({ error: 'legacy shape' })).toEqual({ kind: 'error', message: 'legacy shape' });
        expect(interpretRunMessage({ error: { nested: true } })).toEqual({ kind: 'error', message: UNKNOWN_FAILURE });
    });

    it('bounds and flattens error text', () => {
        const event = interpretRunMessage({ type: 'error', data: { message: `a\nb\u0000c ${'x'.repeat(2000)}` } });
        expect(event.kind).toBe('error');
        const message = (event as any).message as string;
        expect(message.startsWith('a b c')).toBe(true);
        expect(message.length).toBe(500);
    });

    it('reads runner log lines with a normalized level', () => {
        expect(interpretRunMessage({ type: 'runner_log', data: { level: 'WARN', message: 'w' } })).toEqual({ kind: 'log', level: 'warning', message: 'w' });
        expect(interpretRunMessage({ type: 'runner_log', data: { level: 'ERROR', message: 'e' } })).toEqual({ kind: 'log', level: 'error', message: 'e' });
        expect(interpretRunMessage({ type: 'runner_log', data: { level: 'info', message: 'i' } })).toEqual({ kind: 'log', level: 'info', message: 'i' });
        expect(interpretRunMessage({ type: 'runner_log', data: { level: 'warn' } })).toEqual({ kind: 'ignored' });
    });

    it('ignores what it does not know', () => {
        for (const msg of [null, 5, 'x', {}, { type: 'checkpoint' }, { type: 'pong' }]) {
            expect(interpretRunMessage(msg)).toEqual({ kind: 'ignored' });
        }
    });
});

describe('fetchScanStatus', () => {
    afterEach(() => vi.unstubAllGlobals());

    const respond = (status: number, body: unknown) =>
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }));

    it('maps the scan status', async () => {
        respond(200, { scan: { status: 'dispatched' } });
        expect(await fetchScanStatus('r1')).toEqual({ state: 'active' });
        respond(200, { scan: { status: 'paused' } });
        expect(await fetchScanStatus('r1')).toEqual({ state: 'active' });
        respond(200, { scan: { status: 'completed' } });
        expect(await fetchScanStatus('r1')).toEqual({ state: 'completed' });
        respond(200, { scan: { status: 'failed', failure_reason: 'Runner lost' } });
        expect(await fetchScanStatus('r1')).toEqual({ state: 'failed', reason: 'Runner lost' });
        respond(200, { scan: { status: 'failed', failure_reason: null } });
        expect(await fetchScanStatus('r1')).toEqual({ state: 'failed', reason: UNKNOWN_FAILURE });
    });

    // Not knowing is not failing: the dashboard keeps waiting instead of guessing.
    it('says unknown when it cannot tell', async () => {
        respond(403, { error: 'Forbidden' });
        expect(await fetchScanStatus('r1')).toEqual({ state: 'unknown' });
        respond(200, { scan: { status: 'weird' } });
        expect(await fetchScanStatus('r1')).toEqual({ state: 'unknown' });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        expect(await fetchScanStatus('r1')).toEqual({ state: 'unknown' });
    });

    it('asks for the scan by its id, escaped', async () => {
        respond(200, { scan: { status: 'completed' } });
        await fetchScanStatus('a/b', 'https://edge');
        expect((globalThis.fetch as any).mock.calls[0][0]).toBe('https://edge/api/scans/a%2Fb');
    });
});
