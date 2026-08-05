// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useEffect } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

function getSystemTheme(): ResolvedTheme {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        try {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        } catch {
            return 'light';
        }
    }
    return 'light';
}

export function useTheme() {
    const [mode, setModeState] = useState<ThemeMode>(() => {
        const saved = localStorage.getItem('swazz-theme');
        if (saved === 'light' || saved === 'dark') return saved;
        return 'system';
    });

    const theme: ResolvedTheme = mode === 'system' ? getSystemTheme() : mode;

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        document.body.classList.remove('dark', 'light');
        document.body.classList.add(theme);
    }, [theme]);

    const setMode = (newMode: ThemeMode) => {
        if (newMode === 'system') {
            localStorage.removeItem('swazz-theme');
        } else {
            localStorage.setItem('swazz-theme', newMode);
        }
        setModeState(newMode);
    };

    const toggleTheme = () => {
        const nextTheme: ResolvedTheme = theme === 'dark' ? 'light' : 'dark';
        setMode(nextTheme);
    };

    const setTheme = (newTheme: ResolvedTheme) => {
        setMode(newTheme);
    };

    return { mode, theme, setMode, toggleTheme, setTheme };
}
