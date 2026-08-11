// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useCallback, useEffect, useRef } from 'react';
import { TIPS } from '../data/tips.js';
import type { Tip } from '../data/tips.js';

const ENABLED_KEY = 'swazz_tips_enabled';
const DISMISSED_KEY = 'swazz_dismissed_tips';
const LAST_SHOWN_KEY = 'swazz_tips_last_shown';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function readEnabled(): boolean {
    try { return localStorage.getItem(ENABLED_KEY) !== 'false'; }
    catch { return true; }
}

function readDismissed(): string[] {
    try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
}

function writeDismissed(ids: string[]) {
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids)); }
    catch { /* ignore */ }
}

function readLastShown(): number {
    try {
        const raw = localStorage.getItem(LAST_SHOWN_KEY);
        const n = raw ? Number(raw) : 0;
        return Number.isFinite(n) ? n : 0;
    } catch { return 0; }
}

function writeLastShown(ts: number) {
    try { localStorage.setItem(LAST_SHOWN_KEY, String(ts)); }
    catch { /* ignore */ }
}

function nextTip(dismissed: string[]): Tip | null {
    return TIPS.find((t) => !dismissed.includes(t.id)) ?? null;
}

export function useTips() {
    const [enabled, setEnabledState] = useState<boolean>(() => readEnabled());
    const [dismissed, setDismissedState] = useState<string[]>(() => readDismissed());
    const [currentTip, setCurrentTip] = useState<Tip | null>(null);
    const lastShownRef = useRef<number>(readLastShown());

    const maybeShow = useCallback(() => {
        if (!enabled) { setCurrentTip(null); return; }
        const now = Date.now();
        if (lastShownRef.current !== 0 && now - lastShownRef.current < DAY_MS) return;
        const tip = nextTip(dismissed);
        if (!tip) { setCurrentTip(null); return; }
        lastShownRef.current = now;
        writeLastShown(now);
        setCurrentTip(tip);
    }, [enabled, dismissed]);

    useEffect(() => {
        maybeShow();
    }, [maybeShow]);

    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(maybeShow, CHECK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [enabled, maybeShow]);

    const dismissTip = useCallback((id: string) => {
        setDismissedState((prev) => {
            if (prev.includes(id)) return prev;
            const next = [...prev, id];
            writeDismissed(next);
            return next;
        });
        setCurrentTip(null);
    }, []);

    const resetDismissed = useCallback(() => {
        setDismissedState((prev) => {
            if (prev.length === 0) return prev;
            try { localStorage.removeItem(DISMISSED_KEY); } catch { /* ignore */ }
            return [];
        });
    }, []);

    const setEnabled = useCallback((value: boolean) => {
        try { localStorage.setItem(ENABLED_KEY, value ? 'true' : 'false'); } catch { /* ignore */ }
        setEnabledState(value);
        if (!value) setCurrentTip(null);
    }, []);

    return { enabled, currentTip, dismissTip, resetDismissed, setEnabled };
}
