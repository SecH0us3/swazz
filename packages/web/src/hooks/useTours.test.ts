// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTours } from './useTours.js';
import { TOURS } from '../data/tours.js';
import { useAppStore } from '../store/appStore.js';

const COMPLETED_KEY = 'swazz_tour_completed';
const DISABLED_KEY = 'swazz_tours_disabled';

function fireTourEvent(tourId: string) {
    window.dispatchEvent(new CustomEvent('swazz:tour', { detail: { tourId } }));
}

describe('useTours', () => {
    beforeEach(() => {
        localStorage.removeItem(COMPLETED_KEY);
        localStorage.removeItem(DISABLED_KEY);
        useAppStore.setState({ activeTab: 'heatmap' });
    });

    it('does not start a tour when disabled', () => {
        localStorage.setItem(DISABLED_KEY, 'true');
        const { result } = renderHook(() => useTours());
        act(() => { result.current.startTour(TOURS[0].id); });
        expect(result.current.isActive).toBe(false);
    });

    it('starts a tour on event trigger', () => {
        const { result } = renderHook(() => useTours());
        act(() => { fireTourEvent(TOURS[0].id); });
        expect(result.current.activeTourId).toBe(TOURS[0].id);
    });

    it('starts a tour on screen visit', () => {
        const { result } = renderHook(() => useTours());
        act(() => { useAppStore.setState({ activeTab: 'project_settings' }); });
        expect(result.current.activeTourId).toBe('project-settings-first');
    });

    it('advances steps and finishes', () => {
        const tour = TOURS[0];
        const { result } = renderHook(() => useTours());
        act(() => { result.current.startTour(tour.id); });
        expect(result.current.currentStep).toBe(0);
        act(() => { result.current.next(); });
        expect(result.current.currentStep).toBe(1);
        act(() => { result.current.skip(); });
        expect(result.current.isActive).toBe(false);
        expect(JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]')).toContain(tour.id);
    });

    it('does not auto-trigger an already completed tour', () => {
        localStorage.setItem(COMPLETED_KEY, JSON.stringify(['project-settings-first']));
        const { result } = renderHook(() => useTours());
        act(() => { useAppStore.setState({ activeTab: 'project_settings' }); });
        expect(result.current.isActive).toBe(false);
    });

    it('allows manual start even when completed', () => {
        localStorage.setItem(COMPLETED_KEY, JSON.stringify([TOURS[0].id]));
        const { result } = renderHook(() => useTours());
        act(() => { result.current.startTour(TOURS[0].id); });
        expect(result.current.activeTourId).toBe(TOURS[0].id);
    });

    it('resetAll clears completed tours', () => {
        const { result } = renderHook(() => useTours());
        act(() => {
            result.current.startTour(TOURS[0].id);
            result.current.skip();
            result.current.resetAll();
        });
        expect(localStorage.getItem(COMPLETED_KEY)).toBeNull();
    });
});
