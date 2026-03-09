import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { FuzzResult, RunStats } from '@swazz/core';
import { parseSwaggerSpec } from '@swazz/core';
import type { HeatmapFilter } from './components/Dashboard/Heatmap.js';
import { useConfig } from './hooks/useConfig.js';
import { useRunner } from './hooks/useRunner.js';
import { useDb } from './hooks/useDb.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar/Sidebar.js';
import { Dashboard } from './components/Dashboard/Dashboard.js';
import { Inspector } from './components/Inspector/Inspector.js';
import { RequestDetail } from './components/Inspector/RequestDetail.js';
import { ConfigSidebar } from './components/Sidebar/ConfigSidebar.js';

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
    const [activeTab, setActiveTab] = useState<'heatmap' | 'logs'>('heatmap');
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
        results: liveResults,
        stats: liveStats,
        isRunning,
        isPaused,
        start,
        stop,
        pause,
        resume,
        sendRequest,
    } = useRunner(PROXY_URL);

    const { runs, saveRun, getRunResults, getResultById, deleteRun } = useDb();

    const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
    const [historyResults, setHistoryResults] = useState<FuzzResult[]>([]);
    const [historyStats, setHistoryStats] = useState<any>(null);

    const [selectedResult, setSelectedResult] = useState<FuzzResult | null>(null);
    const [isLoadingResult, setIsLoadingResult] = useState(false);
    const [toasts, setToasts] = useState<ToastData[]>([]);
    const [isLoadingSpecs, setIsLoadingSpecs] = useState(false);
    const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | null>(null);

    // Active dataset (live or history)
    const activeResults = loadedRunId ? historyResults : liveResults;
    const activeStats = loadedRunId ? historyStats : liveStats;

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const id = Date.now();
        setToasts((prev: ToastData[]) => [...prev.slice(-4), { id, message, type }]);
    }, []);

    const stripResult = useCallback((result: FuzzResult): FuzzResult => {
        const { payload, responseBody, ...rest } = result;

        const deepStrip = (val: any): any => {
            if (typeof val === 'string' && val.length > 1024) {
                return val.substring(0, 20) + `... // +${(val.length / 1024).toFixed(1)}KB total`;
            }
            if (val && typeof val === 'object') {
                if (Array.isArray(val)) {
                    return val.map(deepStrip);
                }
                const obj: any = {};
                for (const key in val) {
                    obj[key] = deepStrip(val[key]);
                }
                return obj;
            }
            return val;
        };

        return {
            ...rest,
            payload: deepStrip(payload),
            responseBody: deepStrip(responseBody)
        } as FuzzResult;
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev: ToastData[]) => prev.filter((t: ToastData) => t.id !== id));
    }, []);

    const activeFilteredLogsCount = useMemo(() => {
        if (!heatmapFilter) return activeResults.length;
        return activeResults.filter(
            (r: FuzzResult) =>
                r.method.toUpperCase() === heatmapFilter.method.toUpperCase() &&
                r.endpoint === heatmapFilter.path &&
                r.status === heatmapFilter.status
        ).length;
    }, [activeResults, heatmapFilter]);

    const endpointKeys = useMemo(() => {
        const uniqueKeys = Array.from(new Set(config.endpoints.map((ep) => `${ep.method.toUpperCase()} ${ep.path}`)));
        return uniqueKeys.sort((a, b) => a.localeCompare(b));
    }, [config.endpoints]);

    // Resolved base URL — from config or taken from the first loaded spec
    const displayUrl = config.base_url || ((config as any)._swagger_urls?.[0] ?? '');

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
            updateConfig({ base_url: detectedBaseUrl, endpoints: allEndpoints });
            return { detectedBaseUrl, allEndpoints };
        }
        return null;
    }, [config.base_url, config.global_headers, config.cookies, updateConfig, showToast]);

    const handleStart = async () => {
        const swaggerUrls: string[] = (config as any)._swagger_urls || [];

        if (swaggerUrls.length === 0 && config.endpoints.length === 0) {
            showToast('Add at least one Swagger URL to begin', 'error');
            return;
        }

        // Clear heatmap filter on new run
        setHeatmapFilter(null);

        let finalEndpoints = config.endpoints;
        let finalBaseUrl = config.base_url;

        // If we have Swagger URLs and no endpoints loaded yet (or just refreshing), load them
        if (swaggerUrls.length > 0 && config.endpoints.length === 0) {
            const loaded = await loadEndpoints(swaggerUrls);
            if (loaded) {
                finalEndpoints = loaded.allEndpoints;
                finalBaseUrl = loaded.detectedBaseUrl;
            } else {
                return; // Error toast already shown in loadEndpoints
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
        };

        const runId = `run_${Date.now()}`;
        const runRec = {
            id: runId,
            startedAt: Date.now(),
            completedAt: 0,
            baseUrl: finalBaseUrl,
            stats: null as any,
        };

        let pendingResults: FuzzResult[] = [];

        const onResult = (result: FuzzResult) => {
            pendingResults.push(result);
            if (pendingResults.length >= 50) {
                saveRun(runRec, [...pendingResults]);
                pendingResults = [];
            }
        };

        const onComplete = (stats: RunStats) => {
            const completedRun = { ...runRec, completedAt: Date.now(), stats };
            saveRun(completedRun, pendingResults);
            showToast(`Scan saved to history`, 'success');
        };

        start(finalConfig, onResult, onComplete, stripResult);

        showToast(
            `Fuzzing ${activeEndpoints.length} endpoint${activeEndpoints.length > 1 ? 's' : ''}...`,
            'info',
        );
    };

    const handleLoadRun = async (runId: string) => {
        const runData = runs.find(r => r.id === runId);
        if (!runData) return;
        showToast(`Loading scan...`, 'info');
        const loaded = await getRunResults(runId, true);
        setHistoryResults(loaded);
        setHistoryStats(runData.stats);
        setLoadedRunId(runId);
        setSelectedResult(null);
        setHeatmapFilter(null);
        showToast(`Loaded ${loaded.length} results from history`, 'success');
    };

    const handleSelectResult = (result: FuzzResult) => {
        setSelectedResult(result);
    };

    const handleDeleteRun = async (runId: string) => {
        await deleteRun(runId);
        if (loadedRunId === runId) {
            setLoadedRunId(null);
            setHistoryResults([]);
            setHistoryStats(null);
        }
        showToast('Run deleted', 'success');
    };

    const handleExport = () => {
        if (activeResults.length === 0) {
            showToast('No results to export yet', 'error');
            return;
        }
        const data = {
            exportedAt: new Date().toISOString(),
            baseUrl: config.base_url,
            totalRequests: activeResults.length,
            summary: {
                crashes5xx: activeResults.filter((r: FuzzResult) => r.status >= 500).length,
                errors4xx: activeResults.filter((r: FuzzResult) => r.status >= 400 && r.status < 500).length,
                success2xx: activeResults.filter((r: FuzzResult) => r.status >= 200 && r.status < 300).length,
                networkErrors: activeResults.filter((r: FuzzResult) => r.status === 0).length,
                totalRetries: activeResults.reduce((sum: number, r: FuzzResult) => sum + (r.retries ?? 0), 0),
            },
            results: activeResults,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swazz-results-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${activeResults.length} results`, 'success');
    };


    const [sidebarWidth, setSidebarWidth] = useState(600);
    const isResizingRef = useRef(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingRef.current) return;
            const newWidth = Math.max(200, Math.min(600, e.clientX));
            setSidebarWidth(newWidth);
        };

        const handleMouseUp = () => {
            if (isResizingRef.current) {
                isResizingRef.current = false;
                document.body.classList.remove('resizing');
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && activeTab === 'logs' && !selectedResult) {
                setActiveTab('heatmap');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab, selectedResult]);

    const isBusy = isRunning || isLoadingSpecs;

    return (
        <div className="app-layout" style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}>
            <Header
                baseUrl={displayUrl}
                onChangeBaseUrl={(url) => {
                    const trimmed = url.trim();
                    if (trimmed.endsWith('swagger.json')) {
                        try {
                            const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
                            const origin = parsed.origin;
                            const currentUrls = (config as any)._swagger_urls || [];
                            if (!currentUrls.includes(trimmed)) {
                                const newUrls = [...currentUrls, trimmed];
                                updateConfig({
                                    base_url: origin,
                                    _swagger_urls: newUrls
                                } as any);
                                loadEndpoints(newUrls);
                            } else {
                                updateConfig({ base_url: origin });
                                loadEndpoints(currentUrls);
                            }
                        } catch (e) {
                            // If invalid URL, just set it as is
                            updateConfig({ base_url: trimmed });
                        }
                    } else {
                        updateConfig({ base_url: trimmed });
                    }
                }}
                isRunning={isBusy}
                isPaused={isPaused}
                isLoadingSpecs={isLoadingSpecs}
                onStart={handleStart}
                onStop={stop}
                onPause={pause}
                onResume={resume}
            />

            <Sidebar
                config={config}
                runs={runs}
                loadedRunId={loadedRunId}
                onLoadRun={handleLoadRun}
                onDeleteRun={handleDeleteRun}
                onUpdateConfig={updateConfig}
                onToast={showToast}
                onLoadEndpoints={loadEndpoints}
            />

            <main className="main-content" style={{ gridArea: 'main', minWidth: 0, height: '100%', overflow: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px' }}>
                {/* Left: Dashboard + Results List */}
                <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0, overflow: 'hidden', height: '100%', flex: 1 }}>
                    {loadedRunId && (
                        <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>Viewing History</h3>
                                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                        {activeResults.length} requests · {new Date(historyStats?.startedAt || Date.now()).toLocaleString()}
                                    </div>
                                </div>
                                <button className="btn btn-primary" onClick={() => setLoadedRunId(null)}>
                                    Back to Live Stream
                                </button>
                            </div>
                        </div>
                    )}

                    {!loadedRunId && config.endpoints.length === 0 && (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '32px', marginBottom: 12, opacity: 0.5 }}>⚡️</div>
                                <h2 style={{ fontSize: 'var(--font-size-lg)', marginBottom: 8, color: 'var(--text-primary)' }}>Start Fuzzing</h2>
                                <p style={{ maxWidth: 320, fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
                                    Add endpoints manually or provide a Swagger URL in the sidebar to begin.
                                </p>
                            </div>
                        </div>
                    )}

                    {(activeResults.length > 0 || config.endpoints.length > 0) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
                            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                                <button
                                    style={{
                                        padding: '8px 16px',
                                        background: 'none',
                                        border: 'none',
                                        borderBottom: activeTab === 'heatmap' ? '2px solid var(--color-primary)' : '2px solid transparent',
                                        color: activeTab === 'heatmap' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                        cursor: 'pointer',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: activeTab === 'heatmap' ? 600 : 400,
                                    }}
                                    onClick={() => setActiveTab('heatmap')}
                                >
                                    Endpoint Heatmap
                                </button>
                                <button
                                    style={{
                                        padding: '8px 16px',
                                        background: 'none',
                                        border: 'none',
                                        borderBottom: activeTab === 'logs' ? '2px solid var(--color-primary)' : '2px solid transparent',
                                        color: activeTab === 'logs' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                        cursor: 'pointer',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: activeTab === 'logs' ? 600 : 400,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                    }}
                                    onClick={() => setActiveTab('logs')}
                                >
                                    <span>Request Logs</span>
                                    {activeResults.length > 0 && (
                                        <span style={{ fontSize: '11px', color: 'var(--text-disabled)', fontWeight: 400 }}>
                                            (<span style={{ color: 'var(--color-primary)' }}>{activeFilteredLogsCount}</span> from {activeResults.length})
                                        </span>
                                    )}
                                </button>
                            </div>

                            {activeTab === 'heatmap' ? (
                                <Dashboard
                                    results={activeResults}
                                    stats={activeStats}
                                    endpointKeys={endpointKeys}
                                    heatmapFilter={heatmapFilter}
                                    onHeatmapFilter={(filter) => {
                                        setHeatmapFilter(filter);
                                        if (filter) setActiveTab('logs');
                                    }}
                                    isRunning={isRunning}
                                />
                            ) : (
                                <Inspector
                                    results={activeResults}
                                    heatmapFilter={heatmapFilter}
                                    onClearHeatmapFilter={() => setHeatmapFilter(null)}
                                    onSelectResult={handleSelectResult}
                                    onExport={handleExport}
                                />
                            )}
                        </div>
                    )}
                </div>
                <ConfigSidebar
                    config={config}
                    onUpdateHeaders={updateHeaders}
                    onUpdateCookies={updateCookies}
                    onUpdateDictionaries={updateDictionaries}
                    onUpdateProfiles={updateProfiles}
                    onUpdateConfig={updateConfig}
                    onImportConfig={importConfig}
                    onExportConfig={exportConfig}
                    onToast={showToast}
                />
            </main>

            {selectedResult && (
                <RequestDetail
                    result={selectedResult}
                    baseUrl={displayUrl}
                    onClose={() => setSelectedResult(null)}
                    onReplay={sendRequest}
                    onFetchFull={() => getResultById(selectedResult.id)}
                    onUpdateResult={setSelectedResult}
                    globalHeaders={config.global_headers}
                    globalCookies={config.cookies}
                />
            )}

            {/* Toast stack */}
            <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
                {toasts.map((t: ToastData) => (
                    <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
                ))}
            </div>

            <div
                className="sidebar-resizer"
                onMouseDown={(e) => {
                    e.preventDefault();
                    isResizingRef.current = true;
                    document.body.classList.add('resizing');
                }}
                title="Drag to resize"
            />
        </div>
    );
}
