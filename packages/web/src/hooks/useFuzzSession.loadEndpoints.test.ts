// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 *
 * Boundary/error coverage for useFuzzSession.loadEndpoints — the spec-loading
 * loop. Isolated from useFuzzSession.test.ts so the swaggerService mock here
 * does not leak into the guard-focused tests there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the spec loader so loadEndpoints never hits the network.
vi.mock('../services/swaggerService.js', () => {
    class ParsingError extends Error {
        details: any;
        constructor(message: string, details: any) {
            super(message);
            this.name = 'ParsingError';
            this.details = details;
        }
    }
    return {
        ParsingError,
        loadSwaggerUrl: vi.fn(),
    };
});

import { useFuzzSession } from './useFuzzSession.js';
import { useAppStore } from '../store/appStore.js';
import { loadSwaggerUrl, ParsingError } from '../services/swaggerService.js';
import type { SwazzConfig } from '../types.js';

const mockedLoad = vi.mocked(loadSwaggerUrl);

function makeHook(configOverrides: Partial<SwazzConfig> = {}) {
    const updateConfig = vi.fn();
    const showToast = vi.fn();
    const config: SwazzConfig = {
        base_url: '',
        global_headers: {},
        cookies: {},
        dictionaries: {},
        settings: {} as any,
        endpoints: [],
        disabled_endpoints: [],
        _swagger_urls: [],
        security: { allow_private_ips: false },
        rules: { ignore: [] },
        ...configOverrides,
    };
    const hook = renderHook(() =>
        useFuzzSession({
            config,
            updateConfig,
            start: vi.fn(),
            connectToExisting: vi.fn(),
            saveRun: vi.fn(),
            getDb: vi.fn(),
            showToast,
        })
    );
    return { hook, updateConfig, showToast };
}

describe('useFuzzSession.loadEndpoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({ isLoadingSpecs: false, parsingError: null, specCacheDates: {} } as any);
    });

    it('loads endpoints, detects base_url and records a cache date on success', async () => {
        mockedLoad.mockResolvedValue({
            basePath: 'https://api.detected.test',
            endpoints: [{ path: '/a', method: 'GET', schema: {} }],
            endpointCount: 1,
            cachedAt: null,
        } as any);

        const { hook, updateConfig } = makeHook();
        let res: any;
        await act(async () => {
            res = await hook.result.current.loadEndpoints(['https://spec.test/openapi.json']);
        });

        expect(mockedLoad).toHaveBeenCalledOnce();
        expect(res.allEndpoints).toHaveLength(1);
        expect(res.detectedBaseUrl).toContain('api.detected.test');
        expect(updateConfig).toHaveBeenCalledWith(
            expect.objectContaining({ endpoints: expect.any(Array) })
        );
        // a cache date was stored for the spec url
        expect(useAppStore.getState().specCacheDates['https://spec.test/openapi.json']).toBeTruthy();
        // loading flag is cleared again
        expect(useAppStore.getState().isLoadingSpecs).toBe(false);
    });

    it('prefixes a scheme-less url with https:// before loading', async () => {
        mockedLoad.mockResolvedValue({ basePath: '', endpoints: [{ path: '/x', method: 'GET', schema: {} }], endpointCount: 1, cachedAt: null } as any);
        const { hook } = makeHook();
        await act(async () => {
            await hook.result.current.loadEndpoints(['example.com/swagger.json']);
        });
        expect(mockedLoad).toHaveBeenCalledWith(
            'https://example.com/swagger.json',
            expect.anything(),
            expect.anything(),
            undefined
        );
    });

    it('captures a ParsingError into the store and returns null', async () => {
        mockedLoad.mockRejectedValue(new ParsingError('bad spec', { error: { message: 'parse failed' }, request: { url: 'https://spec.test/bad.json', method: 'GET', headers: {} } } as any));
        const { hook } = makeHook();
        let res: any = 'unset';
        await act(async () => {
            res = await hook.result.current.loadEndpoints(['https://spec.test/bad.json']);
        });
        expect(res).toBeNull();
        expect((useAppStore.getState().parsingError as any).error).toEqual({ message: 'parse failed' });
        expect(useAppStore.getState().isLoadingSpecs).toBe(false);
    });

    it('wraps a generic error with request context and returns null', async () => {
        mockedLoad.mockRejectedValue(new Error('network down'));
        const { hook } = makeHook();
        let res: any = 'unset';
        await act(async () => {
            res = await hook.result.current.loadEndpoints(['https://spec.test/x.json']);
        });
        expect(res).toBeNull();
        const pe = useAppStore.getState().parsingError as any;
        expect(pe.error.message).toBe('network down');
        expect(pe.request.url).toBe('https://spec.test/x.json');
    });

    it('returns null when no spec yields any endpoint', async () => {
        mockedLoad.mockResolvedValue({ basePath: '', endpoints: [], endpointCount: 0, cachedAt: null } as any);
        const { hook, updateConfig } = makeHook();
        let res: any = 'unset';
        await act(async () => {
            res = await hook.result.current.loadEndpoints(['https://spec.test/empty.json']);
        });
        expect(res).toBeNull();
        expect(updateConfig).not.toHaveBeenCalled();
    });

    it('keeps the first error when the second url also fails', async () => {
        mockedLoad
            .mockRejectedValueOnce(new Error('first'))
            .mockRejectedValueOnce(new Error('second'));
        const { hook } = makeHook();
        await act(async () => {
            await hook.result.current.loadEndpoints(['https://a.test/s.json', 'https://b.test/s.json']);
        });
        expect((useAppStore.getState().parsingError as any).error.message).toBe('first');
        expect(mockedLoad).toHaveBeenCalledTimes(2);
    });
});
