import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfig } from './useConfig.js';
import { DEFAULT_SETTINGS } from '../types.js';
import type { SwazzConfig } from '../types.js';

const STORAGE_KEY = 'swazz:config';

const DEFAULT_CONFIG: SwazzConfig & { _swagger_urls?: string[] } = {
    base_url: '',
    global_headers: {},
    cookies: {},
    dictionaries: {},
    settings: { ...DEFAULT_SETTINGS },
    endpoints: [],
    disabled_endpoints: [],
    _swagger_urls: [],
};

describe('useConfig', () => {
    let getItemSpy: any;
    let setItemSpy: any;

    beforeEach(() => {
        getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
        setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
        localStorage.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should initialize with default config when localStorage is empty', () => {
        const { result } = renderHook(() => useConfig());
        expect(result.current.config).toEqual(DEFAULT_CONFIG);
        expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('should load config from localStorage when valid JSON is present', () => {
        const storedConfig = {
            ...DEFAULT_CONFIG,
            base_url: 'https://api.example.com',
            global_headers: { Authorization: 'Bearer token' }
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedConfig));

        const { result } = renderHook(() => useConfig());
        expect(result.current.config).toEqual(storedConfig);
    });

    it('should catch errors gracefully when localStorage.getItem throws', () => {
        getItemSpy.mockImplementationOnce(() => {
            throw new Error('Access denied');
        });

        const { result } = renderHook(() => useConfig());
        expect(result.current.config).toEqual(DEFAULT_CONFIG);
    });

    it('should catch errors gracefully when localStorage contains invalid JSON', () => {
        localStorage.setItem(STORAGE_KEY, 'invalid json');

        const { result } = renderHook(() => useConfig());
        expect(result.current.config).toEqual(DEFAULT_CONFIG);
    });

    it('should save config to localStorage when updated', () => {
        const { result } = renderHook(() => useConfig());

        act(() => {
            result.current.updateConfig({ base_url: 'https://new-api.com' });
        });

        expect(result.current.config.base_url).toBe('https://new-api.com');
        expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));

        const lastSetCall = setItemSpy.mock.calls[setItemSpy.mock.calls.length - 1];
        const savedConfig = JSON.parse(lastSetCall[1]);
        expect(savedConfig.base_url).toBe('https://new-api.com');
    });

    it('should catch errors gracefully when localStorage.setItem throws', () => {
        setItemSpy.mockImplementationOnce(() => {
            throw new Error('Storage full');
        });

        const { result } = renderHook(() => useConfig());

        // Should not throw
        act(() => {
            result.current.updateConfig({ base_url: 'https://new-api.com' });
        });

        expect(result.current.config.base_url).toBe('https://new-api.com');
    });

    it('should update global headers correctly', () => {
        const { result } = renderHook(() => useConfig());

        act(() => {
            result.current.updateHeaders({ 'X-Test': 'test-value' });
        });

        expect(result.current.config.global_headers).toEqual({ 'X-Test': 'test-value' });
    });

    it('should update cookies correctly', () => {
        const { result } = renderHook(() => useConfig());

        act(() => {
            result.current.updateCookies({ 'session_id': '12345' });
        });

        expect(result.current.config.cookies).toEqual({ 'session_id': '12345' });
    });

    it('should update dictionaries correctly', () => {
        const { result } = renderHook(() => useConfig());

        const newDict = { usernames: ['admin', 'user'] };
        act(() => {
            result.current.updateDictionaries(newDict);
        });

        expect(result.current.config.dictionaries).toEqual(newDict);
    });

    it('should update settings correctly', () => {
        const { result } = renderHook(() => useConfig());

        act(() => {
            result.current.updateSettings({ concurrency: 10 });
        });

        expect(result.current.config.settings.concurrency).toBe(10);
        expect(result.current.config.settings.timeout_ms).toBe(DEFAULT_SETTINGS.timeout_ms);
    });

    it('should update profiles correctly', () => {
        const { result } = renderHook(() => useConfig());

        act(() => {
            result.current.updateProfiles(['RANDOM', 'MALICIOUS']);
        });

        expect(result.current.config.settings.profiles).toEqual(['RANDOM', 'MALICIOUS']);
    });

    it('should export config correctly', () => {
        const { result } = renderHook(() => useConfig());

        act(() => {
            result.current.updateConfig({ base_url: 'https://export-test.com' });
        });

        const exported = result.current.exportConfig();
        const parsed = JSON.parse(exported);

        expect(parsed.base_url).toBe('https://export-test.com');
    });

    it('should import valid config correctly', () => {
        const { result } = renderHook(() => useConfig());

        const newConfig = {
            base_url: 'https://imported.com',
            global_headers: { 'Imported': 'true' }
        };

        act(() => {
            result.current.importConfig(JSON.stringify(newConfig));
        });

        expect(result.current.config.base_url).toBe('https://imported.com');
        expect(result.current.config.global_headers).toEqual({ 'Imported': 'true' });
        expect(result.current.config.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should throw an error on invalid config import', () => {
        const { result } = renderHook(() => useConfig());

        expect(() => {
            act(() => {
                result.current.importConfig('invalid json string');
            });
        }).toThrowError(/^Invalid JSON config:/);
    });
});
