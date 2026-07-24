/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from './useAuth.js';
import { useAppStore } from '../store/appStore.js';

describe('useAuth hook', () => {
    let originalFetch: typeof globalThis.fetch;
    let storeMock: Record<string, string> = {};
    let sessionMock: Record<string, string> = {};

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn();

        // Mock localStorage
        storeMock = {};
        const localStorageMock = {
            getItem: vi.fn((key: string) => storeMock[key] || null),
            setItem: vi.fn((key: string, value: string) => {
                storeMock[key] = value.toString();
            }),
            clear: vi.fn(() => {
                storeMock = {};
            }),
            removeItem: vi.fn((key: string) => {
                delete storeMock[key];
            }),
            length: 0,
            key: vi.fn()
        };
        vi.stubGlobal('localStorage', localStorageMock);

        // Mock sessionStorage
        sessionMock = {};
        const sessionStorageMock = {
            getItem: vi.fn((key: string) => sessionMock[key] || null),
            setItem: vi.fn((key: string, value: string) => {
                sessionMock[key] = value.toString();
            }),
            clear: vi.fn(() => {
                sessionMock = {};
            }),
            removeItem: vi.fn((key: string) => {
                delete sessionMock[key];
            }),
            length: 0,
            key: vi.fn()
        };
        vi.stubGlobal('sessionStorage', sessionStorageMock);

        // Mock Web Worker for Proof of Work
        class MockWorker {
            onmessage: any;
            postMessage(data: any) {
                setTimeout(() => {
                    if (this.onmessage) {
                        this.onmessage({ data: 42 }); // returns mock nonce
                    }
                }, 5);
            }
            terminate() {}
        }
        vi.stubGlobal('Worker', MockWorker);
        vi.stubGlobal('Blob', class {});
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob-url'),
            revokeObjectURL: vi.fn()
        });

        // Set default store state
        useAppStore.setState({ csrfToken: null, turnstileSiteKey: null });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should initialize and load info', async () => {
        const mockInfo = {
            auth_enabled: true,
            password_auth_enabled: true,
            github_auth_enabled: true,
            gitlab_auth_enabled: true,
            turnstile_site_key: 'site-key-123'
        };
        const mockResponse = new Response(JSON.stringify(mockInfo), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'X-CSRF-Token': 'csrf-token-abc'
            }
        });
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

        let hookResult: any;
        await act(async () => {
            const { result } = renderHook(() => useAuth());
            hookResult = result;
        });

        expect(hookResult.current.authEnabled).toBe(true);
        expect(hookResult.current.passwordAuthEnabled).toBe(true);
        expect(hookResult.current.githubAuthEnabled).toBe(true);
        expect(hookResult.current.gitlabAuthEnabled).toBe(true);
        expect(useAppStore.getState().csrfToken).toBe('csrf-token-abc');
        expect(useAppStore.getState().turnstileSiteKey).toBe('site-key-123');
    });

    it('should successfully handle login flow (step1 + step2)', async () => {
        // Mock /api/info
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
        
        // Mock step1 (challenge)
        const mockStep1 = {
            token: 'challenge-token',
            challenge: 'challenge-str',
            difficulty: 2
        };
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockStep1), { status: 200 }));

        // Mock login final step
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ token: 'auth-jwt-token' }), { status: 200 }));

        const { result } = renderHook(() => useAuth());

        let loginResult: any;
        await act(async () => {
            loginResult = await result.current.login('user', 'pass');
        });

        expect(loginResult).toEqual({ success: true });
        expect(result.current.token).toBe('auth-jwt-token');
        expect(localStorage.getItem('swazz_token')).toBe('auth-jwt-token');
    });

    it('should handle registration flow', async () => {
        // Mock /api/info
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

        // Mock register API response
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ token: 'registered-token' }), { status: 200 }));

        const { result } = renderHook(() => useAuth());

        await act(async () => {
            await result.current.register('newuser', 'password');
        });

        expect(result.current.token).toBe('registered-token');
        expect(localStorage.getItem('swazz_token')).toBe('registered-token');
    });

    it('should handle guest login flow', async () => {
        // Mock /api/info
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

        // Mock guest step1
        const mockStep1 = {
            token: 'guest-challenge-token',
            challenge: 'guest-challenge',
            difficulty: 1
        };
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify(mockStep1), { status: 200 }));

        // Mock guest final
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ token: 'guest-session-token' }), { status: 200 }));

        const { result } = renderHook(() => useAuth());

        await act(async () => {
            await result.current.continueAsGuest();
        });

        expect(result.current.token).toBe('guest-session-token');
        expect(result.current.isGuest).toBe(true);
        expect(sessionStorage.getItem('swazz_guest')).toBe('true');
    });

    it('should handle logout flow', () => {
        // Mock /api/info
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

        storeMock['swazz_token'] = 'existing-token';
        sessionMock['swazz_guest'] = 'true';

        const { result } = renderHook(() => useAuth());

        act(() => {
            result.current.logout();
        });

        expect(result.current.token).toBeNull();
        expect(result.current.isGuest).toBe(false);
        expect(localStorage.getItem('swazz_token')).toBeNull();
        expect(sessionStorage.getItem('swazz_guest')).toBeNull();
    });
});
