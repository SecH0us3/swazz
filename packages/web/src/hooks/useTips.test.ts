// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTips } from './useTips.js';
import { TIPS } from '../data/tips.js';

const ENABLED_KEY = 'swazz_tips_enabled';
const DISMISSED_KEY = 'swazz_dismissed_tips';

describe('useTips', () => {
    beforeEach(() => {
        localStorage.removeItem(ENABLED_KEY);
        localStorage.removeItem(DISMISSED_KEY);
    });

    it('is enabled by default', () => {
        const { result } = renderHook(() => useTips());
        expect(result.current.enabled).toBe(true);
    });

    it('selects the first non-dismissed tip', () => {
        const { result } = renderHook(() => useTips());
        expect(result.current.currentTip?.id).toBe(TIPS[0].id);
    });

    it('advances to the next tip after dismissal', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.dismissTip(TIPS[0].id); });
        expect(result.current.currentTip?.id).toBe(TIPS[1].id);
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
        expect(result.current.currentTip?.id).toBe(TIPS[0].id);
        expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    });

    it('setEnabled(false) hides current tip and persists', () => {
        const { result } = renderHook(() => useTips());
        act(() => { result.current.setEnabled(false); });
        expect(result.current.enabled).toBe(false);
        expect(result.current.currentTip).toBeNull();
        expect(localStorage.getItem(ENABLED_KEY)).toBe('false');
    });

    it('setEnabled(true) restores tip display', () => {
        const { result } = renderHook(() => useTips());
        act(() => {
            result.current.setEnabled(false);
            result.current.setEnabled(true);
        });
        expect(result.current.enabled).toBe(true);
        expect(result.current.currentTip).not.toBeNull();
    });
});
