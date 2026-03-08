/**
 * useConfig — manages SwazzConfig in localStorage.
 */

import { useState, useCallback, useEffect } from 'react';
import type { SwazzConfig, SwazzSettings, Dictionary, FuzzingProfile } from '@swazz/core';
import { DEFAULT_SETTINGS } from '@swazz/core';

const STORAGE_KEY = 'swazz:config';

const DEFAULT_CONFIG: SwazzConfig & { _swagger_urls?: string[] } = {
    base_url: '',
    global_headers: {},
    cookies: {},
    dictionaries: {},
    settings: { ...DEFAULT_SETTINGS },
    endpoints: [],
    disabled_endpoints: [],
    _swagger_urls: [],
};

function loadConfig(): SwazzConfig {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return { ...DEFAULT_CONFIG, ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
        }
    } catch { /* ignore */ }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(config: SwazzConfig): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch { /* ignore */ }
}

export function useConfig() {
    const [config, setConfig] = useState<SwazzConfig>(loadConfig);

    useEffect(() => {
        saveConfig(config);
    }, [config]);

    const updateConfig = useCallback((partial: Partial<SwazzConfig>) => {
        setConfig((prev) => ({ ...prev, ...partial }));
    }, []);

    const updateHeaders = useCallback((headers: Record<string, string>) => {
        setConfig((prev) => ({ ...prev, global_headers: headers }));
    }, []);

    const updateCookies = useCallback((cookies: Record<string, string>) => {
        setConfig((prev) => ({ ...prev, cookies }));
    }, []);

    const updateDictionaries = useCallback((dictionaries: Dictionary) => {
        setConfig((prev) => ({ ...prev, dictionaries }));
    }, []);

    const updateSettings = useCallback((settings: Partial<SwazzSettings>) => {
        setConfig((prev) => ({ ...prev, settings: { ...prev.settings, ...settings } }));
    }, []);

    const updateProfiles = useCallback((profiles: FuzzingProfile[]) => {
        setConfig((prev) => ({ ...prev, settings: { ...prev.settings, profiles } }));
    }, []);

    const importConfig = useCallback((json: string) => {
        try {
            const parsed = JSON.parse(json) as SwazzConfig;
            setConfig({
                ...DEFAULT_CONFIG,
                ...parsed,
                settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
            });
        } catch (err) {
            throw new Error('Invalid JSON config: ' + (err instanceof Error ? err.message : String(err)));
        }
    }, []);

    const exportConfig = useCallback((): string => {
        return JSON.stringify(config, null, 2);
    }, [config]);

    return {
        config,
        updateConfig,
        updateHeaders,
        updateCookies,
        updateDictionaries,
        updateSettings,
        updateProfiles,
        importConfig,
        exportConfig,
    };
}
