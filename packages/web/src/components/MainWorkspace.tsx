import React, { useMemo } from 'react';
import { Dashboard } from './Dashboard/Dashboard.js';
import { Inspector } from './Inspector/Inspector.js';
import type { ResultSummary } from '../../hooks/useRunner.js';
import type { RunStats } from '@swazz/core';
import type { HeatmapFilter } from './Dashboard/Heatmap.js';

interface MainWorkspaceProps {
    config: any;
    activeRows: ResultSummary[];
    activeStats: RunStats | null;
    loadedRunId: string | null;
    historyStats: RunStats | null;
    activeTab: 'heatmap' | 'logs';
    setActiveTab: (tab: 'heatmap' | 'logs') => void;
    heatmapFilter: HeatmapFilter | null;
    setHeatmapFilter: (f: HeatmapFilter | null) => void;
    isRunning: boolean;
    handleStart: (urls?: string[]) => void;
    setLoadedRunId: (id: string | null) => void;
    handleSelectResult: (r: ResultSummary) => void;
    handleExport: () => void;
}

export function MainWorkspace({
    config,
    activeRows,
    activeStats,
    loadedRunId,
    historyStats,
    activeTab,
    setActiveTab,
    heatmapFilter,
    setHeatmapFilter,
    isRunning,
    handleStart,
    setLoadedRunId,
    handleSelectResult,
    handleExport
}: MainWorkspaceProps) {
    
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
        if (activeStats?.endpointCounts && Object.keys(activeStats.endpointCounts).length > 0) {
            return Object.keys(activeStats.endpointCounts).sort();
        }
        const uniqueKeys = Array.from(new Set(config.endpoints.map((ep: any) => `${ep.method.toUpperCase()} ${ep.path}`)));
        return uniqueKeys.sort((a, b) => a.localeCompare(b));
    }, [config.endpoints, activeStats]);

    return (
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
    );
}
