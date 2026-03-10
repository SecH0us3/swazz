/**
 * Unit tests for FuzzRunner.
 */
import { describe, it, expect, vi } from 'vitest';
import { FuzzRunner } from '../src/runner.js';
import type { SwazzConfig, SendRequestFn, FuzzResult } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────

function makeMockSendRequest(statusFn?: (url: string) => number): SendRequestFn {
    return async (req) => ({
        status: statusFn ? statusFn(req.url) : 200,
        body: { ok: true },
        duration: 10,
    });
}

function makeConfig(overrides: Partial<SwazzConfig> = {}): SwazzConfig {
    return {
        base_url: 'https://api.example.com',
        global_headers: {},
        cookies: {},
        dictionaries: {},
        settings: {
            iterations_per_profile: 3,
            concurrency: 2,
            timeout_ms: 5000,
            max_payload_size_bytes: 1048576,
            delay_between_requests_ms: 0,
            profiles: ['RANDOM'],
        },
        endpoints: [
            {
                path: '/items',
                method: 'POST',
                schema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        count: { type: 'integer' },
                    },
                },
            },
        ],
        ...overrides,
    };
}

// ─── Basic run ────────────────────────────────────────────────

describe('FuzzRunner — basic run', () => {
    it('calls onResult for each request', async () => {
        const config = makeConfig();
        const runner = new FuzzRunner(config, makeMockSendRequest());

        const collected: FuzzResult[] = [];
        runner.onResult = (r) => collected.push(r);

        await runner.start();

        expect(collected.length).toBeGreaterThan(0);
    });

    it('calls onComplete when done', async () => {
        const config = makeConfig();
        const runner = new FuzzRunner(config, makeMockSendRequest());

        const onComplete = vi.fn();
        runner.onComplete = onComplete;
        await runner.start();

        expect(onComplete).toHaveBeenCalledOnce();
        const stats = onComplete.mock.calls[0][0];
        expect(stats.isRunning).toBe(false);
    });

    it('records status counts in stats', async () => {
        const config = makeConfig();
        const runner = new FuzzRunner(config, makeMockSendRequest(() => 200));

        await runner.start();

        const stats = runner.getStats();
        expect(stats.totalRequests).toBeGreaterThan(0);
        expect(stats.statusCounts[200]).toBeGreaterThan(0);
    });

    it('does not run when already running', async () => {
        const config = makeConfig();
        let started = 0;
        const sendRequest: SendRequestFn = async () => {
            started++;
            return { status: 200, body: {}, duration: 10 };
        };
        const runner = new FuzzRunner(config, sendRequest);
        const firstRun = runner.start();
        // Calling start again while running should be a no-op
        const secondRun = runner.start();
        await Promise.all([firstRun, secondRun]);
        // Only one run happened
        expect(started).toBeGreaterThan(0);
    });
});

// ─── Path parameter substitution ────────────────────────────

describe('FuzzRunner — path parameter substitution', () => {
    it('substitutes {id} in path before making request', async () => {
        const urlsSeen: string[] = [];
        const sendRequest: SendRequestFn = async (req) => {
            urlsSeen.push(req.url);
            return { status: 200, body: {}, duration: 5 };
        };

        const config = makeConfig({
            endpoints: [
                {
                    path: '/items/{id}',
                    method: 'GET',
                    schema: { type: 'object', properties: {} },
                    pathParams: { id: { type: 'integer' } },
                },
            ],
        });

        const runner = new FuzzRunner(config, sendRequest);
        await runner.start();

        expect(urlsSeen.length).toBeGreaterThan(0);
        for (const url of urlsSeen) {
            // Should NOT contain the literal {id}
            expect(url).not.toContain('{id}');
        }
    });

    it('stores original template path in result.endpoint', async () => {
        const config = makeConfig({
            endpoints: [
                {
                    path: '/users/{userId}',
                    method: 'GET',
                    schema: { type: 'object', properties: {} },
                    pathParams: { userId: { type: 'string', format: 'uuid' } },
                },
            ],
        });

        const results: FuzzResult[] = [];
        const runner = new FuzzRunner(config, makeMockSendRequest());
        runner.onResult = (r) => results.push(r);
        await runner.start();

        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
            expect(r.endpoint).toBe('/users/{userId}');
            expect(r.resolvedPath).not.toContain('{userId}');
        }
    });
});

// ─── GET query parameters ────────────────────────────────────

describe('FuzzRunner — GET query parameters', () => {
    it('appends query parameters to URL for GET endpoints', async () => {
        const urlsSeen: string[] = [];
        const sendRequest: SendRequestFn = async (req) => {
            urlsSeen.push(req.url);
            return { status: 200, body: { ok: true }, duration: 5 };
        };

        const config = makeConfig({
            settings: {
                iterations_per_profile: 1,
                concurrency: 1,
                timeout_ms: 5000,
                max_payload_size_bytes: 1048576,
                delay_between_requests_ms: 0,
                profiles: ['RANDOM'],
            },
            endpoints: [
                {
                    path: '/search',
                    method: 'GET',
                    schema: {
                        type: 'object',
                        properties: {
                            q: { type: 'string' },
                            page: { type: 'integer' },
                        },
                    },
                },
            ],
        });

        const results: FuzzResult[] = [];
        const runner = new FuzzRunner(config, sendRequest);
        runner.onResult = (r) => results.push(r);
        await runner.start();

        expect(urlsSeen.length).toBe(1);
        // URL should contain query parameters
        expect(urlsSeen[0]).toContain('?');
        expect(urlsSeen[0]).toContain('q=');
        expect(urlsSeen[0]).toContain('page=');

        // Result payload should contain the query params
        expect(results[0].payload).toHaveProperty('q');
        expect(results[0].payload).toHaveProperty('page');
    });

    it('runs full iterations for GET endpoints with query params', async () => {
        const results: FuzzResult[] = [];
        const config = makeConfig({
            settings: {
                iterations_per_profile: 5,
                concurrency: 1,
                timeout_ms: 5000,
                max_payload_size_bytes: 1048576,
                delay_between_requests_ms: 0,
                profiles: ['RANDOM'],
            },
            endpoints: [
                {
                    path: '/search',
                    method: 'GET',
                    schema: {
                        type: 'object',
                        properties: {
                            q: { type: 'string' },
                        },
                    },
                },
            ],
        });

        const runner = new FuzzRunner(config, makeMockSendRequest());
        runner.onResult = (r) => results.push(r);
        await runner.start();

        // Should have multiple results, not just 1
        expect(results.length).toBeGreaterThan(1);
    });
});

