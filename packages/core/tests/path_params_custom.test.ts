import { describe, it, expect } from 'vitest';
import { FuzzRunner } from '../src/runner.js';
import type { SwazzConfig, SendRequestFn } from '../src/types.js';

function makeMockSendRequest(onCall?: (req: any) => void): SendRequestFn {
    return async (req) => {
        if (onCall) onCall(req);
        return {
            status: 200,
            body: { ok: true },
            duration: 10,
        };
    };
}

describe('Path Parameter Substitution — Custom dictionary and heuristics', () => {
    it('uses dictionary for path parameters even without explicit pathParams schema', async () => {
        const urlsSeen: string[] = [];
        const sendRequest = makeMockSendRequest((req) => urlsSeen.push(req.url));

        const config: SwazzConfig = {
            base_url: 'https://api.example.com',
            global_headers: {},
            cookies: {},
            dictionaries: {
                'user_id': ['user-123', 'user-456']
            },
            settings: {
                iterations_per_profile: 5,
                concurrency: 1,
                timeout_ms: 1000,
                max_payload_size_bytes: 1000,
                delay_between_requests_ms: 0,
                profiles: ['RANDOM'],
            },
            endpoints: [
                {
                    path: '/users/{user_id}',
                    method: 'GET',
                    schema: { type: 'object', properties: {} },
                    // pathParams is OMITTED
                },
            ],
        };

        const runner = new FuzzRunner(config, sendRequest);
        await runner.start();

        expect(urlsSeen.length).toBeGreaterThan(0);
        for (const url of urlsSeen) {
            // It should be one of our dictionary values
            const match = url.match(/\/users\/(.+)$/);
            expect(match).not.toBeNull();
            const val = match![1];
            expect(['user-123', 'user-456']).toContain(val);
        }
    });

    it('falls back to name-based heuristics for unknown path parameters', async () => {
        const urlsSeen: string[] = [];
        const sendRequest = makeMockSendRequest((req) => urlsSeen.push(req.url));

        const config: SwazzConfig = {
            base_url: 'https://api.example.com',
            global_headers: {},
            cookies: {},
            dictionaries: {},
            settings: {
                iterations_per_profile: 1,
                concurrency: 1,
                timeout_ms: 1000,
                max_payload_size_bytes: 1000,
                delay_between_requests_ms: 0,
                profiles: ['RANDOM'],
            },
            endpoints: [
                {
                    path: '/items/{item_uuid}',
                    method: 'GET',
                    schema: { type: 'object', properties: {} },
                },
            ],
        };

        const runner = new FuzzRunner(config, sendRequest);
        await runner.start();

        expect(urlsSeen.length).toBe(1);
        const url = urlsSeen[0];
        const match = url.match(/\/items\/(.+)$/);
        expect(match).not.toBeNull();
        const val = match![1];

        // UUID heuristic: should look like a UUID (approx)
        expect(val).toMatch(/^[0-9a-f-]{36}$/i);
    });
});
