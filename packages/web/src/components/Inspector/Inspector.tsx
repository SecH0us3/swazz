import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { ResultSummary } from '../../hooks/useRunner.js';
import type { HeatmapFilter } from '../Dashboard/Heatmap.js';
import type { QueryOptions } from '../../hooks/useDb.js';

export type StatusFilter = 'all' | '2xx' | '4xx' | '5xx';

interface Props {
    runId: string | null;
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
    // liveCount triggers a reload when it changes during an active run
    liveCount?: number;
    heatmapFilter: HeatmapFilter | null;
    onClearHeatmapFilter: () => void;
    onSelectResult: (row: ResultSummary) => void;
    onExport: () => void;
    findingsOnly?: boolean;
}

function getStatusClass(status: number): string {
    if (status >= 500) return 'status-5xx';
    if (status >= 400) return 'status-4xx';
    return '';
}

function getBadgeClass(status: number): string {
    if (status >= 500) return 'badge badge-error';
    if (status >= 400) return 'badge badge-warning';
    if (status >= 200 && status < 300) return 'badge badge-success';
    return 'badge';
}

function formatBytes(bytes: number): string {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

const PAGE_SIZE = 1000;

export function Inspector({
    runId,
    queryResults,
    liveCount = 0,
    heatmapFilter,
    onClearHeatmapFilter,
    onSelectResult,
    onExport,
    findingsOnly = false,
}: Props) {
    const [filter, setFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: 'timestamp' | 'duration'; direction: 'asc' | 'desc' }>({ key: 'timestamp', direction: 'desc' });

    const [rows, setRows] = useState<ResultSummary[]>([]);
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [limit, setLimit] = useState(PAGE_SIZE);

    // Reset limit to PAGE_SIZE when runId changes
    useEffect(() => {
        setLimit(PAGE_SIZE);
    }, [runId]);

    const groupedFindings = useMemo(() => {
        if (!findingsOnly) return [];

        const groups: Record<string, { title: string; color: string; items: { result: ResultSummary; finding?: any }[] }> = {};

        for (const row of rows) {
            let placed = false;
            if (row.analyzerFindings && row.analyzerFindings.length > 0) {
                for (const f of row.analyzerFindings) {
                    placed = true;
                    let categoryTitle = 'Other Finding';
                    let groupKey = 'other';
                    let color = 'var(--color-info)';

                    if (f.ruleId === 'swazz/reflected-xss') {
                        color = 'var(--color-error)';
                        categoryTitle = 'Reflected XSS';
                        groupKey = 'reflected_xss';
                    } else if (f.ruleId === 'swazz/sqli-error' || f.ruleId === 'swazz/sql-error-leak') {
                        color = 'var(--color-error)';
                        const dbMatch = f.message?.match(/\(([^)]+)\)/);
                        const dbName = dbMatch ? dbMatch[1] : 'Generic';
                        categoryTitle = `SQLi Error: ${dbName}`;
                        groupKey = `sqli_${dbName.toLowerCase()}`;
                    } else if (f.ruleId === 'swazz/stack-trace' || f.ruleId === 'swazz/stack-trace-leak') {
                        color = 'var(--color-warning)';
                        const langMatch = f.message?.match(/\(([^)]+)\)/);
                        const lang = langMatch ? langMatch[1] : 'Generic';
                        categoryTitle = `Stack Trace Leak: ${lang}`;
                        groupKey = `stack_${lang.toLowerCase()}`;
                    } else if (f.ruleId === 'swazz/sensitive-data' || f.ruleId === 'swazz/sensitive-data-leak') {
                        color = 'var(--color-warning)';
                        const catMatch = f.message?.match(/\(([^)]+)\)/);
                        const catName = catMatch ? catMatch[1] : 'Sensitive Data';
                        categoryTitle = `Sensitive Data: ${catName}`;
                        groupKey = `sensitive_${catName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
                    } else {
                        categoryTitle = f.message || 'Suspicious Anomaly';
                        groupKey = `other_${f.ruleId.replace(/[^a-z0-9]+/g, '_')}`;
                    }

                    if (!groups[groupKey]) {
                        groups[groupKey] = { title: categoryTitle, color, items: [] };
                    }
                    groups[groupKey].items.push({ result: row, finding: f });
                }
            }

            if (!placed) {
                const isErrorStatus = row.status >= 500 || 
                                     (row.status === 0 && row.error) ||
                                     (row.status >= 400 && ![401, 403, 404, 405, 422, 429].includes(row.status));
                if (isErrorStatus) {
                    let categoryTitle = `HTTP ${row.status} Error`;
                    let groupKey = `status_${row.status}`;
                    let color = row.status >= 500 ? 'var(--color-error)' : 'var(--color-warning)';

                    if (row.status === 0) {
                        categoryTitle = 'Network Timeout / Error';
                        groupKey = 'status_0';
                        color = 'var(--color-error)';
                    }

                    if (!groups[groupKey]) {
                        groups[groupKey] = { title: categoryTitle, color, items: [] };
                    }
                    groups[groupKey].items.push({ result: row });
                }
            }
        }

        const colorPriority: Record<string, number> = {
            'var(--color-error)': 1,
            'var(--color-warning)': 2,
            'var(--color-info)': 3,
        };

        return Object.entries(groups)
            .filter(([_, group]) => group.items.length > 0)
            .map(([key, group]) => ({ key, ...group }))
            .sort((a, b) => {
                const prioA = colorPriority[a.color] || 99;
                const prioB = colorPriority[b.color] || 99;
                if (prioA !== prioB) return prioA - prioB;
                return a.title.localeCompare(b.title);
            });
    }, [rows, findingsOnly]);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    // Debounce search
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        searchDebounceRef.current && clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
        return () => { searchDebounceRef.current && clearTimeout(searchDebounceRef.current); };
    }, [search]);

    // Reload results from IDB when any filter/run changes or liveCount ticks
    const reloadRef = useRef(0);
    const loadResults = useCallback(async () => {
        if (!runId) {
            setRows([]);
            setTotal(0);
            return;
        }
        setIsLoading(true);
        const token = ++reloadRef.current;

        const statusFilter: StatusFilter = heatmapFilter ? 'all' : filter;
        const { rows: newRows, total: newTotal } = await queryResults({
            runId,
            statusFilter,
            search: debouncedSearch,
            sortKey: sortConfig.key,
            sortDir: sortConfig.direction,
            limit,
            findingsOnly,
        });

        // Apply heatmap filter client-side (small subset)
        let displayed = newRows;
        if (heatmapFilter) {
            displayed = newRows.filter(
                r =>
                    r.method.toUpperCase() === heatmapFilter.method.toUpperCase() &&
                    r.endpoint === heatmapFilter.path &&
                    r.status === heatmapFilter.status
            );
        }

        if (token === reloadRef.current) {
            setRows(displayed);
            setTotal(heatmapFilter ? displayed.length : newTotal);
            setIsLoading(false);
        }
    }, [runId, filter, debouncedSearch, sortConfig, heatmapFilter, queryResults, findingsOnly, limit]);

    // Re-query when filters change
    useEffect(() => { loadResults(); }, [loadResults]);

    // Re-query on live count tick (throttled by useFuzzSession already)
    const prevLiveCount = useRef(0);
    useEffect(() => {
        if (liveCount !== prevLiveCount.current) {
            prevLiveCount.current = liveCount;
            loadResults();
        }
    }, [liveCount, loadResults]);

    const count5xx = rows.filter(r => r.status >= 500).length;

    const tabs: { key: StatusFilter; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: '5xx', label: '5xx' },
        { key: '4xx', label: '4xx' },
        { key: '2xx', label: '2xx' },
    ];

    return (
        <div className="inspector">
            <div className="inspector-header">
                {heatmapFilter ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Filtered:</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                            {heatmapFilter.method.toUpperCase()} {heatmapFilter.path}
                        </span>
                        <span
                            style={{
                                background: heatmapFilter.status >= 500 ? 'var(--color-error-bg)' :
                                    heatmapFilter.status >= 400 ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
                                color: heatmapFilter.status >= 500 ? 'var(--color-error)' :
                                    heatmapFilter.status >= 400 ? 'var(--color-warning)' : 'var(--color-success)',
                                fontFamily: 'var(--font-mono)', fontSize: 12, padding: '2px 7px',
                                borderRadius: 'var(--radius-full)', fontWeight: 600,
                            }}
                        >
                            {heatmapFilter.status}
                        </span>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-disabled)' }}>{total} results</span>
                        <button
                            onClick={onClearHeatmapFilter}
                            style={{
                                background: 'transparent', border: 'none', color: 'var(--text-disabled)',
                                cursor: 'pointer', fontSize: 12, padding: '2px 4px',
                                borderRadius: 'var(--radius-sm)', transition: 'color var(--duration-fast)',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-error)')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-disabled)')}
                        >
                            ✕ clear
                        </button>
                    </div>
                ) : findingsOnly ? (
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        Detected Vulnerability Findings
                    </div>
                ) : (
                    <div className="inspector-tabs">
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                className={`inspector-tab ${filter === tab.key ? 'active' : ''}`}
                                onClick={() => setFilter(tab.key)}
                            >
                                {tab.label}
                                {tab.key === '5xx' && count5xx > 0 && (
                                    <span className="badge badge-error" style={{ marginLeft: 5, fontSize: 12, padding: '0 5px' }}>
                                        {count5xx}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flex: 1 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
                        >
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            className="input inspector-search"
                            placeholder="Filter by path…"
                            aria-label="Filter by path"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ flex: 1, paddingLeft: 28, paddingRight: search ? 28 : undefined, width: '100%' }}
                        />
                        {search && (
                            <button
                                className="btn btn-icon"
                                style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, padding: 0, minHeight: 0, minWidth: 0 }}
                                onClick={() => setSearch('')}
                                aria-label="Clear search"
                            >✕</button>
                        )}
                    </div>
                    {isLoading && (
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>loading…</span>
                    )}
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-disabled)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {total.toLocaleString()} req{total !== 1 ? 's' : ''}
                        {total > limit && (
                            <>
                                <span>(showing {Math.min(rows.length, limit).toLocaleString()})</span>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    style={{
                                        padding: '2px 4px',
                                        height: 'auto',
                                        minHeight: 0,
                                        minWidth: 0,
                                        color: 'var(--accent-light)',
                                        textDecoration: 'underline',
                                        fontSize: 'var(--font-size-xs)',
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => setLimit(total)}
                                >
                                    show all
                                </button>
                            </>
                        )}
                    </span>
                    <button
                        className="btn btn-ghost btn-sm"
                        title="Export results as JSON"
                        onClick={onExport}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export
                    </button>
                </div>
            </div>

            <div className={`request-log ${findingsOnly ? 'findings-only' : ''}`}>
                {rows.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">🔍</div>
                        <div className="empty-state-title">
                            {!runId ? 'Waiting for requests' : isLoading ? 'Loading…' : 'No matching requests'}
                        </div>
                        <div className="empty-state-text">
                            {!runId
                                ? 'Start a fuzz test to see results appear here in real time.'
                                : isLoading ? '' : 'Try adjusting filters or search query.'}
                        </div>
                    </div>
                ) : findingsOnly ? (
                    <div className="findings-group-container">
                        {groupedFindings.map((group) => (
                            <div key={group.key} className="findings-group">
                                <div 
                                    className="findings-group-header" 
                                    onClick={() => toggleGroup(group.key)}
                                >
                                    <div className="findings-group-title-row">
                                        <span className={`findings-group-chevron ${!expandedGroups[group.key] ? 'collapsed' : ''}`}>▼</span>
                                        <span className="findings-group-title">{group.title}</span>
                                        <span className="findings-group-count" style={{ background: group.color }}>
                                            {group.items.length}
                                        </span>
                                    </div>
                                </div>
                                {expandedGroups[group.key] && (
                                    <div className="findings-group-items">
                                        {group.items.map((item, idx) => (
                                            <div 
                                                key={idx} 
                                                className="finding-item" 
                                                onClick={() => onSelectResult(item.result)}
                                                style={{ borderLeft: `3px solid ${group.color}` }}
                                            >
                                                <div className="finding-item-row">
                                                    <div className="finding-item-endpoint">
                                                        <span className={`method method-${item.result.method.toLowerCase()}`}>{item.result.method}</span>
                                                        <span className="finding-item-path">{item.result.endpoint}</span>
                                                    </div>
                                                    <span className={getBadgeClass(item.result.status)}>
                                                        {item.result.status || 'ERR'}
                                                    </span>
                                                </div>
                                                {item.finding?.message && (
                                                    <div className="finding-item-message">
                                                        {item.finding.message}
                                                    </div>
                                                )}
                                                {item.result.status >= 500 && !item.finding && (
                                                    <div className="finding-item-message">
                                                        Server returned unhandled error status {item.result.status}
                                                    </div>
                                                )}
                                                {item.finding?.evidence && (
                                                    <div className="finding-item-evidence" title={item.finding.evidence}>
                                                        <strong>Evidence:</strong> {item.finding.evidence}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {total > rows.length && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4)' }}>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setLimit(prev => prev + 1000)}
                                >
                                    Load More (showing {rows.length} of {total})
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="log-row log-header">
                            <span>Time</span>
                            <span>Method</span>
                            <span>Endpoint</span>
                            <span>Payload</span>
                            <span>Status</span>
                            <span>Profile</span>
                            <span>Size</span>
                            <span>Duration</span>
                        </div>
                        <Virtuoso
                            style={{ height: '100%', flex: 1 }}
                            data={rows}
                            endReached={() => {
                                if (total > rows.length && !isLoading) {
                                    setLimit(prev => prev + 1000);
                                }
                            }}
                            itemContent={(_index, r) => (
                                <div
                                    key={r.id}
                                    className={`log-row ${getStatusClass(r.status)}`}
                                    onClick={() => onSelectResult(r)}
                                >
                                    <span className="log-timestamp">{formatTime(r.timestamp)}</span>
                                    <span className={`method method-${r.method.toLowerCase()}`}>{r.method}</span>
                                    <span className="log-path">{r.endpoint}</span>
                                    <span className="log-payload" title={r.payloadPreview}>
                                        {r.payloadPreview?.replace(/\s+/g, ' ')}
                                    </span>
                                    <span className={getBadgeClass(r.status)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        {r.status >= 500 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>}
                                        {r.status >= 400 && r.status < 500 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>}
                                        {r.status >= 200 && r.status < 300 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>}
                                        {r.status || 'ERR'}
                                    </span>
                                    <span className="badge-profile">{r.profile}</span>
                                    <span className="log-size">{formatBytes(r.payloadSize)}</span>
                                    <span className="log-duration">{r.duration}ms</span>
                                </div>
                            )}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
