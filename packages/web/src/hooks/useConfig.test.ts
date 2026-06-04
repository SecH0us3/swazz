/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfig, validateConfig } from './useConfig.js';
import { DEFAULT_SETTINGS } from '../types.js';
import type { SwazzConfig } from '../types.js';

const STORAGE_KEY = 'swazz:config';

const DEFAULT_CONFIG: SwazzConfig = {
    base_url: '',
    global_headers: {},
    cookies: {},
    dictionaries: {},
    settings: { ...DEFAULT_SETTINGS },
    endpoints: [],
    disabled_endpoints: [],
    _swagger_urls: [],
    security: { allow_private_ips: false },
};

describe('useConfig', () => {
    let getItemSpy: any;
    let setItemSpy: any;

    beforeEach(() => {
        // Mock localStorage
        const localStorageMock = (() => {
            let store: Record<string, string> = {};
            return {
                getItem: vi.fn((key: string) => store[key] || null),
                setItem: vi.fn((key: string, value: string) => {
                    store[key] = value.toString();
                }),
                clear: vi.fn(() => {
                    store = {};
                }),
                removeItem: vi.fn((key: string) => {
                    delete store[key];
                }),
            };
        })();

        vi.stubGlobal('localStorage', localStorageMock);
        getItemSpy = localStorageMock.getItem;
        setItemSpy = localStorageMock.setItem;
        
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
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

    it('should export config correctly with optimized hybrid format', () => {
        const { result } = renderHook(() => useConfig());

        act(() => {
            result.current.updateConfig({
                base_url: 'https://export-test.com',
                global_headers: { 'X-Custom-Header': 'val' },
                _swagger_urls: ['https://example.com/swagger.json'],
                disabled_endpoints: ['/admin'],
                endpoints: [{ path: '/users', method: 'GET', schema: {} }]
            });
        });

        const exported = result.current.exportConfig();
        const parsed = JSON.parse(exported);

        expect(parsed.base_url).toBe('https://export-test.com');
        expect(parsed.headers).toEqual({ 'X-Custom-Header': 'val' });
        expect(parsed.swagger_urls).toEqual(['https://example.com/swagger.json']);
        expect(parsed.endpoints).toEqual({ exclude: ['/admin'] });
        expect(parsed.endpoints.exclude).toEqual(['/admin']);
    });

    describe('validateConfig', () => {
        it('should pass on a valid partial or full config', () => {
            expect(() => validateConfig({})).not.toThrow();
            expect(() => validateConfig({
                base_url: 'https://api.com',
                settings: {
                    concurrency: 5,
                    bola_similarity_threshold: 0.9
                },
                security: {
                    allow_private_ips: true
                }
            })).not.toThrow();
        });

        it('should throw when config is not an object', () => {
            expect(() => validateConfig(null)).toThrow('Config must be a JSON object');
            expect(() => validateConfig('string')).toThrow('Config must be a JSON object');
            expect(() => validateConfig([])).toThrow('Config must be a JSON object');
        });

        it('should throw when base_url is not a string', () => {
            expect(() => validateConfig({ base_url: 123 })).toThrow('base_url must be a string');
        });

        it('should throw when settings is not an object', () => {
            expect(() => validateConfig({ settings: 'not an object' })).toThrow('settings must be an object');
        });

        it('should throw when settings property types are incorrect', () => {
            expect(() => validateConfig({ settings: { concurrency: '5' } })).toThrow('settings.concurrency must be a number');
            expect(() => validateConfig({ settings: { debug: 'true' } })).toThrow('settings.debug must be a boolean');
            expect(() => validateConfig({ settings: { bola_similarity_threshold: '0.85' } })).toThrow('settings.bola_similarity_threshold must be a number');
            expect(() => validateConfig({ settings: { oob_server_url: 123 } })).toThrow('settings.oob_server_url must be a string');
        });

        it('should throw when security properties are incorrect', () => {
            expect(() => validateConfig({ security: 'not an object' })).toThrow('security must be an object');
            expect(() => validateConfig({ security: { allow_private_ips: 'yes' } })).toThrow('security.allow_private_ips must be a boolean');
        });
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
