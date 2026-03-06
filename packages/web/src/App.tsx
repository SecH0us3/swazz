import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { FuzzResult } from '@swazz/core';
import { parseSwaggerSpec } from '@swazz/core';
import { useConfig } from './hooks/useConfig.js';
import { useRunner } from './hooks/useRunner.js';
import { Header } from './components/Header.js';
import { SetupPanel } from './components/SetupPanel.js';
import { Dashboard } from './components/Dashboard/Dashboard.js';
import { Inspector } from './components/Inspector/Inspector.js';
import { RequestDetail } from './components/Inspector/RequestDetail.js';

// In dev, proxy goes to local wrangler via Vite proxy; in prod, use deployed Worker URL
const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

// ─── Toast ───────────────────────────────────────────────────

interface ToastData {
    id: number;
    message: string;
    type: 'info' | 'success' | 'error';
}

function Toast({ message, type, onDismiss }: { message: string; type: string; onDismiss: () => void }) {
    const borderColor =
        type === 'error' ? 'var(--color-error)' :
            type === 'success' ? 'var(--color-success)' :
                'var(--color-info)';

    useEffect(() => {
        const timer = setTimeout(onDismiss, 4000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className="toast" style={{ borderLeft: `3px solid ${borderColor}` }} onClick={onDismiss}>
            {message}
        </div>
    );
}

// ─── Swagger loader ──────────────────────────────────────────

async function loadSwaggerUrl(
    url: string,
    headers: Record<string, string>,
    cookies: Record<string, string>,
): Promise<{ basePath: string; endpointCount: number; endpoints: any[] }> {
    let specText: string;
    try {
        const res = await fetch(`${PROXY_URL}/proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, method: 'GET', headers, cookies }),
        });
        const result = await res.json();
        specText = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    } catch {
        // Direct fetch fallback
        const res = await fetch(url);
        specText = await res.text();
    }

    const spec = JSON.parse(specText);
    const { basePath, endpoints } = parseSwaggerSpec(spec);
    return { basePath, endpointCount: endpoints.length, endpoints };
}

// ─── App ─────────────────────────────────────────────────────

export default function App() {
    const {
        config,
        updateConfig,
        updateHeaders,
        updateCookies,
        updateDictionaries,
        updateProfiles,
        importConfig,
        exportConfig,
    } = useConfig();

    const {
        results,
        stats,
        isRunning,
        isPaused,
        start,
        stop,
        pause,
        resume,
    } = useRunner(PROXY_URL);

    const [selectedResult, setSelectedResult] = useState<FuzzResult | null>(null);
    const [toasts, setToasts] = useState<ToastData[]>([]);
    const [isLoadingSpecs, setIsLoadingSpecs] = useState(false);

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const id = Date.now();
        setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const endpointPaths = useMemo(
        () => config.endpoints.map((ep) => ep.path),
        [config.endpoints],
    );

    // Resolved base URL — from config or taken from the first loaded spec
    const displayUrl = config.base_url || ((config as any)._swagger_urls?.[0] ?? '');

    const handleStart = async () => {
        const swaggerUrls: string[] = (config as any)._swagger_urls || [];

        if (swaggerUrls.length === 0 && config.endpoints.length === 0) {
            showToast('Add at least one Swagger URL to begin', 'error');
            return;
        }

        // If we have Swagger URLs, load them first
        if (swaggerUrls.length > 0) {
            setIsLoadingSpecs(true);
            showToast(`Loading ${swaggerUrls.length} spec${swaggerUrls.length > 1 ? 's' : ''}...`, 'info');

            let allEndpoints: any[] = [];
            let detectedBaseUrl = config.base_url;

            for (const url of swaggerUrls) {
                try {
                    const { basePath, endpoints, endpointCount } = await loadSwaggerUrl(
                        url,
                        config.global_headers,
                        config.cookies,
                    );
                    allEndpoints = [...allEndpoints, ...endpoints];
                    if (!detectedBaseUrl && basePath) {
                        detectedBaseUrl = basePath;
                    }
                    showToast(`✓ ${endpointCount} endpoints from ${new URL(url).hostname}`, 'success');
                } catch (err) {
                    showToast(`✗ Failed: ${url} — ${err instanceof Error ? err.message : String(err)}`, 'error');
                }
            }

            setIsLoadingSpecs(false);

            if (allEndpoints.length === 0) {
                showToast('No endpoints found in the provided specs', 'error');
                return;
            }

            const finalConfig = {
                ...config,
                base_url: detectedBaseUrl,
                endpoints: allEndpoints,
            };

            // Persist endpoints + resolved base url for session
            updateConfig({ base_url: detectedBaseUrl, endpoints: allEndpoints });

            start(finalConfig);
            showToast(
                `Fuzzing ${allEndpoints.length} endpoint${allEndpoints.length > 1 ? 's' : ''} across ${swaggerUrls.length} spec${swaggerUrls.length > 1 ? 's' : ''}...`,
                'info',
            );
        } else {
            // Use already-loaded endpoints
            if (!config.base_url) {
                showToast('Please set a base URL', 'error');
                return;
            }
            start(config);
            showToast(`Fuzzing ${config.endpoints.length} endpoints...`, 'info');
        }
    };

    const isBusy = isRunning || isLoadingSpecs;

    return (
        <div className="app-layout">
            <Header
                baseUrl={displayUrl}
                isRunning={isBusy}
                isPaused={isPaused}
                isLoadingSpecs={isLoadingSpecs}
                onStart={handleStart}
                onStop={stop}
                onPause={pause}
                onResume={resume}
            />

            <SetupPanel
                config={config}
                isRunning={isBusy}
                isPaused={isPaused}
                onUpdateHeaders={updateHeaders}
                onUpdateCookies={updateCookies}
                onUpdateDictionaries={updateDictionaries}
                onUpdateProfiles={updateProfiles}
                onUpdateConfig={updateConfig}
                onImportConfig={importConfig}
                onExportConfig={exportConfig}
                onToast={showToast}
            />

            <div className="main-area">
                <Dashboard stats={stats} results={results} endpointPaths={endpointPaths} />
                <Inspector results={results} onSelectResult={setSelectedResult} />
            </div>

            {selectedResult && (
                <RequestDetail result={selectedResult} onClose={() => setSelectedResult(null)} />
            )}

            {/* Toast stack */}
            <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
                {toasts.map((t) => (
                    <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
                ))}
            </div>
        </div>
    );
}
