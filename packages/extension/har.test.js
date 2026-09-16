import { describe, it, expect } from 'vitest';
import SwazzHar from './har.js';

describe('SwazzHar module', () => {
    describe('normalizePath', () => {
        it('collapses /users/1 and /users/2 to the same key', () => {
            const path1 = SwazzHar.normalizePath('/users/1');
            const path2 = SwazzHar.normalizePath('/users/2');
            expect(path1).toBe('/users/{id}');
            expect(path2).toBe('/users/{id}');
            expect(path1).toBe(path2);
        });

        it('normalizes UUID path segments', () => {
            const uuidPath = SwazzHar.normalizePath('/api/orders/550e8400-e29b-41d4-a716-446655440000/items');
            expect(uuidPath).toBe('/api/orders/{uuid}/items');
        });

        it('normalizes ULID path segments', () => {
            const ulidPath = SwazzHar.normalizePath('/api/records/01ARZ3N01ARZ3N01ARZ3N01ARZ');
            expect(ulidPath).toBe('/api/records/{ulid}');
        });

        it('handles static paths without numeric/ID segments', () => {
            expect(SwazzHar.normalizePath('/api/v1/auth/login')).toBe('/api/v1/auth/login');
            expect(SwazzHar.normalizePath('')).toBe('/');
        });
    });

    describe('buildHarPayload -> parseHarIntoRequests round-trip', () => {
        it('survives round-trip with methods, paths, query variations, body variations, and counts', () => {
            const sampleRequestsMap = {
                'GET:/api/users/{id}': {
                    key: 'GET:/api/users/{id}',
                    method: 'GET',
                    path: '/api/users/{id}',
                    exampleUrl: 'https://api.example.com/api/users/123?sort=asc',
                    headers: {
                        'accept': 'application/json',
                        'authorization': 'Bearer token-xyz'
                    },
                    count: 7,
                    lastCaptured: 1710000000000,
                    queryKeys: ['sort', 'limit'],
                    queryVariations: ['?sort=asc', '?sort=desc&limit=10'],
                    bodyVariations: [],
                    statuses: { '200': 6, '404': 1 },
                    lastResponse: {
                        status: 200,
                        statusText: 'OK',
                        headers: { 'content-type': 'application/json' },
                        bodySample: '{"id":123,"name":"Alice"}'
                    },
                    recommendation: '✅ Excellent coverage! Multiple dynamic parameter variations recorded (2 total).',
                    status: 'well_covered'
                },
                'POST:/api/products': {
                    key: 'POST:/api/products',
                    method: 'POST',
                    path: '/api/products',
                    exampleUrl: 'https://api.example.com/api/products',
                    headers: {
                        'content-type': 'application/json'
                    },
                    count: 3,
                    lastCaptured: 1710000010000,
                    queryKeys: [],
                    queryVariations: [],
                    bodyVariations: [
                        '{"name":"Widget","price":9.99}',
                        '{"name":"Gadget","price":19.99}'
                    ],
                    statuses: { '201': 3 },
                    lastResponse: {
                        status: 201,
                        statusText: 'Created',
                        headers: { 'content-type': 'application/json' },
                        bodySample: '{"id":456,"name":"Widget"}'
                    },
                    recommendation: '✅ Excellent coverage! Multiple dynamic parameter variations recorded (2 total).',
                    status: 'well_covered'
                },
                'PUT:/api/items/{id}': {
                    key: 'PUT:/api/items/{id}',
                    method: 'PUT',
                    path: '/api/items/{id}',
                    exampleUrl: 'https://api.example.com/api/items/99?notify=true',
                    headers: {
                        'content-type': 'application/json'
                    },
                    count: 5,
                    lastCaptured: 1710000020000,
                    queryKeys: ['notify'],
                    queryVariations: ['?notify=true', '?notify=false'],
                    bodyVariations: [
                        '{"active":true}',
                        '{"active":false}'
                    ],
                    statuses: { '200': 5 },
                    lastResponse: {
                        status: 200,
                        statusText: 'OK',
                        headers: { 'content-type': 'application/json' },
                        bodySample: '{"success":true}'
                    },
                    recommendation: '✅ Excellent coverage! Multiple dynamic parameter variations recorded (4 total).',
                    status: 'well_covered'
                }
            };

            const harPayload = SwazzHar.buildHarPayload(sampleRequestsMap);
            expect(harPayload).toBeDefined();
            expect(harPayload.log).toBeDefined();
            expect(harPayload.log.version).toBe('1.2');

            // Fan out:
            // GET: 2 queries * 1 body = 2
            // POST: 1 query * 2 bodies = 2
            // PUT: 2 queries * 2 bodies = 4
            // Total = 8 entries
            expect(harPayload.log.entries).toHaveLength(8);

            const parsed = SwazzHar.parseHarIntoRequests(harPayload);
            expect(parsed).toBeDefined();

            // Assert methods survive
            expect(parsed['GET:/api/users/{id}']).toBeDefined();
            expect(parsed['GET:/api/users/{id}'].method).toBe('GET');
            expect(parsed['POST:/api/products']).toBeDefined();
            expect(parsed['POST:/api/products'].method).toBe('POST');
            expect(parsed['PUT:/api/items/{id}']).toBeDefined();
            expect(parsed['PUT:/api/items/{id}'].method).toBe('PUT');

            // Assert normalized paths survive
            expect(parsed['GET:/api/users/{id}'].path).toBe('/api/users/{id}');
            expect(parsed['POST:/api/products'].path).toBe('/api/products');
            expect(parsed['PUT:/api/items/{id}'].path).toBe('/api/items/{id}');

            // Assert query variations survive
            const parsedGet = parsed['GET:/api/users/{id}'];
            expect(parsedGet.queryVariations).toHaveLength(2);
            expect(parsedGet.queryVariations).toContain('?sort=asc');
            expect(parsedGet.queryVariations).toContain('?sort=desc&limit=10');

            // Assert query keys survive
            expect(parsedGet.queryKeys).toContain('sort');
            expect(parsedGet.queryKeys).toContain('limit');

            // Assert body variations survive
            const parsedPost = parsed['POST:/api/products'];
            expect(parsedPost.bodyVariations).toHaveLength(2);
            expect(parsedPost.bodyVariations).toContain('{"name":"Widget","price":9.99}');
            expect(parsedPost.bodyVariations).toContain('{"name":"Gadget","price":19.99}');

            const parsedPut = parsed['PUT:/api/items/{id}'];
            expect(parsedPut.queryVariations).toHaveLength(2);
            expect(parsedPut.bodyVariations).toHaveLength(2);

            // Assert response data survives
            expect(parsedGet.statuses['200']).toBe(2);
            expect(parsedGet.lastResponse).toBeDefined();
            expect(parsedGet.lastResponse.status).toBe(200);
            expect(parsedGet.lastResponse.bodySample).toBe('{"id":123,"name":"Alice"}');
        });

        it('fan-out produces correct number of entries across query x body variations', () => {
            const requests = {
                'POST:/api/fanout': {
                    key: 'POST:/api/fanout',
                    method: 'POST',
                    path: '/api/fanout',
                    exampleUrl: 'https://example.com/api/fanout',
                    headers: {},
                    count: 1,
                    lastCaptured: Date.now(),
                    queryKeys: ['q'],
                    queryVariations: ['?q=1', '?q=2'],
                    bodyVariations: ['{"b":1}', '{"b":2}', '{"b":3}'],
                    statuses: {}
                }
            };
            const har = SwazzHar.buildHarPayload(requests);
            // 2 queries * 3 bodies = 6 entries
            expect(har.log.entries).toHaveLength(6);
        });

        it('skips malformed exampleUrl without throwing', () => {
            const requests = {
                'GET:/invalid': {
                    key: 'GET:/invalid',
                    method: 'GET',
                    path: '/invalid',
                    exampleUrl: 'not a valid url :: // %%',
                    headers: {},
                    count: 1,
                    lastCaptured: Date.now(),
                    queryKeys: [],
                    queryVariations: [],
                    bodyVariations: [],
                    statuses: {}
                },
                'GET:/valid': {
                    key: 'GET:/valid',
                    method: 'GET',
                    path: '/valid',
                    exampleUrl: 'https://example.com/valid',
                    headers: {},
                    count: 1,
                    lastCaptured: Date.now(),
                    queryKeys: [],
                    queryVariations: [],
                    bodyVariations: [],
                    statuses: {}
                }
            };
            let har;
            expect(() => {
                har = SwazzHar.buildHarPayload(requests);
            }).not.toThrow();
            expect(har.log.entries).toHaveLength(1);
            expect(har.log.entries[0].request.url).toBe('https://example.com/valid');
        });
    });

    describe('parseHarIntoRequests error handling', () => {
        it('rejects input with no log.entries array', () => {
            expect(() => SwazzHar.parseHarIntoRequests({})).toThrow(/missing log\.entries/);
            expect(() => SwazzHar.parseHarIntoRequests({ log: {} })).toThrow(/missing log\.entries/);
            expect(() => SwazzHar.parseHarIntoRequests({ log: { entries: 'not an array' } })).toThrow(/missing log\.entries/);
            expect(() => SwazzHar.parseHarIntoRequests('not json')).toThrow(/Invalid JSON/);
        });
    });

    describe('mergeCapturedRequests', () => {
        it('unions variations and sums counts instead of replacing', () => {
            const existing = {
                'GET:/api/test': {
                    key: 'GET:/api/test',
                    method: 'GET',
                    path: '/api/test',
                    exampleUrl: 'https://api.example.com/api/test?a=1',
                    headers: { 'x-old': 'old' },
                    count: 4,
                    lastCaptured: 1000,
                    queryKeys: ['a'],
                    queryVariations: ['?a=1'],
                    bodyVariations: ['body-1'],
                    statuses: { '200': 4 }
                }
            };

            const incoming = {
                'GET:/api/test': {
                    key: 'GET:/api/test',
                    method: 'GET',
                    path: '/api/test',
                    exampleUrl: 'https://api.example.com/api/test?a=2',
                    headers: { 'x-new': 'new' },
                    count: 6,
                    lastCaptured: 2500,
                    queryKeys: ['a', 'b'],
                    queryVariations: ['?a=2'],
                    bodyVariations: ['body-2'],
                    statuses: { '200': 5, '500': 1 }
                },
                'POST:/api/other': {
                    key: 'POST:/api/other',
                    method: 'POST',
                    path: '/api/other',
                    exampleUrl: 'https://api.example.com/api/other',
                    headers: {},
                    count: 2,
                    lastCaptured: 2000,
                    queryKeys: [],
                    queryVariations: [],
                    bodyVariations: [],
                    statuses: { '201': 2 }
                }
            };

            const merged = SwazzHar.mergeCapturedRequests(existing, incoming);

            // Counts summed: 4 + 6 = 10
            expect(merged['GET:/api/test'].count).toBe(10);
            expect(merged['GET:/api/test'].lastCaptured).toBe(2500);

            // Query keys unioned
            expect(merged['GET:/api/test'].queryKeys).toEqual(['a', 'b']);

            // Query variations unioned
            expect(merged['GET:/api/test'].queryVariations).toHaveLength(2);
            expect(merged['GET:/api/test'].queryVariations).toContain('?a=1');
            expect(merged['GET:/api/test'].queryVariations).toContain('?a=2');

            // Body variations unioned
            expect(merged['GET:/api/test'].bodyVariations).toHaveLength(2);
            expect(merged['GET:/api/test'].bodyVariations).toContain('body-1');
            expect(merged['GET:/api/test'].bodyVariations).toContain('body-2');

            // Statuses summed
            expect(merged['GET:/api/test'].statuses['200']).toBe(9); // 4 + 5
            expect(merged['GET:/api/test'].statuses['500']).toBe(1);

            // New endpoint merged in
            expect(merged['POST:/api/other']).toBeDefined();
            expect(merged['POST:/api/other'].count).toBe(2);
        });
    });
});
