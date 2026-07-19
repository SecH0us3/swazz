import { useMemo, useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useShallow } from 'zustand/react/shallow';
import { Dashboard } from './Dashboard/Dashboard.js';
import { AnalyticsDashboard } from './Dashboard/AnalyticsDashboard.js';
import { Inspector } from './Inspector/Inspector.js';
import { RunnerLogsViewer } from './Inspector/RunnerLogsViewer.js';
import { OWASPTop10 } from './OWASPTop10/OWASPTop10.js';
import { UserSettings } from './UserSettings.js';
import { ProjectSettings } from './ProjectSettings.js';
import { HistoryPage } from './HistoryPage.js';
import { LandingShowcase } from './LandingShowcase.js';
import { ComparePage } from './ComparePage.js';
import { AboutPage } from './AboutPage.js';
import type { RunStats } from '../types.js';
import type { HeatmapFilter } from './Dashboard/Heatmap.js';
import type { QueryOptions } from '../hooks/useDb.js';
import type { ResultSummary } from '../hooks/useRunner.js';
import { categorizeFinding } from '../utils/findings.js';
import { extractErrorSubtype } from '../utils/errors.js';

// Helper to compute deduplicated count for Grouped Errors
function getGroupedFindingsCount(rows: ResultSummary[]): number {
    const groups: Record<string, Set<string>> = {};
    for (const row of rows) {
        let placed = false;
        if (row.analyzerFindings && row.analyzerFindings.length > 0) {
            for (const f of row.analyzerFindings) {
                placed = true;
                const { key: groupKey } = categorizeFinding(f, row.responsePreview);
                if (!groups[groupKey]) groups[groupKey] = new Set();
                const dedupeKey = `${row.method} ${row.endpoint}::${f.ruleId}::${f.message}`;
                groups[groupKey].add(dedupeKey);
            }
        }
        if (!placed) {
            const isErrorStatus = row.status >= 500 || 
                                 (row.status === 0 && row.error) ||
                                 (row.status >= 400 && ![401, 403, 404, 405, 422, 429].includes(row.status));
            if (isErrorStatus) {
                let groupKey = `status_${row.status}`;
                if (row.status === 0) {
                    groupKey = 'status_0';
                } else {
                    const subType = extractErrorSubtype(row.responsePreview);
                    if (subType) {
                        groupKey = `status_${row.status}_${subType.key}`;
                    }
                }
                if (!groups[groupKey]) groups[groupKey] = new Set();
                const dedupeKey = `${row.method} ${row.endpoint}::${row.status}::${row.error || ''}`;
                groups[groupKey].add(dedupeKey);
            }
        }
    }
    return Object.values(groups).reduce((sum, set) => sum + set.size, 0);
}

