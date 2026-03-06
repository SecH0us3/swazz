/**
 * Unit tests for parseSwaggerSpec (Swagger/OpenAPI parser).
 */
import { describe, it, expect } from 'vitest';
import { parseSwaggerSpec } from '../src/swagger.js';

// ─── Swagger 2.0 ─────────────────────────────────────────────

const swagger2Spec = {
    swagger: '2.0',
    host: 'api.example.com',
    basePath: '/v1',
    schemes: ['https'],
    paths: {
        '/pets': {
            get: {
                operationId: 'listPets',
                parameters: [
                    { in: 'query', name: 'limit', type: 'integer' },
                ],
            },
            post: {
                operationId: 'createPet',
                parameters: [
                    {
                        in: 'body',
                        name: 'body',
                        schema: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                age: { type: 'integer' },
                            },
                        },
                    },
                ],
            },
        },
        '/pets/{id}': {
            get: {
                operationId: 'getPet',
                parameters: [
                    { in: 'path', name: 'id', type: 'integer' },
                ],
            },
            delete: {
                operationId: 'deletePet',
                parameters: [
                    { in: 'path', name: 'id', type: 'integer' },
                ],
            },
        },
    },
};

describe('parseSwaggerSpec — Swagger 2.0', () => {
    const { basePath, endpoints } = parseSwaggerSpec(swagger2Spec);

    it('extracts the correct base path', () => {
        expect(basePath).toBe('https://api.example.com/v1');
    });

    it('finds all endpoints', () => {
        const keys = endpoints.map((e) => `${e.method} ${e.path}`);
        expect(keys).toContain('GET /pets');
        expect(keys).toContain('POST /pets');
        expect(keys).toContain('GET /pets/{id}');
        expect(keys).toContain('DELETE /pets/{id}');
    });

    it('extracts POST body schema', () => {
        const post = endpoints.find((e) => e.method === 'POST' && e.path === '/pets');
        expect(post?.schema.type).toBe('object');
        expect(post?.schema.properties?.name?.type).toBe('string');
        expect(post?.schema.properties?.age?.type).toBe('integer');
    });

    it('extracts path parameters into pathParams', () => {
        const get = endpoints.find((e) => e.method === 'GET' && e.path === '/pets/{id}');
        expect(get?.pathParams).toBeDefined();
        expect(get?.pathParams?.id?.type).toBe('integer');
    });

    it('query params appear in schema for GET', () => {
        const get = endpoints.find((e) => e.method === 'GET' && e.path === '/pets');
        expect(get?.schema.properties?.limit?.type).toBe('integer');
    });
});

// ─── OpenAPI 3.x ─────────────────────────────────────────────

const openapi3Spec = {
    openapi: '3.0.0',
    servers: [{ url: 'https://api.example.com/v2' }],
    paths: {
        '/users': {
            post: {
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    email: { type: 'string', format: 'email' },
                                    role: { enum: ['admin', 'user', 'guest'] },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/users/{userId}': {
            get: {
                parameters: [
                    {
                        in: 'path',
                        name: 'userId',
                        schema: { type: 'string', format: 'uuid' },
                    },
                ],
            },
        },
    },
};

describe('parseSwaggerSpec — OpenAPI 3.x', () => {
    const { basePath, endpoints } = parseSwaggerSpec(openapi3Spec);

    it('extracts server URL as base path', () => {
        expect(basePath).toBe('https://api.example.com/v2');
    });

    it('extracts requestBody schema for POST', () => {
        const post = endpoints.find((e) => e.method === 'POST' && e.path === '/users');
        expect(post?.schema.properties?.email?.format).toBe('email');
        expect(post?.schema.properties?.role?.enum).toEqual(['admin', 'user', 'guest']);
    });

    it('extracts OpenAPI 3 path parameters', () => {
        const get = endpoints.find((e) => e.method === 'GET' && e.path === '/users/{userId}');
        expect(get?.pathParams?.userId?.type).toBe('string');
        expect(get?.pathParams?.userId?.format).toBe('uuid');
    });
});

// ─── $ref resolution ─────────────────────────────────────────

const specWithRefs = {
    swagger: '2.0',
    host: 'api.example.com',
    definitions: {
        Pet: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                kind: { type: 'string' },
            },
        },
    },
    paths: {
        '/pets': {
            post: {
                parameters: [
                    {
                        in: 'body',
                        name: 'body',
                        schema: { $ref: '#/definitions/Pet' },
                    },
                ],
            },
        },
    },
};

describe('parseSwaggerSpec — $ref resolution', () => {
    it('resolves $ref in request body schema', () => {
        const { endpoints } = parseSwaggerSpec(specWithRefs);
        const post = endpoints.find((e) => e.method === 'POST');
        expect(post?.schema.properties?.name?.type).toBe('string');
        expect(post?.schema.properties?.kind?.type).toBe('string');
    });
});

// ─── Edge cases ──────────────────────────────────────────────

describe('parseSwaggerSpec — edge cases', () => {
    it('throws if spec is not an object', () => {
        expect(() => parseSwaggerSpec(null)).toThrow('Invalid spec');
        expect(() => parseSwaggerSpec('string')).toThrow('Invalid spec');
    });

    it('throws if spec has no paths', () => {
        expect(() => parseSwaggerSpec({ swagger: '2.0' })).toThrow('no "paths" found');
    });

    it('handles empty paths object', () => {
        const { endpoints } = parseSwaggerSpec({ swagger: '2.0', paths: {} });
        expect(endpoints).toEqual([]);
    });

    it('ignores path-level params for non-matching methods', () => {
        const spec = {
            swagger: '2.0',
            host: 'x.com',
            paths: {
                '/items/{id}': {
                    parameters: [{ in: 'path', name: 'id', type: 'string' }],
                    get: { operationId: 'getItem' },
                    // No POST
                },
            },
        };
        const { endpoints } = parseSwaggerSpec(spec);
        // Only GET should be present (POST has no operation)
        expect(endpoints.length).toBe(1);
        expect(endpoints[0].method).toBe('GET');
        expect(endpoints[0].pathParams?.id?.type).toBe('string');
    });
});
