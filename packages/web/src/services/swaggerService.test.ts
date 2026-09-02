// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSwaggerUrl, parseRawSpec, detectMcpServer, ParsingError } from './swaggerService.js';
import { useAppStore } from '../store/appStore.js';

describe('swaggerService', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('successfully parses swagger url', async () => {
        const mockResponseData = {
            basePath: '/v1',
            endpoints: [
                { path: '/users', method: 'GET' },
                { path: '/users', method: 'POST' }
            ]
        };

        const mockResponse = new Response(JSON.stringify(mockResponseData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

        const result = await loadSwaggerUrl('http://example.com/swagger.json');

        expect(globalThis.fetch).toHaveBeenCalledWith('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'http://example.com/swagger.json' })
        });

        expect(result).toEqual({
            basePath: '/v1',
            endpointCount: 2,
            endpoints: mockResponseData.endpoints
        });
    });

    it('throws ParsingError when response is not ok and contains json error', async () => {
        const mockErrorData = { error: 'Invalid URL provided' };

        const mockResponse = new Response(JSON.stringify(mockErrorData), {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'Content-Type': 'application/json' }
        });

        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

        await expect(loadSwaggerUrl('http://invalid-url')).rejects.toThrow(ParsingError);
    });

    it('throws ParsingError using statusText when response is not ok and json parsing fails', async () => {
        // A response that is not ok and not valid JSON
        const mockResponse = new Response('Server Down', {
            status: 500,
            statusText: 'Internal Server Error'
        });

        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

        await expect(loadSwaggerUrl('http://example.com')).rejects.toThrow(ParsingError);
    });

    it('throws ParsingError with status code if statusText is missing and json parsing fails', async () => {
        // A response with empty status text
        const mockResponse = new Response('Bad Gateway', {
            status: 502,
            statusText: ''
        });

        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

        await expect(loadSwaggerUrl('http://example.com')).rejects.toThrow(ParsingError);
    });

    it('throws ParsingError when successful response contains invalid json', async () => {
        const mockResponse = new Response('Invalid JSON', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);
        await expect(loadSwaggerUrl('http://example.com/swagger.json')).rejects.toThrow(ParsingError);
    });

    it('handles missing endpoints in response gracefully (throws TypeError or similar or ParsingError)', async () => {
        const mockResponseData = { basePath: '/v1' };
        const mockResponse = new Response(JSON.stringify(mockResponseData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

        await expect(loadSwaggerUrl('http://example.com/swagger.json')).rejects.toThrow(ParsingError);
    });

    it('accepts headers and cookies arguments even though they are currently unused in fetch body', async () => {
        const mockResponseData = { basePath: '/', endpoints: [] };
        const mockResponse = new Response(JSON.stringify(mockResponseData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

        const result = await loadSwaggerUrl('http://example.com/swagger.json', { 'X-Auth': 'token' }, { 'session': '123' });

        expect(result).toEqual({
            basePath: '/',
            endpointCount: 0,
            endpoints: []
        });
    });

    it('propagates network errors from fetch as ParsingError', async () => {
        const networkError = new TypeError('Failed to fetch');
        vi.mocked(globalThis.fetch).mockRejectedValueOnce(networkError);

        await expect(loadSwaggerUrl('http://example.com/swagger.json')).rejects.toThrow(ParsingError);
    });

    describe('parseRawSpec', () => {
        it('successfully parses raw spec', async () => {
            const mockResponseData = {
                basePath: '/v2',
                endpoints: [
                    { path: '/items', method: 'GET' }
                ]
            };
            const mockResponse = new Response(JSON.stringify(mockResponseData), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const result = await parseRawSpec('openapi: 3.0.0');
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawSpec: 'openapi: 3.0.0' })
            });
            expect(result).toEqual({
                basePath: '/v2',
                endpointCount: 1,
                endpoints: mockResponseData.endpoints
            });
        });

        it('throws ParsingError when parse fails', async () => {
            const mockErrorData = { error: 'Failed to parse spec' };
            const mockResponse = new Response(JSON.stringify(mockErrorData), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            await expect(parseRawSpec('invalid spec')).rejects.toThrow(ParsingError);
        });

        it('handles network error in parseRawSpec', async () => {
            vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Connection refused'));
            await expect(parseRawSpec('spec')).rejects.toThrow(ParsingError);
        });

        it('handles invalid JSON in parseRawSpec 200 response', async () => {
            const mockResponse = new Response('not json', {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);
            await expect(parseRawSpec('spec')).rejects.toThrow(ParsingError);
        });

        it('handles data.error in 200 response in parseRawSpec', async () => {
            const mockResponse = new Response(JSON.stringify({ error: 'Schema validation error' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);
            await expect(parseRawSpec('spec')).rejects.toThrow(ParsingError);
        });
    });

    describe('tokens and headers', () => {
        it('includes Authorization and X-CSRF-Token when available', async () => {
            localStorage.setItem('swazz_token', 'my-auth-token');
            useAppStore.setState({ csrfToken: 'my-csrf-token' });

            const mockResponse = new Response(JSON.stringify({ basePath: '/', endpoints: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            await loadSwaggerUrl('http://example.com/api');

            expect(globalThis.fetch).toHaveBeenCalledWith('/api/parse', expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer my-auth-token',
                    'X-CSRF-Token': 'my-csrf-token'
                })
            }));

            localStorage.removeItem('swazz_token');
            useAppStore.setState({ csrfToken: null });
        });
    });

    describe('detectMcpServer', () => {
        it('detects SSE MCP server on GET with text/event-stream', async () => {
            const mockResponse = new Response('', {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const result = await detectMcpServer('http://localhost:8000/sse');
            expect(result).toBe('sse');
        });

        it('detects HTTP MCP server on POST 200 initialize', async () => {
            // First GET fails
            vi.mocked(globalThis.fetch)
                .mockResolvedValueOnce(new Response('Not SSE', { status: 404, headers: { 'Content-Type': 'text/plain' } }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                }));

            const result = await detectMcpServer('http://localhost:8000/mcp');
            expect(result).toBe('http');
        });

        it('detects HTTP MCP server when POST returns 401 or 403', async () => {
            // First GET fails
            vi.mocked(globalThis.fetch)
                .mockResolvedValueOnce(new Response('', { status: 405 }))
                .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

            const result = await detectMcpServer('http://localhost:8000/mcp-auth');
            expect(result).toBe('http');
        });

        it('returns null when both GET and POST fail or error out', async () => {
            vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

            const result = await detectMcpServer('http://localhost:9999/down');
            expect(result).toBeNull();
        });
    });
});
