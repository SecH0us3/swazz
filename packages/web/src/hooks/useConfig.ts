/**
 * useConfig — manages SwazzConfig in localStorage.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SwazzConfig, SwazzSettings, Dictionary, FuzzingProfile } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import { useAppStore } from '../store/appStore.js';

const STORAGE_KEY = 'swazz:config';

const DEFAULT_CONFIG: SwazzConfig = {
    base_url: '',
    global_headers: {},
    cookies: {},
    dictionaries: {},
    settings: { ...DEFAULT_SETTINGS },
    endpoints: [],
    disabled_endpoints: [],
    _swagger_urls: [],
    security: { allow_private_ips: false },
    rules: { ignore: [] },
};

export function validateConfig(config: any): void {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Config must be a JSON object');
    }
    if (config.base_url !== undefined && typeof config.base_url !== 'string') {
        throw new Error('base_url must be a string');
    }
    if (config.global_headers !== undefined && (typeof config.global_headers !== 'object' || config.global_headers === null)) {
        throw new Error('global_headers must be an object');
    }
    if (config.cookies !== undefined && (typeof config.cookies !== 'object' || config.cookies === null)) {
        throw new Error('cookies must be an object');
    }
    if (config.dictionaries !== undefined && (typeof config.dictionaries !== 'object' || config.dictionaries === null)) {
        throw new Error('dictionaries must be an object');
    }
    if (config.settings !== undefined) {
        if (typeof config.settings !== 'object' || config.settings === null) {
            throw new Error('settings must be an object');
        }
        const s = config.settings;
        if (s.iterations_per_profile !== undefined && typeof s.iterations_per_profile !== 'number') {
            throw new Error('settings.iterations_per_profile must be a number');
        }
        if (s.concurrency !== undefined && typeof s.concurrency !== 'number') {
            throw new Error('settings.concurrency must be a number');
        }
        if (s.timeout_ms !== undefined && typeof s.timeout_ms !== 'number') {
            throw new Error('settings.timeout_ms must be a number');
        }
        if (s.max_payload_size_bytes !== undefined && typeof s.max_payload_size_bytes !== 'number') {
            throw new Error('settings.max_payload_size_bytes must be a number');
        }
        if (s.delay_between_requests_ms !== undefined && typeof s.delay_between_requests_ms !== 'number') {
            throw new Error('settings.delay_between_requests_ms must be a number');
        }
        if (s.profiles !== undefined && !Array.isArray(s.profiles)) {
            throw new Error('settings.profiles must be an array');
        }
        if (s.bola_similarity_threshold !== undefined && typeof s.bola_similarity_threshold !== 'number') {
            throw new Error('settings.bola_similarity_threshold must be a number');
        }
        if (s.time_anomaly_threshold_ms !== undefined && typeof s.time_anomaly_threshold_ms !== 'number') {
            throw new Error('settings.time_anomaly_threshold_ms must be a number');
        }
        if (s.oob_server_url !== undefined && typeof s.oob_server_url !== 'string') {
            throw new Error('settings.oob_server_url must be a string');
        }
        if (s.debug !== undefined && typeof s.debug !== 'boolean') {
            throw new Error('settings.debug must be a boolean');
        }
    }
    if (config.endpoints !== undefined && !Array.isArray(config.endpoints)) {
        throw new Error('endpoints must be an array');
    }
    if (config.disabled_endpoints !== undefined && !Array.isArray(config.disabled_endpoints)) {
        throw new Error('disabled_endpoints must be an array');
    }
    if (config._swagger_urls !== undefined && !Array.isArray(config._swagger_urls)) {
        throw new Error('_swagger_urls must be an array');
    }
    if (config.wordlist_files !== undefined && (typeof config.wordlist_files !== 'object' || config.wordlist_files === null)) {
        throw new Error('wordlist_files must be an object');
    }
    if (config.auth_sequence !== undefined && !Array.isArray(config.auth_sequence)) {
        throw new Error('auth_sequence must be an array');
    }
    if (config.auth_identities !== undefined && (typeof config.auth_identities !== 'object' || config.auth_identities === null)) {
        throw new Error('auth_identities must be an object');
    }
    if (config.security !== undefined) {
        if (typeof config.security !== 'object' || config.security === null) {
            throw new Error('security must be an object');
        }
        if (config.security.allow_private_ips !== undefined && typeof config.security.allow_private_ips !== 'boolean') {
            throw new Error('security.allow_private_ips must be a boolean');
        }
    }
    if (config.rules !== undefined) {
        if (typeof config.rules !== 'object' || config.rules === null) {
            throw new Error('rules must be an object');
        }
        if (config.rules.ignore !== undefined && !Array.isArray(config.rules.ignore)) {
            throw new Error('rules.ignore must be an array');
        }
    }
}

function loadConfig(): SwazzConfig {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                ...DEFAULT_CONFIG,
                ...parsed,
                settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
                security: parsed.security ? { ...DEFAULT_CONFIG.security, ...parsed.security } : DEFAULT_CONFIG.security,
            };
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
    const activeProject = useAppStore(state => state.activeProject);
    let token: string | null = null;
    try {
        token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    } catch { /* ignore */ }
    const storageKey = token && activeProject ? `${STORAGE_KEY}:${activeProject.id}` : STORAGE_KEY;

    const [config, setConfig] = useState<SwazzConfig>(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                return {
                    ...DEFAULT_CONFIG,
                    ...parsed,
                    settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
                    security: parsed.security ? { ...DEFAULT_CONFIG.security, ...parsed.security } : DEFAULT_CONFIG.security,
                };
            }
        } catch { /* ignore */ }
        return { ...DEFAULT_CONFIG };
    });

    const currentKeyRef = useRef(storageKey);

    // Load config when storage key changes
    useEffect(() => {
        let active = true;

        const load = async () => {
            let loaded: SwazzConfig | null = null;

            // 1. Try server first if logged in
            if (token && activeProject) {
                try {
                    const res = await fetch(`/api/projects/${activeProject.id}/config`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.config) {
                            loaded = data.config;
                        }
                    }
                } catch (err) {
                    console.warn('[swazz] Failed to load config from server:', err);
                }
            }

            // 2. Fall back to localStorage
            if (!loaded) {
                try {
                    const stored = localStorage.getItem(storageKey);
                    if (stored) {
                        loaded = JSON.parse(stored);
                    }
                } catch { /* ignore */ }
            }

            if (!active) return;

            const finalConfig = loaded ? {
                ...DEFAULT_CONFIG,
                ...loaded,
                settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) },
                security: loaded.security ? { ...DEFAULT_CONFIG.security, ...loaded.security } : DEFAULT_CONFIG.security,
            } : { ...DEFAULT_CONFIG };

            currentKeyRef.current = storageKey;
            setConfig(finalConfig);
        };

        load();

        return () => {
            active = false;
        };
    }, [storageKey, token, activeProject]);

    // Save config to current storage key when config changes & sync to server (debounced)
    useEffect(() => {
        if (currentKeyRef.current !== storageKey) {
            return;
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify(config));
        } catch { /* ignore */ }

        if (token && activeProject) {
            const timer = setTimeout(async () => {
                try {
                    await fetch(`/api/projects/${activeProject.id}/config`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ config })
                    });
                } catch (err) {
                    console.warn('[swazz] Failed to sync config to server:', err);
                }
            }, 1500); // 1.5s debounce

            return () => clearTimeout(timer);
        }
    }, [config, storageKey, token, activeProject]);

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

    const updatePayloadCategories = useCallback((categories: Record<string, string[]>) => {
        setConfig((prev) => ({ 
            ...prev, 
            settings: { 
                ...prev.settings, 
                payload_categories: categories as Record<FuzzingProfile, string[]> 
            } 
        }));
    }, []);

    const importConfig = useCallback((json: string) => {
        try {
            const parsed = JSON.parse(json) as SwazzConfig;
            validateConfig(parsed);
            setConfig({
                ...DEFAULT_CONFIG,
                ...parsed,
                settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
                security: parsed.security ? { ...DEFAULT_CONFIG.security, ...parsed.security } : DEFAULT_CONFIG.security,
            });
        } catch (err) {
            throw new Error('Invalid JSON config: ' + (err instanceof Error ? err.message : String(err)));
        }
    }, []);

    const exportConfig = useCallback((): string => {
        const { endpoints, ...rest } = config;
        const exportedConfig = {
            ...rest,
            headers: config.global_headers || {},
            swagger_urls: config._swagger_urls || [],
            endpoints: {
                exclude: config.disabled_endpoints || []
            }
        };
        return JSON.stringify(exportedConfig, null, 2);
    }, [config]);

    return {
        config,
        updateConfig,
        updateHeaders,
        updateCookies,
        updateDictionaries,
        updateSettings,
        updateProfiles,
        updatePayloadCategories,
        importConfig,
        exportConfig,
    };
}
