/**
 * Tests for Swazz Extension HAR builder, parser, and path normalizer.
 * Run with: node packages/extension/test/har.test.js
 */

const assert = require('assert');
const path = require('path');
const SwazzHar = require('../har.js');

console.log('🧪 Running Swazz HAR module tests...\n');

// 1. Test normalizePath
console.log('-> Testing normalizePath...');
assert.strictEqual(SwazzHar.normalizePath('/api/v1/users/123'), '/api/v1/users/{id}');
assert.strictEqual(
    SwazzHar.normalizePath('/api/orders/550e8400-e29b-41d4-a716-446655440000/items'),
    '/api/orders/{uuid}/items'
);
assert.strictEqual(
    SwazzHar.normalizePath('/api/records/01ARZ3N01ARZ3N01ARZ3N01ARZ'),
    '/api/records/{ulid}'
);
assert.strictEqual(SwazzHar.normalizePath('/static/path/only'), '/static/path/only');
console.log('   ✅ normalizePath tests passed.');

// 2. Test round-trip: buildHarPayload -> parseHarIntoRequests
console.log('-> Testing buildHarPayload -> parseHarIntoRequests round-trip...');

const sampleRequestsMap = {
    'GET:/api/users/{id}': {
        key: 'GET:/api/users/{id}',
        method: 'GET',
        path: '/api/users/{id}',
        exampleUrl: 'https://api.example.com/api/users/123?sort=asc',
        headers: {
            'accept': 'application/json',
            'authorization': 'Bearer test-token'
        },
        count: 5,
        lastCaptured: 1700000000000,
        queryKeys: ['sort', 'limit'],
        queryVariations: ['?sort=asc', '?sort=desc&limit=10'],
        bodyVariations: [],
        statuses: { '200': 4, '404': 1 },
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
        count: 2,
        lastCaptured: 1700000010000,
        queryKeys: [],
        queryVariations: [],
        bodyVariations: [
            '{"name":"Widget","price":9.99}',
            '{"name":"Gadget","price":19.99}'
        ],
        statuses: { '201': 2 },
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
        count: 4,
        lastCaptured: 1700000020000,
        queryKeys: ['notify'],
        queryVariations: ['?notify=true', '?notify=false'],
        bodyVariations: [
            '{"active":true}',
            '{"active":false}'
        ],
        statuses: { '200': 4 },
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

// Build HAR payload
const harPayload = SwazzHar.buildHarPayload(sampleRequestsMap);

assert(harPayload && harPayload.log, 'HAR payload must contain log object');
assert.strictEqual(harPayload.log.version, '1.2');
assert(Array.isArray(harPayload.log.entries), 'log.entries must be an array');

// Check entry expansions:
// GET: 2 query variations × 1 body ("") = 2 entries
// POST: 1 query ("") × 2 body variations = 2 entries
// PUT: 2 query variations × 2 body variations = 4 entries
// Total expected entries = 2 + 2 + 4 = 8
assert.strictEqual(harPayload.log.entries.length, 8, 'Expected 8 expanded HAR entries');

// Verify response fields in entries
const getEntry = harPayload.log.entries.find(e => e.request.method === 'GET');
assert(getEntry, 'Must have GET entry');
assert.strictEqual(getEntry.response.status, 200);
assert.strictEqual(getEntry.response.statusText, 'OK');
assert.strictEqual(getEntry.response.content.text, '{"id":123,"name":"Alice"}');

// Now parse HAR back into requests map
const parsedMap = SwazzHar.parseHarIntoRequests(harPayload);

assert(parsedMap, 'parseHarIntoRequests must return a map');

// Assert methods survive
assert(parsedMap['GET:/api/users/{id}'], 'GET:/api/users/{id} must survive');
assert.strictEqual(parsedMap['GET:/api/users/{id}'].method, 'GET');

assert(parsedMap['POST:/api/products'], 'POST:/api/products must survive');
assert.strictEqual(parsedMap['POST:/api/products'].method, 'POST');

assert(parsedMap['PUT:/api/items/{id}'], 'PUT:/api/items/{id} must survive');
assert.strictEqual(parsedMap['PUT:/api/items/{id}'].method, 'PUT');

// Assert normalized paths survive
assert.strictEqual(parsedMap['GET:/api/users/{id}'].path, '/api/users/{id}');
assert.strictEqual(parsedMap['POST:/api/products'].path, '/api/products');
assert.strictEqual(parsedMap['PUT:/api/items/{id}'].path, '/api/items/{id}');

// Assert query variations survive
const parsedGet = parsedMap['GET:/api/users/{id}'];
assert.strictEqual(parsedGet.queryVariations.length, 2, 'GET must have 2 query variations');
assert(parsedGet.queryVariations.includes('?sort=asc'), 'Must include ?sort=asc');
assert(parsedGet.queryVariations.includes('?sort=desc&limit=10'), 'Must include ?sort=desc&limit=10');

// Assert query keys survive
assert(parsedGet.queryKeys.includes('sort'), 'Must include sort query key');
assert(parsedGet.queryKeys.includes('limit'), 'Must include limit query key');

// Assert body variations survive
const parsedPost = parsedMap['POST:/api/products'];
assert.strictEqual(parsedPost.bodyVariations.length, 2, 'POST must have 2 body variations');
assert(parsedPost.bodyVariations.includes('{"name":"Widget","price":9.99}'));
assert(parsedPost.bodyVariations.includes('{"name":"Gadget","price":19.99}'));

const parsedPut = parsedMap['PUT:/api/items/{id}'];
assert.strictEqual(parsedPut.queryVariations.length, 2, 'PUT must have 2 query variations');
assert.strictEqual(parsedPut.bodyVariations.length, 2, 'PUT must have 2 body variations');

// Assert response data survives
assert.strictEqual(parsedGet.statuses['200'], 2); // 2 entries with 200
assert(parsedGet.lastResponse, 'lastResponse must exist');
assert.strictEqual(parsedGet.lastResponse.status, 200);
assert.strictEqual(parsedGet.lastResponse.bodySample, '{"id":123,"name":"Alice"}');

console.log('   ✅ Round-trip tests passed.');

// 3. Test invalid HAR rejection
console.log('-> Testing invalid HAR handling...');
assert.throws(() => {
    SwazzHar.parseHarIntoRequests('not valid json');
}, /Invalid JSON/);

assert.throws(() => {
    SwazzHar.parseHarIntoRequests({});
}, /missing log.entries/);

assert.throws(() => {
    SwazzHar.parseHarIntoRequests({ log: {} });
}, /missing log.entries/);
console.log('   ✅ Invalid HAR rejection tests passed.');

// 4. Test mergeCapturedRequests
console.log('-> Testing mergeCapturedRequests...');
const existingMap = {
    'GET:/api/test': {
        key: 'GET:/api/test',
        method: 'GET',
        path: '/api/test',
        exampleUrl: 'https://api.example.com/api/test?v=1',
        headers: { 'x-old': '1' },
        count: 3,
        lastCaptured: 1000,
        queryKeys: ['v'],
        queryVariations: ['?v=1'],
        bodyVariations: [],
        statuses: { '200': 3 }
    }
};

const incomingMap = {
    'GET:/api/test': {
        key: 'GET:/api/test',
        method: 'GET',
        path: '/api/test',
        exampleUrl: 'https://api.example.com/api/test?v=2',
        headers: { 'x-new': '2' },
        count: 5,
        lastCaptured: 2000,
        queryKeys: ['v', 'w'],
        queryVariations: ['?v=2'],
        bodyVariations: [],
        statuses: { '200': 4, '500': 1 }
    },
    'DELETE:/api/test': {
        key: 'DELETE:/api/test',
        method: 'DELETE',
        path: '/api/test',
        exampleUrl: 'https://api.example.com/api/test',
        headers: {},
        count: 1,
        lastCaptured: 1500,
        queryKeys: [],
        queryVariations: [],
        bodyVariations: [],
        statuses: { '204': 1 }
    }
};

const merged = SwazzHar.mergeCapturedRequests(existingMap, incomingMap);

assert.strictEqual(merged['GET:/api/test'].count, 8, 'Counts must be summed (3 + 5 = 8)');
assert.strictEqual(merged['GET:/api/test'].lastCaptured, 2000, 'lastCaptured must be max');
assert.strictEqual(merged['GET:/api/test'].queryVariations.length, 2, 'queryVariations must be unioned');
assert(merged['GET:/api/test'].queryKeys.includes('w'), 'queryKeys must include w');
assert.strictEqual(merged['GET:/api/test'].statuses['200'], 7, '200 statuses must be summed (3 + 4 = 7)');
assert.strictEqual(merged['GET:/api/test'].statuses['500'], 1);
assert(merged['DELETE:/api/test'], 'New endpoint must be added');
assert.strictEqual(merged['DELETE:/api/test'].count, 1);
console.log('   ✅ mergeCapturedRequests tests passed.');

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!\n');
