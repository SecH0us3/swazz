import { useState, useCallback } from 'react';
import type { FuzzResult, RunStats, SwazzConfig } from '@swazz/core';
import type { ResultSummary } from './useRunner.js';
import { loadSwaggerUrl } from '../services/swaggerService.js';
import { previewPayload, previewResponse } from './useRunner.js';

interface UseFuzzSessionProps {
    config: SwazzConfig;
    updateConfig: (updates: Partial<SwazzConfig>) => void;
    start: (config: SwazzConfig, onResult: (r: FuzzResult) => void, onComplete: (stats: RunStats) => void) => void;
    saveRun: (runRecord: any, rows: ResultSummary[]) => void;
    showToast: (message: string, type: 'info' | 'success' | 'error') => void;
    onRunStarted: () => void;
}

export function useFuzzSession({
    config,
    updateConfig,
    start,
    saveRun,
    showToast,
    onRunStarted,
}: UseFuzzSessionProps) {
    const [isLoadingSpecs, setIsLoadingSpecs] = useState(false);
    const [currentRunId, setCurrentRunId] = useState<string | null>(null);

    const loadEndpoints = useCallback(async (urls: string[]) => {
        if (urls.length === 0) return;

        setIsLoadingSpecs(true);
        showToast(`Loading ${urls.length} spec${urls.length > 1 ? 's' : ''}...`, 'info');

        let allEndpoints: any[] = [];
        let detectedBaseUrl = config.base_url;

        for (const url of urls) {
            try {
                const urlToLoad = url.startsWith('http') ? url : `https://${url}`;
                const { basePath, endpoints, endpointCount } = await loadSwaggerUrl(
                    urlToLoad,
                    config.global_headers,
                    config.cookies,
                );
                allEndpoints = [...allEndpoints, ...endpoints];
                if (!detectedBaseUrl && basePath) {
                    detectedBaseUrl = basePath;
                }
                showToast(`✓ ${endpointCount} endpoints from ${new URL(urlToLoad).hostname}`, 'success');
            } catch (err) {
                showToast(`✗ Failed: ${url} — ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
        }

        setIsLoadingSpecs(false);

        if (allEndpoints.length > 0) {
            updateConfig({ base_url: detectedBaseUrl, endpoints: allEndpoints } as any);
            return { detectedBaseUrl, allEndpoints };
        }
        return null;
    }, [config.base_url, config.global_headers, config.cookies, updateConfig, showToast]);

    const handleStart = async (overrideUrls?: string[]) => {
        const swaggerUrls: string[] = overrideUrls || (config as any)._swagger_urls || [];

        if (swaggerUrls.length === 0 && config.endpoints.length === 0) {
            showToast('Add at least one Swagger URL to begin', 'error');
            return;
        }

        onRunStarted();

        let finalEndpoints = config.endpoints;
        let finalBaseUrl = config.base_url;

        if (overrideUrls || (swaggerUrls.length > 0 && config.endpoints.length === 0)) {
            const loaded = await loadEndpoints(swaggerUrls);
            if (loaded) {
                finalEndpoints = loaded.allEndpoints;
                finalBaseUrl = loaded.detectedBaseUrl;
                if (overrideUrls) {
                    updateConfig({
                        base_url: finalBaseUrl,
                        _swagger_urls: swaggerUrls,
                    } as any);
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

        const finalConfig = {
            ...config,
            base_url: finalBaseUrl,
            endpoints: activeEndpoints,
        } as SwazzConfig;

        const runId = `run_${Date.now()}`;
        setCurrentRunId(runId);
        const runRec = {
            id: runId,
            startedAt: Date.now(),
            completedAt: 0,
            baseUrl: finalBaseUrl,
            stats: null as any,
        };

        let pendingRows: ResultSummary[] = [];

        const onResult = (result: FuzzResult) => {
            pendingRows.push({
                id: result.id,
                timestamp: result.timestamp,
                method: result.method,
                endpoint: result.endpoint,
                resolvedPath: result.resolvedPath,
                status: result.status,
                profile: result.profile,
                duration: result.duration,
                retries: result.retries,
                payloadPreview: previewPayload(result.payload),
                responsePreview: previewResponse(result.responseBody),
                error: result.error,
            });
            if (pendingRows.length >= 50) {
                saveRun(runRec, [...pendingRows]);
                pendingRows = [];
            }
        };

        const onComplete = (stats: RunStats) => {
            const completedRun = { ...runRec, completedAt: Date.now(), stats };
            saveRun(completedRun, pendingRows);
            setCurrentRunId(null);
            showToast(`Scan saved to history`, 'success');
        };

        start(finalConfig, onResult, onComplete);

        showToast(
            `Fuzzing ${activeEndpoints.length} endpoint${activeEndpoints.length > 1 ? 's' : ''}...`,
            'info',
        );
    };

    return { isLoadingSpecs, currentRunId, loadEndpoints, handleStart };
}
