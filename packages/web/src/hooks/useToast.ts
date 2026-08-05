// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useCallback, useEffect } from 'react';
import type { ToastData } from '../components/Toast/Toast.js';

let globalToasts: ToastData[] = [];
const listeners = new Set<(toasts: ToastData[]) => void>();

export function useToast() {
    const [toasts, setToasts] = useState<ToastData[]>(globalToasts);

    useEffect(() => {
        listeners.add(setToasts);
        return () => {
            listeners.delete(setToasts);
        };
    }, []);

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const id = Date.now();
        globalToasts = [...globalToasts.slice(-4), { id, message, type }];
        listeners.forEach((listener) => listener(globalToasts));
    }, []);

    const dismissToast = useCallback((id: number) => {
        globalToasts = globalToasts.filter((t) => t.id !== id);
        listeners.forEach((listener) => listener(globalToasts));
    }, []);

    return { toasts, showToast, dismissToast };
}

export function resetToasts() {
    globalToasts = [];
    listeners.clear();
}
