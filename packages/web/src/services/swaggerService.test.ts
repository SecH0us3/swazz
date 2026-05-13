import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSwaggerUrl } from './swaggerService.js';

describe('swaggerService', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
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

        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

        const result = await loadSwaggerUrl('http://example.com/swagger.json');

        expect(global.fetch).toHaveBeenCalledWith('/api/parse', {
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

    it('throws error when response is not ok and contains json error', async () => {
        const mockErrorData = { error: 'Invalid URL provided' };

        const mockResponse = new Response(JSON.stringify(mockErrorData), {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'Content-Type': 'application/json' }
        });

        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

        await expect(loadSwaggerUrl('http://invalid-url')).rejects.toThrow('Invalid URL provided');
    });

    it('throws error using statusText when response is not ok and json parsing fails', async () => {
        // A response that is not ok and not valid JSON
        const mockResponse = new Response('Server Down', {
            status: 500,
            statusText: 'Internal Server Error'
        });

        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

        await expect(loadSwaggerUrl('http://example.com')).rejects.toThrow('Internal Server Error');
    });

    it('throws error with status code if statusText is missing and json parsing fails', async () => {
        // A response with empty status text
        const mockResponse = new Response('Bad Gateway', {
            status: 502,
            statusText: ''
        });

        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);

        await expect(loadSwaggerUrl('http://example.com')).rejects.toThrow('Failed to parse swagger: 502');
    });

    it('propagates network errors from fetch', async () => {
        const networkError = new TypeError('Failed to fetch');
        vi.mocked(global.fetch).mockRejectedValueOnce(networkError);

        await expect(loadSwaggerUrl('http://example.com')).rejects.toThrow('Failed to fetch');
    });

    it('throws error when successful response contains invalid json', async () => {
        const mockResponse = new Response('Invalid JSON', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);
        await expect(loadSwaggerUrl('http://example.com/swagger.json')).rejects.toThrow(SyntaxError);
    });

    it('throws error when data.endpoints is missing because it tries to read length property', async () => {
        const mockResponse = new Response(JSON.stringify({ basePath: '/v1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse);
        await expect(loadSwaggerUrl('http://example.com/swagger.json')).rejects.toThrow(TypeError);
    });
});