// Helper to compute deduplicated count for OWASP Top 10
function getOwaspFindingsCount(rows: ResultSummary[]): number {
    const seenKeys = new Set<string>();
    let count = 0;
    for (const row of rows) {
        let placed = false;
        if (row.analyzerFindings && row.analyzerFindings.length > 0) {
            for (const f of row.analyzerFindings) {
                const cats = f.owaspCategory || [];
                if (cats.length > 0) {
                    for (const c of cats) {
                        const key = `${c}:${row.method}:${row.resolvedPath || row.endpoint}:${f.ruleId || ''}`;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            count++;
                        }
                        placed = true;
                    }
                }
            }
        }
        if (!placed) {
            const cats = row.owaspCategory || [];
            if (cats.length > 0) {
                for (const c of cats) {
                    const key = `${c}:${row.method}:${row.resolvedPath || row.endpoint}:status-${row.status}`;
                    if (!seenKeys.has(key)) {
                        seenKeys.add(key);
                        count++;
                    }
                    placed = true;
                }
            }
        }
        if (!placed) {
            const key = `Unmapped / Other:${row.method}:${row.resolvedPath || row.endpoint}:status-${row.status}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                count++;
            }
        }
    }
    return count;
}

interface MainWorkspaceProps {
    config: any;
    handleStart: (urls?: string[]) => void;
    handleSelectResult: (r: ResultSummary) => void;
    handleExport: (runId: string | null, baseUrl?: string) => void;
    handleExportHTML: (runId: string | null) => void;
    handleExportMD: (runId: string | null) => void;
    handleLoadRun: (runId: string, importedRun?: any) => void;
    handleDeleteRun: (runId: string) => void;
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
    runs: any[];
    onImportRun: (data: any) => Promise<{ runId: string; run: any } | undefined>;
    baseUrl: string;
    onChangeBaseUrl?: (url: string) => void;
    onStart: (cleanUrl?: string) => void;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
    onToggleConfig?: () => void;
}

export function MainWorkspace({
    config,
    handleStart,
    handleSelectResult,
    handleExport,
    handleExportHTML,
    handleExportMD,
    handleLoadRun,
    handleDeleteRun,
    queryResults,
    runs,
    onImportRun,
    baseUrl,
    onChangeBaseUrl,
    onStart,
    onStop,
    onPause,
    onResume,
    onToggleConfig,
}: MainWorkspaceProps) {
    const {
        activeRunId,
        activeStats,
        liveCount,
        loadedRunId,
        historyStats,
        activeTab,
        heatmapFilter,
        isRunning,
        isPaused,
        isLoadingSpecs,
        isQueued,
        compareRunIdA,
        compareRunIdB,
        activeProject,
        isConfigOpen,
        isConfigHiddenDesktop
    } = useAppStore(useShallow(state => ({
        activeRunId: state.liveRunId,
        activeStats: state.stats,
        liveCount: state.liveCount,
        loadedRunId: state.loadedRunId,
        historyStats: state.historyStats,
        activeTab: state.activeTab,
        heatmapFilter: state.heatmapFilter,
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        isLoadingSpecs: state.isLoadingSpecs,
        isQueued: state.isQueued,
        compareRunIdA: state.compareRunIdA,
        compareRunIdB: state.compareRunIdB,
        activeProject: state.activeProject,
        isConfigOpen: state.isConfigOpen,
        isConfigHiddenDesktop: state.isConfigHiddenDesktop
    })));

    const isConfigVisible = typeof window !== 'undefined' ? (window.innerWidth <= 768 ? isConfigOpen : !isConfigHiddenDesktop) : false;

    const isBusy = isRunning || isLoadingSpecs || isQueued;

    const betaModeEnabled = useAppStore((state) => state.betaModeEnabled);

    const [localUrl, setLocalUrl] = useState(baseUrl);
    const [isExportHovered, setIsExportHovered] = useState(false);

    useEffect(() => {
        setLocalUrl(baseUrl);
    }, [baseUrl]);

    const handleUrlCommit = (val: string) => {
        let cleanUrl = val.trim();
        if (!cleanUrl) {
            if (onChangeBaseUrl) onChangeBaseUrl('');
            setLocalUrl('');
            return;
        }

        try {
            const u = new URL(cleanUrl);
            cleanUrl = u.origin;
        } catch {
            // Not a full URL, leave as is
        }

        setLocalUrl(cleanUrl);
        if (onChangeBaseUrl && cleanUrl !== baseUrl) {
            onChangeBaseUrl(cleanUrl);
        }
    };

    const handleStartClick = () => {
        let cleanUrl = localUrl.trim();
        if (cleanUrl) {
            try {
                const u = new URL(cleanUrl);
                cleanUrl = u.origin;
            } catch {
                // Not a full URL, leave as is
            }
        }
        if (onChangeBaseUrl) {
            onChangeBaseUrl(cleanUrl);
        }
        onStart(cleanUrl);
    };

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

    const [groupedFindingsCount, setGroupedFindingsCount] = useState(0);
    const [owaspFindingsCount, setOwaspFindingsCount] = useState(0);
    const [vulnerableEndpoints, setVulnerableEndpoints] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!inspectorRunId || !isAnalysisEnabled) {
            setGroupedFindingsCount(0);
            setOwaspFindingsCount(0);
            setVulnerableEndpoints(new Set());
            return;
        }

        let active = true;
        const timer = setTimeout(() => {
            queryResults({ runId: inspectorRunId, findingsOnly: true, limit: 5000 })
                .then(res => {
                    if (active) {
                        let excl = new Set<number>();
                        try {
                            const saved = localStorage.getItem('swazz_excluded_statuses');
                            if (saved) {
                                const parsed = JSON.parse(saved);
                                if (Array.isArray(parsed)) {
                                    excl = new Set(parsed.map(Number));
                                }
                            }
                        } catch {}

                        const filteredRows = res.rows.filter(r => !excl.has(r.status));
                        setGroupedFindingsCount(getGroupedFindingsCount(filteredRows));
                        setOwaspFindingsCount(getOwaspFindingsCount(res.rows));

                        const vulnSet = new Set<string>();
                        for (const r of res.rows) {
                            const epKey = `${r.method.toUpperCase()} ${r.endpoint}`;
                            vulnSet.add(epKey);
                        }
                        setVulnerableEndpoints(vulnSet);
                    }
                })
                .catch(() => {});
        }, 1000);

        return () => {
            active = false;
            clearTimeout(timer);
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
            ) : activeTab === 'project_settings' ? (
                <ProjectSettings />
            ) : activeTab === 'about' ? (
                <AboutPage />
            ) : (
                <div className="workspace-main-layout">
                    {loadedRunId === null && (
                        <div className="workspace-control-bar">
                            <div className="workspace-url-section">
                                <svg className="url-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="2" y1="12" x2="22" y2="12"/>
                                    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                                </svg>
                                <input
                                    className="workspace-target-input header-target-input"
                                    value={localUrl}
                                    aria-label="Target API URL"
                                    onChange={(e) => setLocalUrl(e.target.value)}
                                    onBlur={() => handleUrlCommit(localUrl)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleUrlCommit(localUrl);
                                            e.currentTarget.blur();
                                        }
                                    }}
                                    placeholder="Enter target API URL (e.g. https://api.example.com)"
                                    readOnly={!onChangeBaseUrl}
                                />
                                {isBusy && !isLoadingSpecs && (
                                    <span className="workspace-status-indicator" />
                                )}
                            </div>

                            <div className="workspace-action-section">
                                {!isBusy ? (
                                    <button className="btn btn-primary btn-run" id="btn-start" onClick={handleStartClick}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                            <polygon points="5,3 19,12 5,21"/>
                                        </svg>
                                        <span>Run Scan</span>
                                    </button>
                                ) : (
                                    <div className="action-button-group">
                                        {!isLoadingSpecs && (
                                            isPaused ? (
                                                <button className="btn btn-success" onClick={onResume} title="Resume">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                                        <polygon points="5,3 19,12 5,21"/>
                                                    </svg>
                                                    <span>Resume</span>
                                                </button>
                                            ) : (
                                                <button className="btn btn-ghost" onClick={onPause} title="Pause">
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                                        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                                                    </svg>
                                                    <span>Pause</span>
                                                </button>
                                            )
                                        )}
                                        <button className="btn btn-danger" onClick={onStop} title="Stop">
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                            </svg>
                                            <span>Stop</span>
                                        </button>
                                    </div>
                                )}
                                
                                {!isConfigVisible && onToggleConfig && (
                                    <button 
                                        className="btn btn-ghost btn-icon btn-config-gear"
                                        onClick={onToggleConfig}
                                        title="Configure Fuzzer Settings"
                                        aria-label="Configure Fuzzer Settings"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="3"/>
                                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {betaModeEnabled && (
                        <div className="beta-status-alert">
                            <span className="beta-alert-dot" />
                            <span className="beta-alert-text">
                                <strong>Closed Beta Phase:</strong> System capacity is currently limited. Signups are subject to invite controls.
                            </span>
                        </div>
                    )}



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
                                {groupedFindingsCount > 0 && (
                                    <span className="tab-bar-count">{groupedFindingsCount.toLocaleString()}</span>
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
                                {owaspFindingsCount > 0 && (
                                    <span className="tab-bar-count">{owaspFindingsCount.toLocaleString()}</span>
                                )}
                            </button>
                        )}
                        <button
                            className={`tab-bar-btn ${activeTab === 'runner_logs' ? 'active' : ''}`}
                            onClick={() => useAppStore.setState({ activeTab: 'runner_logs' })}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                            </svg>
                            Runner Logs
                        </button>
                        <button
                            className={`tab-bar-btn ${activeTab === 'history' ? 'active' : ''}`}
                            onClick={() => useAppStore.setState({ activeTab: 'history' })}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            History
                            {runs.length > 0 && (
                                <span className="tab-bar-count">{runs.length}</span>
                            )}
                        </button>
                        <button
                            className={`tab-bar-btn ${activeTab === 'analytics' ? 'active' : ''}`}
                            onClick={() => useAppStore.setState({ activeTab: 'analytics' })}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="20" x2="18" y2="10"></line>
                                <line x1="12" y1="20" x2="12" y2="4"></line>
                                <line x1="6" y1="20" x2="6" y2="14"></line>
                            </svg>
                            Analytics
                        </button>
                        {compareRunIdA && compareRunIdB && (
                            <button
                                className={`tab-bar-btn ${activeTab === 'compare' ? 'active' : ''}`}
                                onClick={() => useAppStore.setState({ activeTab: 'compare' })}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                    <line x1="12" y1="3" x2="12" y2="21" />
                                </svg>
                                Compare Scans
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
                                        onClick={() => handleExportHTML(inspectorRunId)}
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
                                        onClick={() => handleExportMD(inspectorRunId)}
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

                    {activeTab === 'history' ? (
                        <HistoryPage 
                            runs={runs}
                            onLoadRun={(runId, importedRun) => {
                                handleLoadRun(runId, importedRun);
                                useAppStore.setState({ activeTab: 'heatmap' });
                            }}
                            onDeleteRun={handleDeleteRun}
                            onImportRun={onImportRun}
                            onExport={handleExport}
                            onExportHTML={handleExportHTML}
                            onExportMD={handleExportMD}
                        />
                    ) : !hasActivity ? (
                        <div className="welcome-workspace-wrapper">
                            <div className="welcome-workspace-container">
                                <div className="welcome-workspace-header">
                                    <div className="welcome-logo-container">
                                        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="welcome-fuzzer-logo">
                                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="url(#shield-grad)" stroke="var(--accent)"/>
                                            <path d="m13 7-5 6h4v4l5-6h-4V7z" fill="var(--accent-light)"/>
                                            <defs>
                                                <linearGradient id="shield-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3"/>
                                                    <stop offset="100%" stopColor="var(--accent-light)" stopOpacity="0.05"/>
                                                </linearGradient>
                                            </defs>
                                        </svg>
                                    </div>
                                    <h2 className="welcome-workspace-title">Ready to fuzz</h2>
                                    <p className="welcome-workspace-subtitle">Choose a scan mode below to begin discovering vulnerabilities</p>
                                </div>

                                <div className="welcome-modes-grid">
                                    {/* Mode 1: Try Demo */}
                                    <div className="welcome-mode-card demo-mode-card">
                                        <div className="mode-badge-wrapper">
                                            <span className="mode-badge">Automated</span>
                                        </div>
                                        <h3 className="mode-title">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mode-title-icon">
                                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                                            </svg>
                                            1-Click Vulnerable Demo
                                        </h3>
                                        <p className="mode-desc">
                                            Quickly explore the fuzzer features using a pre-configured target. The scanner will automatically load the API schema, discover endpoints, and trigger a sample fuzz scan.
                                        </p>
                                        <button
                                            className="btn btn-primary mode-action-btn"
                                            onClick={() => handleStart(['https://bbad.secmy.app/swagger.json'])}
                                        >
                                            Try Vulnerable Demo
                                        </button>
                                        <span className="mode-details-text">Target: https://bbad.secmy.app</span>
                                    </div>

                                    {/* Mode 2: Custom Scan */}
                                    <div className="welcome-mode-card custom-mode-card">
                                        <div className="mode-badge-wrapper">
                                            <span className="mode-badge secondary">Manual Config</span>
                                        </div>
                                        <h3 className="mode-title">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mode-title-icon">
                                                <line x1="4" y1="21" x2="4" y2="14"></line>
                                                <line x1="4" y1="10" x2="4" y2="3"></line>
                                                <line x1="12" y1="21" x2="12" y2="12"></line>
                                                <line x1="12" y1="8" x2="12" y2="3"></line>
                                                <line x1="20" y1="21" x2="20" y2="16"></line>
                                                <line x1="20" y1="12" x2="20" y2="3"></line>
                                                <line x1="1" y1="14" x2="7" y2="14"></line>
                                                <line x1="9" y1="8" x2="15" y2="8"></line>
                                                <line x1="17" y1="16" x2="23" y2="16"></line>
                                            </svg>
                                            Scan Custom API
                                        </h3>
                                        <p className="mode-desc">
                                            Configure and run a security scan targeting your own API endpoints.
                                        </p>
                                        <ul className="mode-steps-list">
                                            <li>
                                                <span className="mode-step-number">1</span>
                                                <span className="mode-step-text">
                                                    <strong>Specify Target URL:</strong> Enter your API base URL in the top address bar (e.g. <code>https://api.example.com</code>).
                                                </span>
                                            </li>
                                            <li>
                                                <span className="mode-step-number">2</span>
                                                <span className="mode-step-text">
                                                    <strong>Import Endpoints (Optional):</strong> Paste your Swagger/OpenAPI spec URL in the left sidebar to automatically parse and discover all endpoints.
                                                </span>
                                            </li>
                                            <li>
                                                <span className="mode-step-number">3</span>
                                                <span className="mode-step-text">
                                                    <strong>Customize & Run:</strong> Tweak profiles or headers in the sidebar, then hit <strong>Run Scan</strong>.
                                                </span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'heatmap' && (
                                <Dashboard
                                    stats={currentStats}
                                    endpointKeys={endpointKeys}
                                    vulnerableEndpoints={vulnerableEndpoints}
                                    heatmapFilter={heatmapFilter}
                                    onHeatmapFilter={(filter) => {
                                        useAppStore.setState({ heatmapFilter: filter });
                                        if (filter) useAppStore.setState({ activeTab: 'logs' });
                                    }}
                                    isRunning={isRunning}
                                    onTryDemo={() => handleStart(['https://bbad.secmy.app/swagger.json'])}
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
                                    onExport={() => handleExport(inspectorRunId, config.base_url)}
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
                                    onExport={() => handleExport(inspectorRunId, config.base_url)}
                                    findingsOnly={true}
                                    config={config}
                                    onUpdateCount={setGroupedFindingsCount}
                                />
                            )}
                            {isAnalysisEnabled && activeTab === 'owasp' && (
                                <OWASPTop10
                                    runId={inspectorRunId}
                                    queryResults={queryResults}
                                    liveCount={liveCount}
                                    isRunning={isRunning}
                                    onSelectResult={handleSelectResult}
                                    onUpdateCount={setOwaspFindingsCount}
                                />
                            )}
                            {activeTab === 'compare' && (
                                <ComparePage
                                    runs={runs}
                                    queryResults={queryResults}
                                    onSelectResult={handleSelectResult}
                                />
                            )}
                            {activeTab === 'analytics' && (
                                <AnalyticsDashboard projectId={config.projectId || activeProject?.id} />
                            )}
                            {activeTab === 'runner_logs' && (
                                <RunnerLogsViewer runId={inspectorRunId} isRunning={isRunning && !loadedRunId} />
                            )}
                        </>
                    )}
                </div>
            )}

        </div>
    );
}
