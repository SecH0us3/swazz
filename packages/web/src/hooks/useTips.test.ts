// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTips } from './useTips.js';
import { TIPS } from '../data/tips.js';

const ENABLED_KEY = 'swazz_tips_enabled';
const DISMISSED_KEY = 'swazz_dismissed_tips';
const LAST_SHOWN_KEY = 'swazz_tips_last_shown';

describe('useTips', () => {
    beforeEach(() => {
        localStorage.removeItem(ENABLED_KEY);
        localStorage.removeItem(DISMISSED_KEY);
        localStorage.removeItem(LAST_SHOWN_KEY);
    });

    it('is enabled by default', () => {
        const { result } = renderHook(() => useTips());
        expect(result.current.enabled).toBe(true);
    });

    it('selects the first non-dismissed tip', () => {
        const { result } = renderHook(() => useTips());
        expect(result.current.currentTip?.id).toBe(TIPS[0].id);
    });

    it('hides the current tip on dismissal', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.dismissTip(TIPS[0].id); });
        expect(result.current.currentTip).toBeNull();
    });

    it('returns null when all tips are dismissed', () => {
        const { result } = renderHook(() => useTips());
        act(() => { TIPS.forEach((t) => result.current.dismissTip(t.id)); });
        expect(result.current.currentTip).toBeNull();
    });

    it('persists dismissed tips to localStorage', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.dismissTip(TIPS[0].id); });
        expect(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')).toContain(TIPS[0].id);
    });

    it('resetDismissed restores the pool', () => {
        const { result } = renderHook(() => useTips());
        act(() => {
            result.current.dismissTip(TIPS[0].id);
            result.current.resetDismissed();
        });
        expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    });

    it('setEnabled(false) hides current tip and persists', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.setEnabled(false); });
        expect(result.current.enabled).toBe(false);
        expect(result.current.currentTip).toBeNull();
        expect(localStorage.getItem(ENABLED_KEY)).toBe('false');
    });

    it('setEnabled(true) does not immediately show a tip within the cooldown', () => {
        const { result } = renderHook(() => useTips());
        act(() => {
            result.current.setEnabled(false);
            result.current.setEnabled(true);
        });
        expect(result.current.enabled).toBe(true);
        expect(result.current.currentTip).toBeNull();
    });
});

describe('useTips cooldown', () => {
    beforeEach(() => {
        localStorage.removeItem(ENABLED_KEY);
        localStorage.removeItem(DISMISSED_KEY);
        localStorage.removeItem(LAST_SHOWN_KEY);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows a tip on mount when no tip was shown before', () => {
        const { result } = renderHook(() => useTips());
        expect(result.current.currentTip?.id).toBe(TIPS[0].id);
        expect(localStorage.getItem(LAST_SHOWN_KEY)).not.toBeNull();
    });

    it('does not show a tip again within 24h', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.dismissTip(TIPS[0].id); });
        expect(result.current.currentTip).toBeNull();
        // advance 23h total (still within the 24h cooldown)
        vi.setSystemTime(new Date('2026-01-01T22:00:00Z'));
        act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
        expect(result.current.currentTip).toBeNull();
    });

    it('shows the next tip after 24h while the session stays open', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.dismissTip(TIPS[0].id); });
        // advance 24h
        vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
        act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
        expect(result.current.currentTip?.id).toBe(TIPS[1].id);
    });

    it('does not show when disabled', () => {
        localStorage.setItem(ENABLED_KEY, 'false');
        const { result } = renderHook(() => useTips());
        expect(result.current.currentTip).toBeNull();
    });

    it('setEnabled(false) hides the current tip', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.setEnabled(false); });
        expect(result.current.currentTip).toBeNull();
    });
});
