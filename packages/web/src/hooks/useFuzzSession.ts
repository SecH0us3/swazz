import { useCallback } from 'react';
import type { RunStats, SwazzConfig } from '../types.js';
import { toSummary } from './useRunner.js';
import { loadSwaggerUrl } from '../services/swaggerService.js';
import { dbStreamResult } from './useDb.js';
import type { ScanRun } from './useDb.js';
import { useAppStore } from '../store/appStore.js';

interface UseFuzzSessionProps {
    config: SwazzConfig;
    updateConfig: (updates: Partial<SwazzConfig>) => void;
    start: (config: SwazzConfig, onResult: (raw: any) => void, onComplete: (stats: RunStats) => void) => void;
    saveRun: (runRecord: ScanRun, rows?: any[]) => void;
    getDb: () => IDBDatabase | null;
    showToast: (message: string, type: 'info' | 'success' | 'error') => void;
}

export function useFuzzSession({
    config,
    updateConfig,
    start,
    saveRun,
    getDb,
    showToast,
}: UseFuzzSessionProps) {
    const loadEndpoints = useCallback(async (urls: string[], forceRebuild?: boolean) => {
        if (urls.length === 0) return;

        useAppStore.setState({ isLoadingSpecs: true });
        showToast(`${forceRebuild ? 'Refreshing' : 'Loading'} ${urls.length} spec${urls.length > 1 ? 's' : ''}...`, 'info');

        let allEndpoints: any[] = [];
        let detectedBaseUrl = config.base_url;

        for (const url of urls) {
            try {
                const urlToLoad = url.startsWith('http') ? url : `https://${url}`;
                const { basePath, endpoints, endpointCount, cachedAt } = await loadSwaggerUrl(
                    urlToLoad,
                    config.global_headers,
                    config.cookies,
                    forceRebuild,
                );
                allEndpoints = allEndpoints.concat(endpoints);
                if (!detectedBaseUrl && basePath) {
                    try {
                        const u = new URL(basePath);
                        detectedBaseUrl = u.origin;
                    } catch {
                        detectedBaseUrl = basePath;
                    }
                }

                // Update cache date in global store
                const cacheState = { ...useAppStore.getState().specCacheDates };
                if (cachedAt) {
                    cacheState[url] = cachedAt;
                } else {
                    cacheState[url] = new Date().toISOString();
                }
                useAppStore.setState({ specCacheDates: cacheState });

                showToast(`✓ ${endpointCount} endpoints from ${new URL(urlToLoad).hostname}${cachedAt ? ' (from cache)' : ''}`, 'success');
            } catch (err) {
                showToast(`✗ Failed: ${url} — ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
        }

        useAppStore.setState({ isLoadingSpecs: false });

        if (allEndpoints.length > 0) {
            updateConfig({ base_url: detectedBaseUrl, endpoints: allEndpoints } as any);
            return { detectedBaseUrl, allEndpoints };
        }
        return null;
    }, [config.base_url, config.global_headers, config.cookies, updateConfig, showToast]);

    const handleStart = async (overrideUrls?: string[], overrideBaseUrl?: string) => {
        const runId = crypto.randomUUID();
        const swaggerUrls: string[] = overrideUrls || config._swagger_urls || [];

        if (swaggerUrls.length === 0 && config.endpoints.length === 0) {
            showToast('Add at least one Swagger URL to begin', 'error');
            return;
        }

        let finalEndpoints = config.endpoints;
        let finalBaseUrl = overrideBaseUrl || config.base_url;

        if (finalBaseUrl) {
            let cleanUrl = finalBaseUrl.trim();
            if (cleanUrl) {
                try {
                    const u = new URL(cleanUrl);
                    cleanUrl = u.origin;
                } catch {
                    // Not a full URL, leave as is
                }
                finalBaseUrl = cleanUrl;
                if (cleanUrl !== config.base_url) {
                    updateConfig({ base_url: cleanUrl });
                }
            }
        }

        if (overrideUrls || (swaggerUrls.length > 0 && config.endpoints.length === 0)) {
            const loaded = await loadEndpoints(swaggerUrls);
            if (loaded) {
                finalEndpoints = loaded.allEndpoints;
                finalBaseUrl = loaded.detectedBaseUrl;
                if (overrideUrls) {
                    updateConfig({ base_url: finalBaseUrl, _swagger_urls: swaggerUrls });
                }
            } else {
                return;
            }
        }

        const activeEndpoints = finalEndpoints.filter(
            ep => !config.disabled_endpoints?.includes(`${ep.method} ${ep.path}`)
        );

        if (activeEndpoints.length === 0) {
            showToast('No active endpoints to fuzz', 'error');
            return;
        }

        const finalConfig: SwazzConfig = {
            ...config,
            base_url: finalBaseUrl,
            endpoints: activeEndpoints,
        };
        delete finalConfig.disabled_endpoints;

        const activeProject = useAppStore.getState().activeProject;
        const runRec: ScanRun = {
            id: runId,
            startedAt: Date.now(),
            completedAt: 0,
            baseUrl: finalBaseUrl,
            stats: null as any,
            projectId: activeProject ? activeProject.id : undefined,
        };

        // Save the run metadata immediately so it appears in history
        await saveRun(runRec);

        // Notify App about new run — it switches to live view for this runId
        useAppStore.setState({
            liveRunId: runId,
            liveCount: 0,
            heatmapFilter: null,
            selectedResult: null,
            loadedRunId: null,
            activeTab: 'heatmap',
            stats: null,
        });

        let liveCount = 0;
        let lastCountUpdate = 0;

        /**
         * onResult: called per SSE event.
         * We convert to a ResultSummary and write to IDB directly.
         * No React state is touched here — only the db write + throttled counter.
         */
        const onResult = (raw: any) => {
            const db = getDb();
            if (!db) return;

            const summary = toSummary(raw);
            // Fire-and-forget IDB write — no await needed in the hot path
            dbStreamResult(db, runId, summary).catch((err) => {
                console.warn('[swazz] IDB write error:', err);
            });

            liveCount++;
            const now = Date.now();
            if (now - lastCountUpdate > 500) {
                lastCountUpdate = now;
                useAppStore.setState({ liveCount });
            }
        };

        const onComplete = (finalStats: RunStats) => {
            const completedRun: ScanRun = { ...runRec, completedAt: Date.now(), stats: finalStats };
            saveRun(completedRun);
            useAppStore.setState({
                liveCount,
            });
            showToast(`Scan complete — ${liveCount.toLocaleString()} requests saved`, 'success');
        };

        try {
            await start(finalConfig, onResult, onComplete);
            showToast(
                `Fuzzing ${activeEndpoints.length} endpoint${activeEndpoints.length > 1 ? 's' : ''}...`,
                'info',
            );
        } catch (err: any) {
            let msg = err.message || 'Failed to start run';
            if (msg.includes('already in progress')) {
                msg = 'Server is busy. Please wait for the current run to complete.';
            }
            showToast(`Error: ${msg}`, 'error');
            useAppStore.setState({ liveRunId: null });
        }
    };

    return { loadEndpoints, handleStart };
}
