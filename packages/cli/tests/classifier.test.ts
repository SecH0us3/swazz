import { describe, it, expect } from 'vitest';
import { Classifier } from '../src/classifier.js';
import type { FuzzResult } from '@swazz/core';

function makeResult(overrides: Partial<FuzzResult> = {}): FuzzResult {
    return {
        id: 'test-1',
        endpoint: '/api/users',
        resolvedPath: '/api/users',
        method: 'POST',
        profile: 'MALICIOUS',
        status: 500,
        duration: 100,
        payload: { name: 'test' },
        timestamp: Date.now(),
        retries: 0,
        ...overrides,
    };
}

describe('Classifier', () => {
    describe('default rules', () => {
        const c = new Classifier();

        it('classifies 500 as error', () => {
            const f = c.classify(makeResult({ status: 500 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
            expect(f!.ruleId).toBe('swazz/status-500');
        });

        it('classifies 502 as error', () => {
            const f = c.classify(makeResult({ status: 502 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
        });

        it('ignores 200 by default (2xx → ignore)', () => {
            expect(c.classify(makeResult({ status: 200 }))).toBeNull();
        });

        it('ignores 204 by default (2xx → ignore)', () => {
            expect(c.classify(makeResult({ status: 204 }))).toBeNull();
        });

        it('ignores 301 by default (3xx → ignore)', () => {
            expect(c.classify(makeResult({ status: 301 }))).toBeNull();
        });

        it('ignores 401 (in default ignore list)', () => {
            expect(c.classify(makeResult({ status: 401 }))).toBeNull();
        });

        it('ignores 403 (in default ignore list)', () => {
            expect(c.classify(makeResult({ status: 403 }))).toBeNull();
        });

        it('ignores 404 (in default ignore list)', () => {
            expect(c.classify(makeResult({ status: 404 }))).toBeNull();
        });

        it('ignores 429 (in default ignore list)', () => {
            expect(c.classify(makeResult({ status: 429 }))).toBeNull();
        });

        it('classifies 400 as error (4xx default, not in ignore)', () => {
            const f = c.classify(makeResult({ status: 400 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
        });

        it('classifies timeout (status 0) as error', () => {
            const f = c.classify(makeResult({ status: 0, error: 'Request timed out after 10000ms' }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
            expect(f!.ruleId).toBe('swazz/timeout');
        });

        it('classifies network error (status 0, no timeout) as error', () => {
            const f = c.classify(makeResult({ status: 0, error: 'ECONNREFUSED' }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
            expect(f!.ruleId).toBe('swazz/network-error');
        });
    });

    describe('custom rules', () => {
        it('treats 200 as warning when configured', () => {
            const c = new Classifier({
                ignore: [401, 403, 404, 429, 520],
                severity: { '200': 'warning' },
                defaults: { '1xx': 'ignore', '2xx': 'ignore', '3xx': 'ignore', '4xx': 'error', '5xx': 'error', 'timeout': 'error', 'network_error': 'error' },
            });

            const f = c.classify(makeResult({ status: 200 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('warning');
            expect(f!.ruleId).toBe('swazz/status-200');
        });

        it('ignores 520 when in ignore list', () => {
            const c = new Classifier({
                ignore: [520],
            });

            expect(c.classify(makeResult({ status: 520 }))).toBeNull();
        });

        it('treats 400 as warning when configured', () => {
            const c = new Classifier({
                severity: { '400': 'warning', '406': 'warning' },
            });

            const f = c.classify(makeResult({ status: 400 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('warning');
        });

        it('treats 406 as warning when configured', () => {
            const c = new Classifier({
                severity: { '406': 'warning' },
            });

            const f = c.classify(makeResult({ status: 406 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('warning');
        });

        it('ignore takes priority over severity for same status', () => {
            const c = new Classifier({
                ignore: [500],
                severity: { '500': 'error' },
            });

            expect(c.classify(makeResult({ status: 500 }))).toBeNull();
        });

        it('unknown status falls back to defaults by range', () => {
            const c = new Classifier({
                defaults: { '4xx': 'note' },
            });

            const f = c.classify(makeResult({ status: 418 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('note');
        });

        it('unknown status with no matching range defaults to error', () => {
            const c = new Classifier({
                ignore: [],
                severity: {},
                defaults: {},
            });

            const f = c.classify(makeResult({ status: 999 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
        });
    });

    describe('edge cases / boundary values', () => {
        it('status 0 with empty error string → network-error', () => {
            const c = new Classifier();
            const f = c.classify(makeResult({ status: 0, error: '' }));
            expect(f).not.toBeNull();
            expect(f!.ruleId).toBe('swazz/network-error');
        });

        it('status 0 with undefined error → network-error', () => {
            const c = new Classifier();
            const f = c.classify(makeResult({ status: 0, error: undefined }));
            expect(f).not.toBeNull();
            expect(f!.ruleId).toBe('swazz/network-error');
        });

        it('status 100 (1xx range) ignored by default', () => {
            const c = new Classifier();
            expect(c.classify(makeResult({ status: 100 }))).toBeNull();
        });

        it('status 199 (1xx boundary) ignored by default', () => {
            const c = new Classifier();
            expect(c.classify(makeResult({ status: 199 }))).toBeNull();
        });

        it('status 599 (5xx boundary) classified as error', () => {
            const c = new Classifier();
            const f = c.classify(makeResult({ status: 599 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
            expect(f!.ruleId).toBe('swazz/status-599');
        });

        it('status 999 with no defaults → fallback error', () => {
            const c = new Classifier({ ignore: [], severity: {}, defaults: {} });
            const f = c.classify(makeResult({ status: 999 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
        });

        it('empty rules config still uses default ignore list', () => {
            const c = new Classifier({});
            // {} means ignore/severity/defaults all undefined → fallback to hardcoded defaults
            expect(c.classify(makeResult({ status: 401 }))).toBeNull(); // in DEFAULT_IGNORE
            const f = c.classify(makeResult({ status: 500 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('error');
        });

        it('undefined rules config uses hardcoded defaults', () => {
            const c = new Classifier(undefined);
            // 401 is in DEFAULT_IGNORE
            expect(c.classify(makeResult({ status: 401 }))).toBeNull();
            // 500 is 5xx → error
            const f = c.classify(makeResult({ status: 500 }));
            expect(f!.level).toBe('error');
        });

        it('severity "note" level is preserved', () => {
            const c = new Classifier({ severity: { '418': 'note' } });
            const f = c.classify(makeResult({ status: 418 }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('note');
        });

        it('defaults can override range to ignore', () => {
            const c = new Classifier({
                ignore: [],
                defaults: { '5xx': 'ignore' },
            });
            expect(c.classify(makeResult({ status: 500 }))).toBeNull();
        });

        it('timeout default can be set to warning', () => {
            const c = new Classifier({
                defaults: { 'timeout': 'warning' },
            });
            const f = c.classify(makeResult({ status: 0, error: 'Request timed out after 10000ms' }));
            expect(f).not.toBeNull();
            expect(f!.level).toBe('warning');
        });

        it('network_error default can be set to ignore', () => {
            const c = new Classifier({
                defaults: { 'network_error': 'ignore' },
            });
            expect(c.classify(makeResult({ status: 0, error: 'ECONNREFUSED' }))).toBeNull();
        });

        it('all three profiles produce correct findings', () => {
            const c = new Classifier({ defaults: { '5xx': 'error' } });
            for (const profile of ['RANDOM', 'BOUNDARY', 'MALICIOUS'] as const) {
                const f = c.classify(makeResult({ profile, status: 500 }));
                expect(f).not.toBeNull();
                expect(f!.profile).toBe(profile);
            }
        });
    });

    describe('finding structure', () => {
        it('preserves all fields from FuzzResult', () => {
            const c = new Classifier({ defaults: { '5xx': 'error' } });
            const result = makeResult({
                id: 'abc-123',
                endpoint: '/api/items/{id}',
                resolvedPath: '/api/items/xyz',
                method: 'DELETE',
                profile: 'BOUNDARY',
                status: 503,
                duration: 5000,
                payload: { big: 'data' },
                responseBody: 'Service Unavailable',
                timestamp: 1700000000000,
            });

            const f = c.classify(result)!;
            expect(f.id).toBe('abc-123');
            expect(f.endpoint).toBe('/api/items/{id}');
            expect(f.resolvedPath).toBe('/api/items/xyz');
            expect(f.method).toBe('DELETE');
            expect(f.profile).toBe('BOUNDARY');
            expect(f.status).toBe(503);
            expect(f.duration).toBe(5000);
            expect(f.payload).toEqual({ big: 'data' });
            expect(f.responseBody).toBe('Service Unavailable');
            expect(f.ruleId).toBe('swazz/status-503');
            expect(f.level).toBe('error');
        });

        it('preserves error field for timeouts', () => {
            const c = new Classifier();
            const f = c.classify(makeResult({
                status: 0,
                error: 'Request timed out after 5000ms',
                duration: 0,
            }))!;
            expect(f.error).toBe('Request timed out after 5000ms');
            expect(f.duration).toBe(0);
        });

        it('handles null/undefined responseBody', () => {
            const c = new Classifier({ defaults: { '5xx': 'error' } });
            const f = c.classify(makeResult({ status: 500, responseBody: undefined }))!;
            expect(f.responseBody).toBeUndefined();
        });

        it('handles complex nested payload', () => {
            const c = new Classifier({ defaults: { '5xx': 'error' } });
            const payload = { a: { b: { c: [1, 2, { d: 'deep' }] } } };
            const f = c.classify(makeResult({ status: 500, payload }))!;
            expect(f.payload).toEqual(payload);
        });
    });
});
