// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';
import type { SwazzConfig, FuzzProfile } from '../types.js';
import { getBrowserModelContext, registerSwazzWebMcpTools } from '../services/webMcpService.js';

interface UseWebMcpOptions {
    enabled: boolean;
    updateConfig: (partial: Partial<SwazzConfig>) => void;
    updateProfiles: (profiles: FuzzProfile[]) => void;
    startScan: () => Promise<void> | void;
}

export function useWebMcp({ enabled, updateConfig, updateProfiles, startScan }: UseWebMcpOptions): void {
    const callbacksRef = useRef({ updateConfig, updateProfiles, startScan });
    callbacksRef.current = { updateConfig, updateProfiles, startScan };

    useEffect(() => {
        if (!enabled) return;
        const modelContext = getBrowserModelContext();
        if (!modelContext) return;

        return registerSwazzWebMcpTools(modelContext, {
            getState: () => useAppStore.getState(),
            setState: (partial) => useAppStore.setState(partial),
            updateConfig: (partial) => callbacksRef.current.updateConfig(partial),
            updateProfiles: (profiles) => callbacksRef.current.updateProfiles(profiles),
            startScan: () => callbacksRef.current.startScan(),
        });
    }, [enabled]);
}