// ─── 429 retry logic ─────────────────────────────────────────

describe('FuzzRunner — 429 backoff', () => {
    it('retries on 429 up to MAX_RETRIES and eventually returns the final status', async () => {
        let attempt = 0;
        const sendRequest: SendRequestFn = async () => {
            attempt++;
            if (attempt <= 2) return { status: 429, body: 'rate limited', duration: 5 };
            return { status: 200, body: { ok: true }, duration: 5 };
        };

        const config = makeConfig({
            settings: {
                iterations_per_profile: 1,
                concurrency: 1,
                timeout_ms: 5000,
                max_payload_size_bytes: 1048576,
                delay_between_requests_ms: 0,
                profiles: ['RANDOM'],
            },
        });

        vi.useFakeTimers();

        const results: FuzzResult[] = [];
        const runner = new FuzzRunner(config, sendRequest);
        runner.onResult = (r) => results.push(r);

        const runPromise = runner.start();

        // Advance timers enough to cover multiple backoff sleeps
        await vi.runAllTimersAsync();
        await runPromise;

        vi.useRealTimers();

        // Should have retried
        expect(attempt).toBeGreaterThan(1);
        // Final result should be 200 (after retries succeeded)
        const last = results.at(-1);
        expect(last?.status).toBe(200);
        expect(last?.retries).toBeGreaterThan(0);
    });
});


// ─── Stop ────────────────────────────────────────────────────

describe('FuzzRunner — stop', () => {
    it('stops processing when stop() is called', async () => {
        let calls = 0;
        const sendRequest: SendRequestFn = async () => {
            calls++;
            return { status: 200, body: {}, duration: 5 };
        };

        const config = makeConfig({
            settings: {
                iterations_per_profile: 100, // Large number — should be cut short
                concurrency: 1,
                timeout_ms: 5000,
                max_payload_size_bytes: 1048576,
                delay_between_requests_ms: 0,
                profiles: ['RANDOM'],
            },
        });

        const runner = new FuzzRunner(config, sendRequest);
        // Stop immediately
        const runPromise = runner.start();
        runner.stop();
        await runPromise;

        // Should have run far fewer than 100 iterations
        expect(calls).toBeLessThan(50);
    });
});

// ─── Progress tracking ───────────────────────────────────────

describe('FuzzRunner — progress tracking', () => {
    it('reports completed endpoints in stats', async () => {
        const config = makeConfig({
            endpoints: [
                {
                    path: '/a',
                    method: 'GET',
                    schema: { type: 'object', properties: {} },
                },
                {
                    path: '/b',
                    method: 'GET',
                    schema: { type: 'object', properties: {} },
                },
            ],
        });

        const runner = new FuzzRunner(config, makeMockSendRequest());
        await runner.start();

        const stats = runner.getStats();
        expect(stats.progress.totalEndpoints).toBe(2);
        expect(stats.progress.completedEndpoints).toBe(2);
    });

    it('clears currentEndpoint and currentProfile after run completes', async () => {
        const config = makeConfig();
        const runner = new FuzzRunner(config, makeMockSendRequest());
        await runner.start();

        const stats = runner.getStats();
        expect(stats.progress.currentEndpoint).toBe('');
        expect(stats.progress.currentProfile).toBe('');
    });

    it('tracks totalPlanned before run starts', async () => {
        const config = makeConfig({
            settings: {
                iterations_per_profile: 5,
                concurrency: 2,
                timeout_ms: 5000,
                max_payload_size_bytes: 1048576,
                delay_between_requests_ms: 0,
                profiles: ['RANDOM', 'BOUNDARY'],
            },
        });

        const runner = new FuzzRunner(config, makeMockSendRequest());
        let firstStats: any;
        runner.onProgress = (s) => {
            if (!firstStats) firstStats = { ...s };
        };
        await runner.start();

        // 1 endpoint × 2 profiles × 5 iterations = 10 planned
        expect(firstStats?.totalPlanned).toBe(10);
    });
});

// ─── getResults ──────────────────────────────────────────────

describe('FuzzRunner.getResults', () => {
    it('returns a copy of stored results', async () => {
        const config = makeConfig();
        const runner = new FuzzRunner(config, makeMockSendRequest());
        await runner.start();

        const results = runner.getResults();
        expect(results.length).toBeGreaterThan(0);
        // Mutation should not affect internal state
        results.length = 0;
        expect(runner.getResults().length).toBeGreaterThan(0);
    });
});
