import { useMemo, useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useShallow } from 'zustand/react/shallow';
import { Dashboard } from './Dashboard/Dashboard.js';
import { Inspector } from './Inspector/Inspector.js';
import { OWASPTop10 } from './OWASPTop10/OWASPTop10.js';
import { UserSettings } from './UserSettings.js';
import type { RunStats } from '../types.js';
import type { HeatmapFilter } from './Dashboard/Heatmap.js';
import type { QueryOptions } from '../hooks/useDb.js';
import type { ResultSummary } from '../hooks/useRunner.js';

interface MainWorkspaceProps {
    config: any;
    handleStart: (urls?: string[]) => void;
    handleSelectResult: (r: ResultSummary) => void;
    handleExport: () => void;
    handleExportHTML: () => void;
    handleExportMD: () => void;
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
}

export function MainWorkspace({
    config,
    handleStart,
    handleSelectResult,
    handleExport,
    handleExportHTML,
    handleExportMD,
    queryResults,
}: MainWorkspaceProps) {
    const {
        activeRunId,
        activeStats,
        liveCount,
        loadedRunId,
        historyStats,
        activeTab,
        heatmapFilter,
        isRunning
    } = useAppStore(useShallow(state => ({
        activeRunId: state.liveRunId,
        activeStats: state.stats,
        liveCount: state.liveCount,
        loadedRunId: state.loadedRunId,
        historyStats: state.historyStats,
        activeTab: state.activeTab,
        heatmapFilter: state.heatmapFilter,
        isRunning: state.isRunning
    })));

    const [isExportHovered, setIsExportHovered] = useState(false);

    // Endpoint keys for heatmap — derive from stats or config
    const endpointKeys = useMemo(() => {
        if (activeStats?.endpointCounts && Object.keys(activeStats.endpointCounts).length > 0) {
            return Object.keys(activeStats.endpointCounts).sort();
        }
        const uniqueKeys = Array.from(new Set<string>(config.endpoints.map((ep: any) => `${ep.method.toUpperCase()} ${ep.path}`)));
        return uniqueKeys.sort((a, b) => a.localeCompare(b));
    }, [config.endpoints, activeStats]);

    // The runId to show in Inspector: history takes priority, then live run
    const inspectorRunId = loadedRunId ?? activeRunId;
    const currentStats = loadedRunId ? historyStats : activeStats;
    const totalRequestsCount = loadedRunId
        ? (historyStats?.totalRequests ?? 0)
        : liveCount;

    const isAnalysisEnabled = config?.settings?.analyze_response_body !== false;

    useEffect(() => {
        if (!isAnalysisEnabled && (activeTab === 'findings' || activeTab === 'owasp')) {
            useAppStore.setState({ activeTab: 'logs' });
        }
    }, [isAnalysisEnabled, activeTab]);

    const hasActivity = !!inspectorRunId || config.endpoints.length > 0;

    const [findingsCount, setFindingsCount] = useState(0);

    useEffect(() => {
        if (!inspectorRunId || !isAnalysisEnabled) {
            setFindingsCount(0);
            return;
        }

        let active = true;
        queryResults({ runId: inspectorRunId, findingsOnly: true, limit: 1 })
            .then(res => {
                if (active) {
                    setFindingsCount(res.total);
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [inspectorRunId, liveCount, isAnalysisEnabled, queryResults]);

    return (
        <div className="workspace-container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0, overflow: 'hidden', height: '100%', flex: 1 }}>
            {loadedRunId && activeTab !== 'settings' && (
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 16px',
                    background: 'rgba(124,58,237,0.06)',
                    border: '1px solid rgba(124,58,237,0.25)',
                    borderRadius: 'var(--radius-md)',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round">
                            <path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" />
                        </svg>
                        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--accent-light)', fontWeight: 500 }}>Viewing History</span>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                            · {new Date(historyStats?.startTime || Date.now()).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => useAppStore.setState({ loadedRunId: null })}>← Live</button>
                </div>
            )}

            {activeTab === 'settings' ? (
                <UserSettings />
            ) : !hasActivity ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="empty-state">
                        <div className="empty-state-icon">⚡</div>
                        <div className="empty-state-title">Ready to fuzz</div>
                        <div className="empty-state-text">
                            Add a Swagger URL in the left sidebar to auto-load endpoints, then hit <strong style={{ color: 'var(--accent-light)' }}>Run</strong>.
                        </div>
                        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                            <button
                                className="btn btn-primary"
                                style={{ padding: '8px 16px', fontSize: '14px' }}
                                onClick={() => handleStart(['https://petstore.swagger.io/v2/swagger.json'])}
                            >
                                Try Petstore Demo
                            </button>
                            <div style={{ fontSize: '12px', color: 'var(--text-disabled)' }}>
                                Automatically loads endpoints and runs a quick fuzz test
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
                    <div className="tab-bar">
                        <button
                            className={`tab-bar-btn ${activeTab === 'heatmap' ? 'active' : ''}`}
                            onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                            </svg>
                            Endpoint Heatmap
                        </button>
                        <button
                            className={`tab-bar-btn ${activeTab === 'logs' ? 'active' : ''}`}
                            onClick={() => useAppStore.setState({ activeTab: 'logs' })}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                            </svg>
                            Request Logs
                            {totalRequestsCount > 0 && (
                                <span className="tab-bar-count">{totalRequestsCount.toLocaleString()}</span>
                            )}
                        </button>
                        {isAnalysisEnabled && (
                            <button
                                className={`tab-bar-btn ${activeTab === 'findings' ? 'active' : ''}`}
                                onClick={() => useAppStore.setState({ activeTab: 'findings' })}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                Grouped Errors
                                {findingsCount > 0 && (
                                    <span className="tab-bar-count">{findingsCount.toLocaleString()}</span>
                                )}
                            </button>
                        )}
                        {isAnalysisEnabled && (
                            <button
                                className={`tab-bar-btn ${activeTab === 'owasp' ? 'active' : ''}`}
                                onClick={() => useAppStore.setState({ activeTab: 'owasp' })}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                                OWASP Top 10
                                {findingsCount > 0 && (
                                    <span className="tab-bar-count">{findingsCount.toLocaleString()}</span>
                                )}
                            </button>
                        )}
                        <div 
                            style={{ position: 'relative', display: 'inline-block' }}
                            onMouseEnter={() => setIsExportHovered(true)}
                            onMouseLeave={() => setIsExportHovered(false)}
                        >
                            <button
                                className="tab-bar-btn"
                                style={{ color: 'var(--accent-light)' }}
                                title="Download Reports"
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                Download
                            </button>
                            
                            {isExportHovered && (
                                <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    right: 0,
                                    marginTop: '4px',
                                    backgroundColor: 'var(--bg-elevated)',
                                    minWidth: '150px',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                                    zIndex: 50,
                                    borderRadius: 'var(--radius-md)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    padding: '4px',
                                    border: '1px solid var(--border-default)'
                                }}>
                                    <button
                                        className="tab-bar-btn"
                                        style={{ justifyContent: 'flex-start', width: '100%', border: 'none', background: 'transparent', margin: 0, padding: '8px 12px' }}
                                        onClick={handleExportHTML}
                                        title="Generate and download a visual HTML report"
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                        HTML Report
                                    </button>
                                    <button
                                        className="tab-bar-btn"
                                        style={{ justifyContent: 'flex-start', width: '100%', border: 'none', background: 'transparent', margin: 0, padding: '8px 12px' }}
                                        onClick={handleExportMD}
                                        title="Generate and download a Markdown report"
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                                        </svg>
                                        MD Report
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {activeTab === 'heatmap' && (
                        <Dashboard
                            stats={currentStats}
                            endpointKeys={endpointKeys}
                            heatmapFilter={heatmapFilter}
                            onHeatmapFilter={(filter) => {
                                useAppStore.setState({ heatmapFilter: filter });
                                if (filter) useAppStore.setState({ activeTab: 'logs' });
                            }}
                            isRunning={isRunning}
                        />
                    )}
                    {activeTab === 'logs' && (
                        <Inspector
                            runId={inspectorRunId}
                            queryResults={queryResults}
                            liveCount={liveCount}
                            heatmapFilter={heatmapFilter}
                            onClearHeatmapFilter={() => useAppStore.setState({ heatmapFilter: null })}
                            onSelectResult={handleSelectResult}
                            onExport={handleExport}
                            config={config}
                        />
                    )}
                    {isAnalysisEnabled && activeTab === 'findings' && (
                        <Inspector
                            runId={inspectorRunId}
                            queryResults={queryResults}
                            liveCount={liveCount}
                            heatmapFilter={heatmapFilter}
                            onClearHeatmapFilter={() => useAppStore.setState({ heatmapFilter: null })}
                            onSelectResult={handleSelectResult}
                            onExport={handleExport}
                            findingsOnly={true}
                            config={config}
                        />
                    )}
                    {isAnalysisEnabled && activeTab === 'owasp' && (
                        <OWASPTop10
                            runId={inspectorRunId}
                            queryResults={queryResults}
                            liveCount={liveCount}
                            onSelectResult={handleSelectResult}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
