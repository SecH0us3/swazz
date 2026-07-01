import React, { useEffect, useState, useMemo } from 'react';
import type { ScanRun, QueryOptions } from '../hooks/useDb.js';
import type { ResultSummary } from '../hooks/useRunner.js';
import { useAppStore } from '../store/appStore.js';
import { compareScans } from '../utils/compare.js';

interface ComparePageProps {
    runs: ScanRun[];
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
    onSelectResult: (r: ResultSummary) => void;
}

interface FindingListItem {
    id: string;
    result: ResultSummary;
    ruleId: string;
    level: 'error' | 'warning' | 'note';
    message: string;
    payload?: string;
    type: 'new' | 'fixed' | 'common';
}

function formatDate(epoch: number): string {
    if (!epoch) return '-';
    const d = new Date(epoch);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatDuration(start: number, end: number): string {
    if (!start || !end) return '-';
    const diffMs = end - start;
    if (diffMs < 0) return '0s';
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return `${diffSecs}s`;
    const mins = Math.floor(diffSecs / 60);
    const secs = diffSecs % 60;
    return `${mins}m ${secs}s`;
}

function getCoverage(run: ScanRun | undefined): number {
    if (!run || !run.stats || !run.stats.progress) return 0;
    const { completedEndpoints, totalEndpoints } = run.stats.progress;
    if (typeof completedEndpoints !== 'number') throw new TypeError('completedEndpoints must be a number');
    if (typeof totalEndpoints !== 'number') throw new TypeError('totalEndpoints must be a number');
    if (totalEndpoints <= 0) return 0;
    return (completedEndpoints / totalEndpoints) * 100;
}

function getStatusCounts(run: ScanRun | undefined) {
    const counts = { '2xx': 0, '4xx': 0, '5xx': 0 };
    if (!run || !run.stats || !run.stats.statusCounts) return counts;
    for (const [codeStr, count] of Object.entries(run.stats.statusCounts)) {
        const code = parseInt(codeStr, 10);
        if (typeof count !== 'number') throw new TypeError('count must be a number');
        if (code >= 200 && code < 300) counts['2xx'] += count;
        else if (code >= 400 && code < 500) counts['4xx'] += count;
        else if (code >= 500 && code < 600) counts['5xx'] += count;
    }
    return counts;
}

function getSeverityCounts(rows: ResultSummary[]) {
    let errors = 0;
    let warnings = 0;
    let notes = 0;
    for (const row of rows) {
        if (row.analyzerFindings) {
            for (const f of row.analyzerFindings) {
                if (f.level === 'error') errors++;
                else if (f.level === 'warning') warnings++;
                else if (f.level === 'note') notes++;
            }
        }
    }
    return { errors, warnings, notes };
}

export function ComparePage({ runs, queryResults, onSelectResult }: ComparePageProps) {
    const compareRunIdA = useAppStore(state => state.compareRunIdA);
    const compareRunIdB = useAppStore(state => state.compareRunIdB);

    const [isLoading, setIsLoading] = useState(false);
    const [rowsA, setRowsA] = useState<ResultSummary[]>([]);
    const [rowsB, setRowsB] = useState<ResultSummary[]>([]);
    const [comparison, setComparison] = useState<{
        newFindings: ResultSummary[];
        fixedFindings: ResultSummary[];
        commonFindings: ResultSummary[];
    } | null>(null);

    const [activeTab, setActiveTab] = useState<'new' | 'fixed' | 'common' | 'all'>('new');
    const [search, setSearch] = useState('');
    const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'note'>('all');

    const runA = useMemo(() => runs.find(r => r.id === compareRunIdA), [runs, compareRunIdA]);
    const runB = useMemo(() => runs.find(r => r.id === compareRunIdB), [runs, compareRunIdB]);

    useEffect(() => {
        if (!compareRunIdA || !compareRunIdB) return;

        let active = true;
        setIsLoading(true);

        Promise.all([
            queryResults({ runId: compareRunIdA, limit: 100000 }),
            queryResults({ runId: compareRunIdB, limit: 100000 })
        ]).then(([resA, resB]) => {
            if (!active) return;
            setRowsA(resA.rows);
            setRowsB(resB.rows);
            const diff = compareScans(resA.rows, resB.rows);
            setComparison(diff);
            setIsLoading(false);
        }).catch(err => {
            console.error("Failed to fetch runs for comparison", err);
            if (active) setIsLoading(false);
        });

        return () => {
            active = false;
        };
    }, [compareRunIdA, compareRunIdB, queryResults]);

    const handleGoBack = () => {
        useAppStore.setState({
            compareRunIdA: null,
            compareRunIdB: null,
            activeTab: 'history'
        });
    };

    const countsA = useMemo(() => getSeverityCounts(rowsA), [rowsA]);
    const countsB = useMemo(() => getSeverityCounts(rowsB), [rowsB]);

    const statusCountsA = useMemo(() => getStatusCounts(runA), [runA]);
    const statusCountsB = useMemo(() => getStatusCounts(runB), [runB]);
    const maxStatusVal = useMemo(() => {
        return Math.max(
            statusCountsA['2xx'],
            statusCountsB['2xx'],
            statusCountsA['4xx'],
            statusCountsB['4xx'],
            statusCountsA['5xx'],
            statusCountsB['5xx'],
            1
        );
    }, [statusCountsA, statusCountsB]);

    const coverageA = useMemo(() => getCoverage(runA), [runA]);
    const coverageB = useMemo(() => getCoverage(runB), [runB]);
    const coverageDelta = useMemo(() => coverageB - coverageA, [coverageA, coverageB]);

    const keysA = useMemo(() => {
        const keys = new Set<string>();
        for (const r of rowsA) {
            if (r.analyzerFindings) {
                for (const f of r.analyzerFindings) {
                    keys.add(`${f.ruleId}|${r.method.toUpperCase()}|${r.endpoint}`);
                }
            }
        }
        return keys;
    }, [rowsA]);

    const keysB = useMemo(() => {
        const keys = new Set<string>();
        for (const r of rowsB) {
            if (r.analyzerFindings) {
                for (const f of r.analyzerFindings) {
                    keys.add(`${f.ruleId}|${r.method.toUpperCase()}|${r.endpoint}`);
                }
            }
        }
        return keys;
    }, [rowsB]);

    const newFindingsList = useMemo(() => {
        const list: FindingListItem[] = [];
        if (!comparison) return list;
        for (const r of rowsB) {
            if (r.analyzerFindings) {
                r.analyzerFindings.forEach((f, idx) => {
                    const key = `${f.ruleId}|${r.method.toUpperCase()}|${r.endpoint}`;
                    if (!keysA.has(key)) {
                        list.push({
                            id: `new-${key}-${r.id}-${idx}`,
                            result: r,
                            ruleId: f.ruleId,
                            level: f.level,
                            message: f.message,
                            payload: r.payloadPreview,
                            type: 'new'
                        });
                    }
                });
            }
        }
        return list;
    }, [comparison, rowsB, keysA]);

    const fixedFindingsList = useMemo(() => {
        const list: FindingListItem[] = [];
        if (!comparison) return list;
        for (const r of rowsA) {
            if (r.analyzerFindings) {
                r.analyzerFindings.forEach((f, idx) => {
                    const key = `${f.ruleId}|${r.method.toUpperCase()}|${r.endpoint}`;
                    if (!keysB.has(key)) {
                        list.push({
                            id: `fixed-${key}-${r.id}-${idx}`,
                            result: r,
                            ruleId: f.ruleId,
                            level: f.level,
                            message: f.message,
                            payload: r.payloadPreview,
                            type: 'fixed'
                        });
                    }
                });
            }
        }
        return list;
    }, [comparison, rowsA, keysB]);

    const commonFindingsList = useMemo(() => {
        const list: FindingListItem[] = [];
        if (!comparison) return list;
        for (const r of rowsB) {
            if (r.analyzerFindings) {
                r.analyzerFindings.forEach((f, idx) => {
                    const key = `${f.ruleId}|${r.method.toUpperCase()}|${r.endpoint}`;
                    if (keysA.has(key) && keysB.has(key)) {
                        list.push({
                            id: `common-${key}-${r.id}-${idx}`,
                            result: r,
                            ruleId: f.ruleId,
                            level: f.level,
                            message: f.message,
                            payload: r.payloadPreview,
                            type: 'common'
                        });
                    }
                });
            }
        }
        return list;
    }, [comparison, rowsB, keysA, keysB]);

    const allFindingsList = useMemo(() => {
        return [...newFindingsList, ...fixedFindingsList, ...commonFindingsList];
    }, [newFindingsList, fixedFindingsList, commonFindingsList]);

    const activeList = useMemo(() => {
        if (activeTab === 'new') return newFindingsList;
        if (activeTab === 'fixed') return fixedFindingsList;
        if (activeTab === 'common') return commonFindingsList;
        return allFindingsList;
    }, [activeTab, newFindingsList, fixedFindingsList, commonFindingsList, allFindingsList]);

    const filteredList = useMemo(() => {
        const query = search.toLowerCase().trim();
        return activeList.filter(item => {
            const matchesSeverity = severityFilter === 'all' || item.level === severityFilter;
            const matchesSearch = !query ||
                item.ruleId.toLowerCase().includes(query) ||
                item.result.endpoint.toLowerCase().includes(query) ||
                item.message.toLowerCase().includes(query) ||
                (item.payload && item.payload.toLowerCase().includes(query));
            return matchesSeverity && matchesSearch;
        });
    }, [activeList, severityFilter, search]);

    const handleViewInInspector = (result: ResultSummary) => {
        onSelectResult(result);
    };

    if (!compareRunIdA || !compareRunIdB) {
        return (
            <div className="compare-dashboard">
                <div className="compare-empty-list">
                    <h3>No Scans Selected</h3>
                    <p>Please select two scans from the history page to compare them side-by-side.</p>
                    <button
                        id="compare-empty-back-btn"
                        className="btn btn-primary"
                        onClick={handleGoBack}
                    >
                        Go to Scan History
                    </button>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="compare-loading-state">
                <div className="compare-spinner" />
                <p>Analyzing and diffing scan results...</p>
            </div>
        );
    }

    const maxChartVal = Math.max(
        countsA.errors,
        countsA.warnings,
        countsA.notes,
        countsB.errors,
        countsB.warnings,
        countsB.notes,
        1
    );
    const chartHeight = 120;
    const scale = chartHeight / maxChartVal;

    return (
        <div className="compare-dashboard">
            {/* Header */}
            <div className="compare-header">
                <div>
                    <button
                        id="compare-back-to-history-btn"
                        className="btn btn-ghost btn-sm"
                        onClick={handleGoBack}
                    >
                        ← Back to History
                    </button>
                    <h1 className="compare-header-title">Scan Comparison</h1>
                    <p className="compare-header-subtitle">
                        Comparing Base Scan vs Target Scan
                    </p>
                </div>
            </div>

            {/* Run Metadata Grid */}
            <div className="compare-meta-grid">
                <div className="compare-run-column">
                    <h2 className="compare-run-title">
                        <span className="badge badge-secondary">Base</span> Run A
                    </h2>
                    <div className="compare-meta-cards">
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">Date</span>
                            <span className="compare-meta-value">{runA ? formatDate(runA.startedAt) : '-'}</span>
                        </div>
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">URL</span>
                            <span className="compare-meta-value">{runA?.baseUrl || '(no url)'}</span>
                        </div>
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">Duration</span>
                            <span className="compare-meta-value">{runA ? formatDuration(runA.startedAt, runA.completedAt) : '-'}</span>
                        </div>
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">Total Requests</span>
                            <span className="compare-meta-value">{runA?.stats?.totalRequests?.toLocaleString() || 0}</span>
                        </div>
                    </div>
                </div>

                <div className="compare-run-column">
                    <h2 className="compare-run-title">
                        <span className="badge badge-primary">Target</span> Run B
                    </h2>
                    <div className="compare-meta-cards">
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">Date</span>
                            <span className="compare-meta-value">{runB ? formatDate(runB.startedAt) : '-'}</span>
                        </div>
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">URL</span>
                            <span className="compare-meta-value">{runB?.baseUrl || '(no url)'}</span>
                        </div>
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">Duration</span>
                            <span className="compare-meta-value">{runB ? formatDuration(runB.startedAt, runB.completedAt) : '-'}</span>
                        </div>
                        <div className="compare-meta-card">
                            <span className="compare-meta-label">Total Requests</span>
                            <span className="compare-meta-value">{runB?.stats?.totalRequests?.toLocaleString() || 0}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Metrics Shifts */}
            <div className="compare-metrics-grid">
                {/* SVG Severity Shifts */}
                <div className="compare-chart-card">
                    <h3 className="compare-chart-title">Severity Distribution Shift</h3>
                    <div className="compare-chart-body">
                        <svg viewBox="0 0 500 180" className="compare-svg-chart">
                            <line x1="40" y1="20" x2="460" y2="20" stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="4 4" />
                            <line x1="40" y1="80" x2="460" y2="80" stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="4 4" />
                            <line x1="40" y1="140" x2="460" y2="140" stroke="var(--border-subtle)" strokeWidth="1" />

                            {/* Errors */}
                            <rect
                                x="60"
                                y={140 - countsA.errors * scale}
                                width="32"
                                height={countsA.errors * scale}
                                fill="var(--color-error)"
                                className="compare-svg-bar base-run"
                                rx="4"
                            />
                            {countsA.errors > 0 && (
                                <text x="76" y={130 - countsA.errors * scale} fill="var(--text-secondary)" fontSize="10" textAnchor="middle" fontWeight="600">
                                    {countsA.errors}
                                </text>
                            )}

                            <rect
                                x="98"
                                y={140 - countsB.errors * scale}
                                width="32"
                                height={countsB.errors * scale}
                                fill="var(--color-error)"
                                className="compare-svg-bar target-run"
                                rx="4"
                            />
                            {countsB.errors > 0 && (
                                <text x="114" y={130 - countsB.errors * scale} fill="var(--text-primary)" fontSize="10" textAnchor="middle" fontWeight="600">
                                    {countsB.errors}
                                </text>
                            )}

                            {/* Warnings */}
                            <rect
                                x="190"
                                y={140 - countsA.warnings * scale}
                                width="32"
                                height={countsA.warnings * scale}
                                fill="var(--color-warning)"
                                className="compare-svg-bar base-run"
                                rx="4"
                            />
                            {countsA.warnings > 0 && (
                                <text x="206" y={130 - countsA.warnings * scale} fill="var(--text-secondary)" fontSize="10" textAnchor="middle" fontWeight="600">
                                    {countsA.warnings}
                                </text>
                            )}

                            <rect
                                x="228"
                                y={140 - countsB.warnings * scale}
                                width="32"
                                height={countsB.warnings * scale}
                                fill="var(--color-warning)"
                                className="compare-svg-bar target-run"
                                rx="4"
                            />
                            {countsB.warnings > 0 && (
                                <text x="244" y={130 - countsB.warnings * scale} fill="var(--text-primary)" fontSize="10" textAnchor="middle" fontWeight="600">
                                    {countsB.warnings}
                                </text>
                            )}

                            {/* Notes */}
                            <rect
                                x="320"
                                y={140 - countsA.notes * scale}
                                width="32"
                                height={countsA.notes * scale}
                                fill="var(--color-info)"
                                className="compare-svg-bar base-run"
                                rx="4"
                            />
                            {countsA.notes > 0 && (
                                <text x="336" y={130 - countsA.notes * scale} fill="var(--text-secondary)" fontSize="10" textAnchor="middle" fontWeight="600">
                                    {countsA.notes}
                                </text>
                            )}

                            <rect
                                x="358"
                                y={140 - countsB.notes * scale}
                                width="32"
                                height={countsB.notes * scale}
                                fill="var(--color-info)"
                                className="compare-svg-bar target-run"
                                rx="4"
                            />
                            {countsB.notes > 0 && (
                                <text x="374" y={130 - countsB.notes * scale} fill="var(--text-primary)" fontSize="10" textAnchor="middle" fontWeight="600">
                                    {countsB.notes}
                                </text>
                            )}

                            {/* X-axis labels */}
                            <text x="95" y="160" fill="var(--text-muted)" fontSize="12" textAnchor="middle" fontWeight="500">Errors</text>
                            <text x="225" y="160" fill="var(--text-muted)" fontSize="12" textAnchor="middle" fontWeight="500">Warnings</text>
                            <text x="355" y="160" fill="var(--text-muted)" fontSize="12" textAnchor="middle" fontWeight="500">Notes</text>

                            {/* Legend */}
                            <rect x="420" y="40" width="12" height="12" fill="var(--text-muted)" opacity="0.5" rx="2" />
                            <text x="438" y="50" fill="var(--text-muted)" fontSize="10" fontWeight="500">Run A</text>

                            <rect x="420" y="60" width="12" height="12" fill="var(--text-primary)" rx="2" />
                            <text x="438" y="70" fill="var(--text-muted)" fontSize="10" fontWeight="500">Run B</text>
                        </svg>
                    </div>
                </div>

                {/* Coverage & Status Codes */}
                <div className="compare-chart-card">
                    <div className="compare-coverage-card">
                        <div className="compare-coverage-row">
                            <h3 className="compare-chart-title">Coverage Shift</h3>
                            <div className="compare-coverage-val-group">
                                <div className="compare-coverage-big-val">
                                    {coverageB.toFixed(1)}%
                                </div>
                                <span className={coverageDelta >= 0 ? 'badge badge-success' : 'badge badge-error'}>
                                    {coverageDelta >= 0 ? '+' : ''}{coverageDelta.toFixed(1)}%
                                </span>
                            </div>
                        </div>

                        <div className="compare-coverage-bar-track">
                            <div
                                className="compare-coverage-bar-fill base"
                                style={{ '--bar-width': `${coverageA}%` } as React.CSSProperties}
                            />
                            <div
                                className="compare-coverage-bar-fill target"
                                style={{ '--bar-width': `${coverageB}%` } as React.CSSProperties}
                            />
                        </div>
                        <div className="compare-coverage-row">
                            <span className="compare-meta-label">Run A: {coverageA.toFixed(1)}%</span>
                            <span className="compare-meta-label">Run B: {coverageB.toFixed(1)}%</span>
                        </div>
                    </div>

                    <div className="compare-status-distribution">
                        <h3 className="compare-chart-title">Status Code Shifts</h3>

                        {/* 2xx */}
                        <div className="compare-status-row">
                            <span className="compare-status-label">2xx</span>
                            <div className="compare-status-bars">
                                <div className="compare-status-bar-wrapper">
                                    <span className="compare-status-bar-label">Run A</span>
                                    <div className="compare-status-bar-bg">
                                        <div
                                            className="compare-status-bar-fill base-run"
                                            style={{
                                                '--bar-width': `${(statusCountsA['2xx'] / maxStatusVal) * 100}%`,
                                                backgroundColor: 'var(--color-success)'
                                            } as React.CSSProperties}
                                        />
                                    </div>
                                    <span className="compare-status-count-text">{statusCountsA['2xx'].toLocaleString()}</span>
                                </div>
                                <div className="compare-status-bar-wrapper">
                                    <span className="compare-status-bar-label">Run B</span>
                                    <div className="compare-status-bar-bg">
                                        <div
                                            className="compare-status-bar-fill target-run"
                                            style={{
                                                '--bar-width': `${(statusCountsB['2xx'] / maxStatusVal) * 100}%`,
                                                backgroundColor: 'var(--color-success)'
                                            } as React.CSSProperties}
                                        />
                                    </div>
                                    <span className="compare-status-count-text">{statusCountsB['2xx'].toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {/* 4xx */}
                        <div className="compare-status-row">
                            <span className="compare-status-label">4xx</span>
                            <div className="compare-status-bars">
                                <div className="compare-status-bar-wrapper">
                                    <span className="compare-status-bar-label">Run A</span>
                                    <div className="compare-status-bar-bg">
                                        <div
                                            className="compare-status-bar-fill base-run"
                                            style={{
                                                '--bar-width': `${(statusCountsA['4xx'] / maxStatusVal) * 100}%`,
                                                backgroundColor: 'var(--color-warning)'
                                            } as React.CSSProperties}
                                        />
                                    </div>
                                    <span className="compare-status-count-text">{statusCountsA['4xx'].toLocaleString()}</span>
                                </div>
                                <div className="compare-status-bar-wrapper">
                                    <span className="compare-status-bar-label">Run B</span>
                                    <div className="compare-status-bar-bg">
                                        <div
                                            className="compare-status-bar-fill target-run"
                                            style={{
                                                '--bar-width': `${(statusCountsB['4xx'] / maxStatusVal) * 100}%`,
                                                backgroundColor: 'var(--color-warning)'
                                            } as React.CSSProperties}
                                        />
                                    </div>
                                    <span className="compare-status-count-text">{statusCountsB['4xx'].toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {/* 5xx */}
                        <div className="compare-status-row">
                            <span className="compare-status-label">5xx</span>
                            <div className="compare-status-bars">
                                <div className="compare-status-bar-wrapper">
                                    <span className="compare-status-bar-label">Run A</span>
                                    <div className="compare-status-bar-bg">
                                        <div
                                            className="compare-status-bar-fill base-run"
                                            style={{
                                                '--bar-width': `${(statusCountsA['5xx'] / maxStatusVal) * 100}%`,
                                                backgroundColor: 'var(--color-error)'
                                            } as React.CSSProperties}
                                        />
                                    </div>
                                    <span className="compare-status-count-text">{statusCountsA['5xx'].toLocaleString()}</span>
                                </div>
                                <div className="compare-status-bar-wrapper">
                                    <span className="compare-status-bar-label">Run B</span>
                                    <div className="compare-status-bar-bg">
                                        <div
                                            className="compare-status-bar-fill target-run"
                                            style={{
                                                '--bar-width': `${(statusCountsB['5xx'] / maxStatusVal) * 100}%`,
                                                backgroundColor: 'var(--color-error)'
                                            } as React.CSSProperties}
                                        />
                                    </div>
                                    <span className="compare-status-count-text">{statusCountsB['5xx'].toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Findings Diff Lists */}
            <div className="compare-diff-section">
                <div className="compare-tabs-row">
                    <div className="compare-tabs">
                        <button
                            id="compare-tab-new"
                            className={`compare-tab-btn ${activeTab === 'new' ? 'active' : ''}`}
                            onClick={() => setActiveTab('new')}
                        >
                            New Findings
                            <span className="compare-tab-count">{newFindingsList.length}</span>
                        </button>
                        <button
                            id="compare-tab-fixed"
                            className={`compare-tab-btn ${activeTab === 'fixed' ? 'active' : ''}`}
                            onClick={() => setActiveTab('fixed')}
                        >
                            Fixed Findings
                            <span className="compare-tab-count">{fixedFindingsList.length}</span>
                        </button>
                        <button
                            id="compare-tab-common"
                            className={`compare-tab-btn ${activeTab === 'common' ? 'active' : ''}`}
                            onClick={() => setActiveTab('common')}
                        >
                            Common Findings
                            <span className="compare-tab-count">{commonFindingsList.length}</span>
                        </button>
                        <button
                            id="compare-tab-all"
                            className={`compare-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                            onClick={() => setActiveTab('all')}
                        >
                            All Findings
                            <span className="compare-tab-count">{allFindingsList.length}</span>
                        </button>
                    </div>

                    <div className="compare-filters">
                        <div className="compare-search-wrapper">
                            <svg className="compare-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                                id="compare-search-input"
                                type="text"
                                className="compare-search-input"
                                placeholder="Search findings..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>

                        <select
                            id="compare-severity-filter"
                            className="compare-select"
                            value={severityFilter}
                            onChange={e => setSeverityFilter(e.target.value as any)}
                        >
                            <option value="all">All Severities</option>
                            <option value="error">Errors</option>
                            <option value="warning">Warnings</option>
                            <option value="note">Notes</option>
                        </select>
                    </div>
                </div>

                {/* Findings List */}
                <div className="compare-list-wrapper">
                    {filteredList.length === 0 ? (
                        <div className="compare-empty-list">
                            No findings match the current filters.
                        </div>
                    ) : (
                        filteredList.map(item => {
                            let badgeClass = 'badge';
                            if (item.level === 'error') badgeClass = 'badge badge-error';
                            else if (item.level === 'warning') badgeClass = 'badge badge-warning';
                            else if (item.level === 'note') badgeClass = 'badge badge-info';

                            return (
                                <div key={item.id} className="compare-finding-card">
                                    <div className="compare-finding-header">
                                        <div className="compare-finding-meta">
                                            <div className="compare-finding-path-container">
                                                <span className={`method method-${item.result.method.toLowerCase()}`}>
                                                    {item.result.method}
                                                </span>
                                                <span>{item.result.endpoint}</span>
                                            </div>
                                            <span className={`compare-finding-type-badge ${item.type}`}>
                                                {item.type}
                                            </span>
                                            <span className={badgeClass}>
                                                {item.level}
                                            </span>
                                        </div>

                                        <button
                                            id={`compare-view-inspector-${item.id}`}
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleViewInInspector(item.result)}
                                        >
                                            View in Inspector
                                        </button>
                                    </div>

                                    <div className="compare-finding-rule-id">
                                        Rule: {item.ruleId}
                                    </div>

                                    <div className="compare-finding-message">
                                        {item.message}
                                    </div>

                                    {item.payload && (
                                        <pre className="compare-finding-payload">
                                            {item.payload}
                                        </pre>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
