// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useCallback, useEffect, useRef } from 'react';
import { TOURS } from '../data/tours.js';
import type { Tour } from '../data/tours.js';
import { useAppStore } from '../store/appStore.js';

const COMPLETED_KEY = 'swazz_tour_completed';
const DISABLED_KEY = 'swazz_tours_disabled';

function readCompleted(): string[] {
    try {
        const raw = localStorage.getItem(COMPLETED_KEY);
        if (!raw) return [];
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
}
function writeCompleted(ids: string[]) {
    try { localStorage.setItem(COMPLETED_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}
function isDisabled(): boolean {
    try { return localStorage.getItem(DISABLED_KEY) === 'true'; } catch { return false; }
}

export function dispatchTourRequest(tourId: string) {
    window.dispatchEvent(new CustomEvent('swazz:tour', { detail: { tourId } }));
}

export function useTours() {
    const [activeTourId, setActiveTourId] = useState<string | null>(null);
    const [currentStep, setCurrentStep] = useState(0);
    const [completed, setCompleted] = useState<string[]>(() => readCompleted());
    const activeTab = useAppStore((s) => s.activeTab);
    const shownInSession = useRef<Set<string>>(new Set());

    const finish = useCallback((id: string) => {
        setCompleted((prev) => {
            if (prev.includes(id)) return prev;
            const next = [...prev, id];
            writeCompleted(next);
            return next;
        });
        setActiveTourId(null);
        setCurrentStep(0);
    }, []);

    const startTour = useCallback((id: string) => {
        if (isDisabled()) return;
        const tour = TOURS.find((t) => t.id === id);
        if (!tour) return;
        setActiveTourId(id);
        setCurrentStep(0);
    }, []);

    // screen-visit trigger: skip tours already completed (and guard per-session)
    useEffect(() => {
        for (const tour of TOURS) {
            if (tour.trigger === 'screen' && tour.screen === activeTab) {
                if (shownInSession.current.has(tour.id)) continue;
                shownInSession.current.add(tour.id);
                if (completed.includes(tour.id)) continue;
                startTour(tour.id);
            }
        }
    }, [activeTab, startTour, completed]);

    // event trigger
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ tourId?: string }>).detail;
            if (detail?.tourId) startTour(detail.tourId);
        };
        window.addEventListener('swazz:tour', handler);
        return () => window.removeEventListener('swazz:tour', handler);
    }, [startTour]);

    const next = useCallback(() => {
        const tour = TOURS.find((t) => t.id === activeTourId);
        if (!tour) return;
        if (currentStep + 1 >= tour.steps.length) { finish(tour.id); return; }
        setCurrentStep((s) => s + 1);
    }, [activeTourId, currentStep, finish]);

    const back = useCallback(() => {
        setCurrentStep((s) => Math.max(0, s - 1));
    }, []);

    const skip = useCallback(() => {
        if (activeTourId) finish(activeTourId);
    }, [activeTourId, finish]);

    const resetAll = useCallback(() => {
        try { localStorage.removeItem(COMPLETED_KEY); } catch { /* ignore */ }
        setCompleted([]);
        setActiveTourId(null);
        setCurrentStep(0);
    }, []);

    return { activeTourId, currentStep, startTour, next, back, skip, isActive: !!activeTourId, resetAll };
}
