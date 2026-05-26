import { useEffect } from 'react';
import type { FuzzResult } from './types.js';
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
import { useTheme } from './hooks/useTheme.js';
import { MainWorkspace } from './components/MainWorkspace.js';
import { useAppStore } from './store/appStore.js';
import { useShallow } from 'zustand/react/shallow';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export default function App() {
    const { theme, toggleTheme } = useTheme();
    const { toasts, showToast, dismissToast } = useToast();

    // Only subscribe to what App.tsx needs for rendering
    const {
        activeTab,
        selectedResult,
        isSidebarOpen,
        isConfigOpen,
        isSidebarHiddenDesktop,
        isConfigHiddenDesktop
    } = useAppStore(useShallow(state => ({
        activeTab: state.activeTab,
        selectedResult: state.selectedResult,
        isSidebarOpen: state.isSidebarOpen,
        isConfigOpen: state.isConfigOpen,
        isSidebarHiddenDesktop: state.isSidebarHiddenDesktop,
        isConfigHiddenDesktop: state.isConfigHiddenDesktop,
    })));

    const {
        config, updateConfig, updateHeaders, updateCookies,
        updateDictionaries, updateProfiles, importConfig, exportConfig
    } = useConfig();

    const { start, stop, pause, resume, sendRequest } = useRunner(PROXY_URL);

    const { db, runs, getDb, saveRun, importCliReport, queryResults, getRunResults, deleteRun } = useDb();

    const { handleLoadRun, handleDeleteRun, handleExport, handleExportHTML } = useRunHistory({
        runs,
        queryResults,
        getRunResults,
        deleteRun,
        showToast,
        onRunLoaded: () => {
            useAppStore.setState({
                selectedResult: null,
                heatmapFilter: null,
            });
        },
    });

    const { loadEndpoints, handleStart } = useFuzzSession({
        config: config as any,
        updateConfig,
        start,
        saveRun,
        getDb,
        showToast,
    });

    const displayUrl = config.base_url || (config._swagger_urls?.[0] ?? '');

    const { sidebarWidth, configSidebarWidth, startResizingLeft, startResizingRight } = useResizableLayout(300, 320);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && activeTab === 'logs' && !selectedResult) {
                useAppStore.setState({ activeTab: 'heatmap' });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab, selectedResult]);

    const handleSelectResult = (row: ResultSummary) => {
        useAppStore.setState({ selectedResult: {
            ...row,
            payload: row.payloadPreview || undefined,
            responseBody: row.responsePreview || undefined,
        } as FuzzResult });
    };

    return (
        <div className="app-layout" style={{ gridTemplateColumns: `${isSidebarHiddenDesktop ? 0 : sidebarWidth}px 1fr` }}>
            <Header
                baseUrl={displayUrl}
                onChangeBaseUrl={(url) => {
                    const trimmed = url.trim();
                    if (trimmed.endsWith('swagger.json')) {
                        try {
                            const inputUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
                            const parsed = new URL(inputUrl);
                            const origin = parsed.origin;
                            const currentUrls = config._swagger_urls || [];
                            if (!currentUrls.includes(inputUrl)) {
                                const newUrls = [...currentUrls, inputUrl];
                                updateConfig({ base_url: origin, _swagger_urls: newUrls });
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
                onStart={() => handleStart()}
                onStop={() => stop().catch((err: any) => showToast(err.message || 'Failed to stop', 'error'))}
                onPause={() => pause().catch((err: any) => showToast(err.message || 'Failed to pause', 'error'))}
                onResume={() => resume().catch((err: any) => showToast(err.message || 'Failed to resume', 'error'))}
                onToggleSidebar={() => {
                    if (window.innerWidth <= 768) useAppStore.setState({ isSidebarOpen: !isSidebarOpen });
                    else useAppStore.setState({ isSidebarHiddenDesktop: !isSidebarHiddenDesktop });
                }}
                onToggleConfig={() => {
                    if (window.innerWidth <= 768) useAppStore.setState({ isConfigOpen: !isConfigOpen });
                    else useAppStore.setState({ isConfigHiddenDesktop: !isConfigHiddenDesktop });
                }}
                theme={theme}
                onToggleTheme={toggleTheme}
            />

            <Sidebar
                className={`${isSidebarOpen ? 'mobile-open' : ''} ${isSidebarHiddenDesktop ? 'hidden-desktop' : ''}`}
                config={config}
                runs={runs}
                onLoadRun={(id, importedRun) => {
                    handleLoadRun(id, importedRun);
                    useAppStore.setState({ isSidebarOpen: false });
                }}
                onDeleteRun={handleDeleteRun}
                onUpdateConfig={updateConfig}
                onToast={showToast}
                onLoadEndpoints={loadEndpoints}
                onImportRun={importCliReport}
            />

            {(isSidebarOpen || isConfigOpen) && (
                <div className="mobile-overlay" onClick={() => {
                    useAppStore.setState({
                        isSidebarOpen: false,
                        isConfigOpen: false,
                    });
                }} />
            )}

            <main className="main-content" style={{ gridArea: 'main', minWidth: 0, height: '100%', overflow: 'hidden', display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${isConfigHiddenDesktop ? 0 : configSidebarWidth}px` }}>
                <MainWorkspace
                    config={config}
                    handleStart={handleStart}
                    handleSelectResult={handleSelectResult}
                    handleExport={() => handleExport(useAppStore.getState().loadedRunId ?? useAppStore.getState().liveRunId, config.base_url)}
                    handleExportHTML={() => handleExportHTML(useAppStore.getState().loadedRunId ?? useAppStore.getState().liveRunId)}
                    queryResults={queryResults}
                />

                <ConfigSidebar
                    className={`${isConfigOpen ? 'mobile-open' : ''} ${isConfigHiddenDesktop ? 'hidden-desktop' : ''}`}
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
                    onClose={() => useAppStore.setState({ selectedResult: null })}
                    onReplay={sendRequest}
                    globalHeaders={config.global_headers}
                    globalCookies={config.cookies}
                    config={config}
                />
            )}

            <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
                {toasts.map((t) => (
                    <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
                ))}
            </div>

            {!isSidebarHiddenDesktop && <div className="sidebar-resizer" style={{ left: sidebarWidth - 4 }} onMouseDown={startResizingLeft} title="Drag to resize" />}
            {!isConfigHiddenDesktop && <div className="sidebar-resizer" style={{ right: configSidebarWidth - 4, left: 'auto' }} onMouseDown={startResizingRight} title="Drag to resize" />}
        </div>
    );
}
