import React, { useState, useEffect } from 'react';
import type { FuzzResult } from '@swazz/core';
import type { HeatmapFilter } from './components/Dashboard/Heatmap.js';
import { useConfig } from './hooks/useConfig.js';
import { useRunner } from './hooks/useRunner.js';
import type { ResultSummary } from './hooks/useRunner.js';
import { useDb } from './hooks/useDb.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar/Sidebar.js';
import { RequestDetail } from './components/Inspector/RequestDetail.js';
import { ConfigSidebar } from './components/Sidebar/ConfigSidebar.js';
import { Toast } from './components/Toast/Toast.js';
import { useToast } from './hooks/useToast.js';
import { useResizableLayout } from './hooks/useResizableLayout.js';
import { useFuzzSession } from './hooks/useFuzzSession.js';
import { useRunHistory } from './hooks/useRunHistory.js';
import { MainWorkspace } from './components/MainWorkspace.js';

// In dev, proxy goes to local wrangler via Vite proxy; in prod, use deployed Worker URL
const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export default function App() {
    const [activeTab, setActiveTab] = useState<'heatmap' | 'logs'>('heatmap');
    const { toasts, showToast, dismissToast } = useToast();
    const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | null>(null);
    const [selectedResult, setSelectedResult] = useState<FuzzResult | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isConfigOpen, setIsConfigOpen] = useState(false);

    const {
        config, updateConfig, updateHeaders, updateCookies,
        updateDictionaries, updateProfiles, importConfig, exportConfig
    } = useConfig();

    const {
        rows: liveRows, stats: liveStats, isRunning, isPaused,
        start, stop, pause, resume, sendRequest
    } = useRunner(PROXY_URL);

    const { runs, saveRun, importCliReport, getRunResults, deleteRun } = useDb();

    // Controllers
    const { loadedRunId, setLoadedRunId, historyRows, historyStats, handleLoadRun, handleDeleteRun, handleExport } = useRunHistory({
        runs, getRunResults, deleteRun, showToast,
        onRunLoaded: () => {
            setSelectedResult(null);
            setHeatmapFilter(null);
        }
    });

    const { isLoadingSpecs, loadEndpoints, handleStart } = useFuzzSession({
        config: config as any,
        updateConfig,
        start,
        saveRun,
        showToast,
        onRunStarted: () => {
            setHeatmapFilter(null);
            setSelectedResult(null);
            setLoadedRunId(null);
        }
    });

    const activeRows = loadedRunId ? historyRows : liveRows;
    const activeStats = loadedRunId ? historyStats : liveStats;
    const displayUrl = config.base_url || ((config as any)._swagger_urls?.[0] ?? '');

    const { sidebarWidth, configSidebarWidth, startResizingLeft, startResizingRight } = useResizableLayout(300, 320);

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

    const handleSelectResult = (row: ResultSummary) => {
        setSelectedResult({
            ...row,
            payload: row.payloadPreview || undefined,
            responseBody: row.responsePreview || undefined,
        } as FuzzResult);
    };

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
                                updateConfig({ base_url: origin, _swagger_urls: newUrls } as any);
                                loadEndpoints(newUrls);
                            } else {
                                updateConfig({ base_url: origin });
                            }
                        } catch {
                            updateConfig({ base_url: trimmed });
                        }
                    } else {
                        updateConfig({ base_url: trimmed });
                    }
                }}
                isRunning={isBusy}
                isPaused={isPaused}
                isLoadingSpecs={isLoadingSpecs}
                onStart={() => handleStart()}
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
                <MainWorkspace
                    config={config}
                    activeRows={activeRows}
                    activeStats={activeStats}
                    loadedRunId={loadedRunId}
                    historyStats={historyStats}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    heatmapFilter={heatmapFilter}
                    setHeatmapFilter={setHeatmapFilter}
                    isRunning={isRunning}
                    handleStart={handleStart}
                    setLoadedRunId={setLoadedRunId}
                    handleSelectResult={handleSelectResult}
                    handleExport={() => handleExport(activeRows, config.base_url)}
                />
                
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

            <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
                {toasts.map((t) => (
                    <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
                ))}
            </div>

            <div className="sidebar-resizer" style={{ left: sidebarWidth - 4 }} onMouseDown={startResizingLeft} title="Drag to resize" />
            <div className="sidebar-resizer" style={{ right: configSidebarWidth - 4, left: 'auto' }} onMouseDown={startResizingRight} title="Drag to resize" />
        </div>
    );
}
