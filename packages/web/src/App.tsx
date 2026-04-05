import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { FuzzResult, RunStats } from '@swazz/core';
import { parseSwaggerSpec } from '@swazz/core';
import type { HeatmapFilter } from './components/Dashboard/Heatmap.js';
import { useConfig } from './hooks/useConfig.js';
import { useRunner, previewPayload, previewResponse } from './hooks/useRunner.js';
import type { ResultSummary } from './hooks/useRunner.js';
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
        rows: liveRows,
        stats: liveStats,
        isRunning,
        isPaused,
        start,
        stop,
        pause,
        resume,
        sendRequest,
    } = useRunner(PROXY_URL);

    const { runs, saveRun, importCliReport, getRunResults, deleteRun } = useDb();

    const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
    const [historyRows, setHistoryRows] = useState<ResultSummary[]>([]);
    const [historyStats, setHistoryStats] = useState<RunStats | null>(null);
    // Tracks the DB run ID for the *currently active* live fuzz run.
    const [currentRunId, setCurrentRunId] = useState<string | null>(null);

    const [selectedResult, setSelectedResult] = useState<FuzzResult | null>(null);
    const [toasts, setToasts] = useState<ToastData[]>([]);
    const [isLoadingSpecs, setIsLoadingSpecs] = useState(false);
    const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | null>(null);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const importFileInputRef = useRef<HTMLInputElement>(null);

    // Active dataset (live or history) — only lightweight summaries
    const activeRows = loadedRunId ? historyRows : liveRows;
    const activeStats = loadedRunId ? historyStats : liveStats;

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const id = Date.now();
        setToasts((prev: ToastData[]) => [...prev.slice(-4), { id, message, type }]);
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev: ToastData[]) => prev.filter((t: ToastData) => t.id !== id));
    }, []);

    const activeFilteredLogsCount = useMemo(() => {
        if (!heatmapFilter) return activeRows.length;
        return activeRows.filter(
            (r) =>
                r.method.toUpperCase() === heatmapFilter.method.toUpperCase() &&
                r.endpoint === heatmapFilter.path &&
                r.status === heatmapFilter.status
        ).length;
    }, [activeRows, heatmapFilter]);

    const endpointKeys = useMemo(() => {
        // If we have data in activeStats (like from a CLI import), use those endpoints
        if (activeStats?.endpointCounts && Object.keys(activeStats.endpointCounts).length > 0) {
            return Object.keys(activeStats.endpointCounts).sort();
        }
        // Fallback to currently configured endpoints
        const uniqueKeys = Array.from(new Set(config.endpoints.map((ep) => `${ep.method.toUpperCase()} ${ep.path}`)));
        return uniqueKeys.sort((a, b) => a.localeCompare(b));
    }, [config.endpoints, activeStats]);

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

        // Clear UI state for new run
        setHeatmapFilter(null);
        setSelectedResult(null);
        setLoadedRunId(null);

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

    const handleLoadRun = async (runId: string, importedRun?: any) => {
        const runData = importedRun || runs.find(r => r.id === runId);
        if (!runData) return;
        
        showToast(`Loading scan...`, 'info');
        const rows = await getRunResults(runId);
        setHistoryRows(rows);
        setHistoryStats(runData.stats);
        setLoadedRunId(runId);
        setSelectedResult(null);
        setHeatmapFilter(null);
        showToast(`Loaded ${rows.length} results from history`, 'success');
    };

    const handleSelectResult = (row: ResultSummary) => {
        setSelectedResult({
            ...row,
            payload: row.payloadPreview || undefined,
            responseBody: row.responsePreview || undefined,
        } as FuzzResult);
    };

    const handleDeleteRun = async (runId: string) => {
        await deleteRun(runId);
        if (loadedRunId === runId) {
            setLoadedRunId(null);
            setHistoryRows([]);
            setHistoryStats(null);
        }
        showToast('Run deleted', 'success');
    };

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const json = JSON.parse(evt.target?.result as string);
                const result = await importCliReport(json);
                if (result) {
                    const { runId, run } = result;
                    showToast('CLI Report imported successfully', 'success');
                    handleLoadRun(runId, run);
                }
            } catch (err) {
                showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleExport = () => {
        if (activeRows.length === 0) {
            showToast('No results to export yet', 'error');
            return;
        }
        const data = {
            exportedAt: new Date().toISOString(),
            baseUrl: config.base_url,
            totalRequests: activeRows.length,
            summary: {
                crashes5xx: activeRows.filter((r) => r.status >= 500).length,
                errors4xx: activeRows.filter((r) => r.status >= 400 && r.status < 500).length,
                success2xx: activeRows.filter((r) => r.status >= 200 && r.status < 300).length,
                networkErrors: activeRows.filter((r) => r.status === 0).length,
                totalRetries: activeRows.reduce((sum: number, r) => sum + (r.retries ?? 0), 0),
            },
            results: activeRows,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swazz-results-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${activeRows.length} results`, 'success');
    };


    const [sidebarWidth, setSidebarWidth] = useState(300);
    const [configSidebarWidth, setConfigSidebarWidth] = useState(320);
    const isResizingLeftRef = useRef(false);
    const isResizingRightRef = useRef(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingLeftRef.current) {
                const newWidth = Math.max(200, Math.min(600, e.clientX));
                setSidebarWidth(newWidth);
            } else if (isResizingRightRef.current) {
                const newWidth = Math.max(250, Math.min(600, window.innerWidth - e.clientX));
                setConfigSidebarWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            isResizingLeftRef.current = false;
            isResizingRightRef.current = false;
            document.body.classList.remove('resizing');
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
                onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                onToggleConfig={() => setIsConfigOpen(!isConfigOpen)}
            />

            <Sidebar
                className={isSidebarOpen ? 'mobile-open' : ''}
                config={config}
                runs={runs}
                loadedRunId={loadedRunId}
                onLoadRun={(id) => {
                    handleLoadRun(id);
                    setIsSidebarOpen(false);
                }}
                onDeleteRun={handleDeleteRun}
                onUpdateConfig={updateConfig}
                onToast={showToast}
                onLoadEndpoints={loadEndpoints}
                onImportRun={importCliReport}
            />

            {(isSidebarOpen || isConfigOpen) && (
                <div className="mobile-overlay" onClick={() => {
                    setIsSidebarOpen(false);
                    setIsConfigOpen(false);
                }} />
            )}

            <main className="main-content" style={{ gridArea: 'main', minWidth: 0, height: '100%', overflow: 'hidden', display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${configSidebarWidth}px` }}>
                {/* Left: Dashboard + Results List */}
                <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0, overflow: 'hidden', height: '100%', flex: 1 }}>
                    {loadedRunId && (
                        <div style={{
                            display:'flex', justifyContent:'space-between', alignItems:'center',
                            padding:'10px 16px',
                            background:'rgba(124,58,237,0.06)',
                            border:'1px solid rgba(124,58,237,0.25)',
                            borderRadius:'var(--radius-md)',
                            flexShrink:0,
                        }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'var(--space-2)' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round">
                                    <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
                                </svg>
                                <span style={{ fontSize:'var(--font-size-sm)', color:'var(--accent-light)', fontWeight:500 }}>Viewing History</span>
                                <span style={{ fontSize:'var(--font-size-xs)', color:'var(--text-muted)' }}>
                                    · {activeRows.length.toLocaleString()} requests · {new Date(historyStats?.startTime || Date.now()).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}
                                </span>
                            </div>
                            <button className="btn btn-ghost btn-sm" onClick={() => setLoadedRunId(null)}>← Live</button>
                        </div>
                    )}

                    {!loadedRunId && config.endpoints.length === 0 && (
                        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
                            <div className="empty-state">
                                <div className="empty-state-icon">⚡</div>
                                <div className="empty-state-title">Ready to fuzz</div>
                                <div className="empty-state-text">
                                    Add a Swagger URL in the left sidebar to auto-load endpoints, then hit <strong style={{ color:'var(--accent-light)' }}>Run Fuzz Test</strong>.
                                </div>
                            </div>
                        </div>
                    )}

                    {(activeRows.length > 0 || config.endpoints.length > 0) && (
                        <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-4)', flex:1, minHeight:0 }}>
                            <div className="tab-bar">
                                <button
                                    className={`tab-bar-btn ${activeTab === 'heatmap' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('heatmap')}
                                >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                                    </svg>
                                    Endpoint Heatmap
                                </button>
                                <button
                                    className={`tab-bar-btn ${activeTab === 'logs' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('logs')}
                                >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                                    </svg>
                                    Request Logs
                                    {activeRows.length > 0 && (
                                        <span className="tab-bar-count">
                                            {activeFilteredLogsCount.toLocaleString()}
                                        </span>
                                    )}
                                </button>
                            </div>

                            {activeTab === 'heatmap' ? (
                                <Dashboard
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
                                    results={activeRows}
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
                    className={isConfigOpen ? 'mobile-open' : ''}
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

            {/* Floating Import Button */}
            <div style={{ position: 'fixed', bottom: 80, right: 16, zIndex: 150 }}>
                <button 
                    className="btn btn-primary" 
                    style={{ 
                        boxShadow: '0 4px 20px rgba(124,58,237,0.5)',
                        padding: '10px 18px',
                        borderRadius: 'var(--radius-full)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontWeight: 600,
                        border: '1px solid rgba(255,255,255,0.2)'
                    }}
                    onClick={() => importFileInputRef.current?.click()}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Import CLI Report
                </button>
                <input 
                    type="file" 
                    ref={importFileInputRef} 
                    style={{ display: 'none' }} 
                    accept=".json" 
                    onChange={handleImportFile} 
                />
            </div>

            <div
                className="sidebar-resizer"
                style={{ left: sidebarWidth - 4 }}
                onMouseDown={(e) => {
                    e.preventDefault();
                    isResizingLeftRef.current = true;
                    document.body.classList.add('resizing');
                }}
                title="Drag to resize"
            />

            <div
                className="sidebar-resizer"
                style={{ right: configSidebarWidth - 4, left: 'auto' }}
                onMouseDown={(e) => {
                    e.preventDefault();
                    isResizingRightRef.current = true;
                    document.body.classList.add('resizing');
                }}
                title="Drag to resize"
            />
        </div>
    );
}
