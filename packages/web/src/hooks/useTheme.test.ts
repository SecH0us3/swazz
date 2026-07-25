import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme.js';

describe('useTheme hook', () => {
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        document.body.className = '';
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
        vi.restoreAllMocks();
    });

    it('defaults to system mode and resolves system dark theme when localStorage is empty', () => {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('dark'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as any;

        const { result } = renderHook(() => useTheme());
        expect(result.current.mode).toBe('system');
        expect(result.current.theme).toBe('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('removes localStorage item when mode is set to system', () => {
        localStorage.setItem('swazz-theme', 'light');
        const { result } = renderHook(() => useTheme());

        act(() => {
            result.current.setMode('system');
        });

        expect(result.current.mode).toBe('system');
        expect(localStorage.getItem('swazz-theme')).toBeNull();
    });

    it('stores dark or light in localStorage when explicit mode is set', () => {
        const { result } = renderHook(() => useTheme());

        act(() => {
            result.current.setMode('dark');
        });

        expect(result.current.mode).toBe('dark');
        expect(result.current.theme).toBe('dark');
        expect(localStorage.getItem('swazz-theme')).toBe('dark');
    });

    it('toggles active theme and writes explicit setting to localStorage', () => {
        localStorage.setItem('swazz-theme', 'dark');
        const { result } = renderHook(() => useTheme());

        act(() => {
            result.current.toggleTheme();
        });

        expect(result.current.mode).toBe('light');
        expect(result.current.theme).toBe('light');
        expect(localStorage.getItem('swazz-theme')).toBe('light');
    });
});
