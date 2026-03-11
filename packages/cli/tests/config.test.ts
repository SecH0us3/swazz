import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test filterEndpoints and matchPattern logic via the exported loadConfig,
// but since loadConfig does I/O, we test the filtering logic in isolation
// by extracting it. For now, test the pattern matching indirectly.

// Import the module to test internal logic via integration
import { loadConfig } from '../src/config.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = join(tmpdir(), 'swazz-test-' + Date.now());

beforeEach(async () => {
    await mkdir(TMP, { recursive: true });
});

async function writeConfig(name: string, config: any): Promise<string> {
    const path = join(TMP, name);
    await writeFile(path, JSON.stringify(config), 'utf-8');
    return path;
}

async function writeSpec(name: string, spec: any): Promise<string> {
    const path = join(TMP, name);
    await writeFile(path, JSON.stringify(spec), 'utf-8');
    return path;
}

const MINIMAL_SPEC = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    servers: [{ url: 'https://api.test.com' }],
    paths: {
        '/users': {
            get: { responses: { '200': { description: 'ok' } } },
            post: {
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: { name: { type: 'string' } },
                            },
                        },
                    },
                },
                responses: { '201': { description: 'created' } },
            },
        },
        '/users/{id}': {
            get: {
                parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
                responses: { '200': { description: 'ok' } },
            },
            delete: {
                parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
                responses: { '204': { description: 'deleted' } },
            },
        },
        '/health': {
            get: { responses: { '200': { description: 'ok' } } },
        },
    },
};

describe('loadConfig', () => {
    it('loads config with local spec file', async () => {
        const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
        const configPath = await writeConfig('config.json', {
            swagger_urls: [specPath],
        });

        const { runConfig } = await loadConfig(configPath);
        expect(runConfig.base_url).toBe('https://api.test.com');
        expect(runConfig.endpoints.length).toBeGreaterThan(0);
    });

    it('uses base_url from config over spec', async () => {
        const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
        const configPath = await writeConfig('config.json', {
            swagger_urls: [specPath],
            base_url: 'https://override.com',
        });

        const { runConfig } = await loadConfig(configPath);
        expect(runConfig.base_url).toBe('https://override.com');
    });

    it('merges settings with defaults', async () => {
        const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
        const configPath = await writeConfig('config.json', {
            swagger_urls: [specPath],
            settings: { iterations_per_profile: 5 },
        });

        const { runConfig } = await loadConfig(configPath);
        expect(runConfig.settings.iterations_per_profile).toBe(5);
        expect(runConfig.settings.concurrency).toBe(5); // default
        expect(runConfig.settings.timeout_ms).toBe(10000); // default
    });

    it('passes headers and cookies through', async () => {
        const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
        const configPath = await writeConfig('config.json', {
            swagger_urls: [specPath],
            headers: { 'Authorization': 'Bearer abc' },
            cookies: { session: 'xyz' },
        });

        const { runConfig } = await loadConfig(configPath);
        expect(runConfig.global_headers.Authorization).toBe('Bearer abc');
        expect(runConfig.cookies.session).toBe('xyz');
    });

    it('throws on missing swagger_urls', async () => {
        const configPath = await writeConfig('bad.json', {});
        await expect(loadConfig(configPath)).rejects.toThrow('swagger_urls');
    });

    it('throws on empty swagger_urls', async () => {
        const configPath = await writeConfig('bad.json', { swagger_urls: [] });
        await expect(loadConfig(configPath)).rejects.toThrow('swagger_urls');
    });

    it('throws on invalid JSON file', async () => {
        const path = join(TMP, 'invalid.json');
        await writeFile(path, 'not json', 'utf-8');
        await expect(loadConfig(path)).rejects.toThrow();
    });

    it('throws on nonexistent file', async () => {
        await expect(loadConfig('/nonexistent/path.json')).rejects.toThrow();
    });

    describe('endpoint filtering', () => {
        it('filters with include pattern', async () => {
            const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
            const configPath = await writeConfig('config.json', {
                swagger_urls: [specPath],
                endpoints: { include: ['/users'] },
            });

            const { runConfig } = await loadConfig(configPath);
            expect(runConfig.endpoints.every(ep => ep.path === '/users')).toBe(true);
        });

        it('filters with exclude pattern', async () => {
            const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
            const configPath = await writeConfig('config.json', {
                swagger_urls: [specPath],
                endpoints: { exclude: ['/health'] },
            });

            const { runConfig } = await loadConfig(configPath);
            expect(runConfig.endpoints.some(ep => ep.path === '/health')).toBe(false);
            expect(runConfig.endpoints.length).toBeGreaterThan(0);
        });

        it('supports glob patterns with *', async () => {
            const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
            const configPath = await writeConfig('config.json', {
                swagger_urls: [specPath],
                endpoints: { include: ['/users*'] },
            });

            const { runConfig } = await loadConfig(configPath);
            expect(runConfig.endpoints.every(ep => ep.path.startsWith('/users'))).toBe(true);
            expect(runConfig.endpoints.length).toBeGreaterThan(0);
        });

        it('supports ** glob for deep match', async () => {
            const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
            const configPath = await writeConfig('config.json', {
                swagger_urls: [specPath],
                endpoints: { include: ['/**'] },
            });

            const { runConfig } = await loadConfig(configPath);
            // Should match everything
            expect(runConfig.endpoints.length).toBe(5); // GET+POST /users, GET+DELETE /users/{id}, GET /health
        });

        it('throws when all endpoints filtered out', async () => {
            const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
            const configPath = await writeConfig('config.json', {
                swagger_urls: [specPath],
                endpoints: { include: ['/nonexistent'] },
            });

            await expect(loadConfig(configPath)).rejects.toThrow('No endpoints');
        });

        it('include + exclude together', async () => {
            const specPath = await writeSpec('spec.json', MINIMAL_SPEC);
            const configPath = await writeConfig('config.json', {
                swagger_urls: [specPath],
                endpoints: {
                    include: ['/users**'],
                    exclude: ['DELETE /users/{id}'],
                },
            });

            const { runConfig } = await loadConfig(configPath);
            expect(runConfig.endpoints.some(ep => ep.method === 'DELETE')).toBe(false);
            expect(runConfig.endpoints.length).toBeGreaterThan(0);
        });
    });
});
