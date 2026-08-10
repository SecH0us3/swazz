// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useCallback, useEffect } from 'react';
import { TIPS } from '../data/tips.js';
import type { Tip } from '../data/tips.js';

const ENABLED_KEY = 'swazz_tips_enabled';
const DISMISSED_KEY = 'swazz_dismissed_tips';

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

export function useTips() {
    const [enabled, setEnabledState] = useState<boolean>(() => readEnabled());
    const [dismissed, setDismissedState] = useState<string[]>(() => readDismissed());
    const [currentTip, setCurrentTip] = useState<Tip | null>(null);

    useEffect(() => {
        if (!enabled) { setCurrentTip(null); return; }
        setCurrentTip(TIPS.find((t) => !dismissed.includes(t.id)) ?? null);
    }, [enabled, dismissed]);

    const dismissTip = useCallback((id: string) => {
        setDismissedState((prev) => {
            if (prev.includes(id)) return prev;
            const next = [...prev, id];
            writeDismissed(next);
            return next;
        });
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
    }, []);

    return { enabled, currentTip, dismissTip, resetDismissed, setEnabled };
}
