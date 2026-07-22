import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { ResultSummary } from '../../hooks/useRunner.js';
import type { HeatmapFilter } from '../Dashboard/Heatmap.js';
import type { QueryOptions } from '../../hooks/useDb.js';
import type { AnalysisFinding, SwazzConfig } from '../../types.js';
import { extractErrorSubtype, getCleanDedupeKey } from '../../utils/errors.js';
import { categorizeFinding } from '../../utils/findings.js';
import { FindingItem } from './FindingItem.js';
import { StatusFilterDropdown } from './StatusFilterDropdown.js';
import {
    getStatusClass,
    getBadgeClass,
    formatBytes,
    formatTime,
    formatIdentityName
} from './utils.js';

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
    config?: SwazzConfig;
    onUpdateCount?: (count: number) => void;
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
    config,
    onUpdateCount,
}: Props) {
    const onSelectResultRef = useRef(onSelectResult);
    onSelectResultRef.current = onSelectResult;

    const handleSelectResultStable = useCallback((row: ResultSummary) => {
        onSelectResultRef.current(row);
    }, []);

    const [filter, setFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: 'timestamp' | 'duration'; direction: 'asc' | 'desc' }>({ key: 'timestamp', direction: 'desc' });

    const [rows, setRows] = useState<ResultSummary[]>([]);
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [groupLimits, setGroupLimits] = useState<Record<string, number>>({});
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const [identityFilter, setIdentityFilter] = useState<string>('all');
    const [seenIdentities, setSeenIdentities] = useState<Set<string>>(new Set(['User A']));

    // Reset identity filter and populate seen identities when run changes
    useEffect(() => {
        const initial = new Set<string>(['User A']);
        if (config?.auth_identities) {
            Object.keys(config.auth_identities).forEach(k => initial.add(k));
        }
        if (config?.settings?.bola_testing) {
            initial.add('Anonymous');
        }
        setSeenIdentities(initial);
        setIdentityFilter('all');
    }, [runId, config]);

    // Track identities from new rows loaded dynamically
    useEffect(() => {
        if (rows.length > 0) {
            setSeenIdentities(prev => {
                let changed = false;
                const next = new Set(prev);
                for (const r of rows) {
                    if (r.identity && !next.has(r.identity)) {
                        next.add(r.identity);
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }
    }, [rows]);

    const [excludedStatuses, setExcludedStatuses] = useState<Set<number>>(() => {
        try {
            const saved = localStorage.getItem('swazz_excluded_statuses');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    return new Set(parsed.map(Number));
                }
            }
        } catch (e) {
            console.error('Failed to load excluded statuses from localStorage', e);
        }
        return new Set();
    });
    const availableStatuses = useMemo(() => {
        if (!findingsOnly) return [];
        const statuses = new Set<number>();
        for (const row of rows) {
            statuses.add(row.status);
        }
        return Array.from(statuses).sort((a, b) => a - b);
    }, [rows, findingsOnly]);

    useEffect(() => {
        try {
            localStorage.setItem('swazz_excluded_statuses', JSON.stringify(Array.from(excludedStatuses)));
        } catch (e) {
            console.error('Failed to save excluded statuses to localStorage', e);
        }
    }, [excludedStatuses]);

    // Reset limit to PAGE_SIZE when runId changes
    useEffect(() => {
        setLimit(PAGE_SIZE);
    }, [runId]);

    const { securityVulnerabilities, infrastructureErrors } = useMemo(() => {
        if (!findingsOnly) return { securityVulnerabilities: [], infrastructureErrors: [] };

        const securityGroups: Record<
            string,
            {
                title: string;
                color: string;
                items: { result: ResultSummary; finding?: AnalysisFinding; count: number }[];
                seenMap: Map<string, { result: ResultSummary; finding?: AnalysisFinding; count: number }>;
            }
        > = {};

        const infraGroups: Record<
            string,
            {
                title: string;
                color: string;
                items: { result: ResultSummary; finding?: AnalysisFinding; count: number }[];
                seenMap: Map<string, { result: ResultSummary; finding?: AnalysisFinding; count: number }>;
            }
        > = {};

        const filteredRows = rows.filter(row => !excludedStatuses.has(row.status));

        for (const row of filteredRows) {
            let placed = false;
            if (row.analyzerFindings && row.analyzerFindings.length > 0) {
                for (const f of row.analyzerFindings) {
                    placed = true;
                    const { title, color, key: groupKey } = categorizeFinding(f, row.responsePreview);

                    if (!securityGroups[groupKey]) {
                        securityGroups[groupKey] = { title, color, items: [], seenMap: new Map() };
                    }
                    const dedupeKey = `${row.method} ${row.endpoint}::${f.ruleId}::${f.message}`;
                    const existing = securityGroups[groupKey].seenMap.get(dedupeKey);
                    if (existing) {
                        existing.count += 1;
                    } else {
                        const newItem = { result: row, finding: f, count: 1 };
                        securityGroups[groupKey].seenMap.set(dedupeKey, newItem);
                        securityGroups[groupKey].items.push(newItem);
                    }
                }
            }

            if (!placed) {
                const isMcpErr = row.method === 'CALL' || row.method === 'MCP' || (row.endpoint && row.endpoint.startsWith('mcp://tool/'));
                const isErrorStatus = row.status >= 400 || 
                                     (row.status === 0 && row.error) ||
                                     isMcpErr;
                if (isErrorStatus) {
                    const displayStatus = isMcpErr ? (row.status === 200 ? 400 : row.status) : row.status;
                    let categoryTitle = `HTTP ${displayStatus} Error`;
                    let groupKey = `status_${displayStatus}`;
                    let color = displayStatus >= 500 ? 'var(--color-error)' : 'var(--color-warning)';

                    if (row.status === 0) {
                        categoryTitle = 'Network Timeout / Error';
                        groupKey = 'status_0';
                        color = 'var(--color-error)';
                    } else {
                        const subType = extractErrorSubtype(row.responsePreview);
                        if (subType) {
                            if (subType.key.startsWith('mcp_')) {
                                categoryTitle = subType.title;
                                groupKey = subType.key;
                            } else {
                                categoryTitle = `${displayStatus} - ${subType.title}`;
                                groupKey = `status_${displayStatus}_${subType.key}`;
                            }
                        }
                    }

                    if (!infraGroups[groupKey]) {
                        infraGroups[groupKey] = { title: categoryTitle, color, items: [], seenMap: new Map() };
                    }
                    const dedupeKey = getCleanDedupeKey(row.method, row.endpoint, displayStatus, row.error);
                    const existing = infraGroups[groupKey].seenMap.get(dedupeKey);
                    if (existing) {
                        existing.count += 1;
                    } else {
                        const newItem = { result: row, count: 1 };
                        infraGroups[groupKey].seenMap.set(dedupeKey, newItem);
                        infraGroups[groupKey].items.push(newItem);
                    }
                }
            }
        }

        const colorPriority: Record<string, number> = {
            'var(--color-error)': 1,
            'var(--color-warning)': 2,
            'var(--color-info)': 3,
        };

        const securityList = Object.entries(securityGroups)
            .filter(([_, group]) => group.items.length > 0)
            .map(([key, group]) => ({ key, ...group }))
            .sort((a, b) => {
                const prioA = colorPriority[a.color] || 99;
                const prioB = colorPriority[b.color] || 99;
                if (prioA !== prioB) return prioA - prioB;
                return a.title.localeCompare(b.title);
            });

        const infraList = Object.entries(infraGroups)
            .filter(([_, group]) => group.items.length > 0)
            .map(([key, group]) => ({ key, ...group }))
            .sort((a, b) => {
                const prioA = colorPriority[a.color] || 99;
                const prioB = colorPriority[b.color] || 99;
                if (prioA !== prioB) return prioA - prioB;
                return a.title.localeCompare(b.title);
            });

        return { securityVulnerabilities: securityList, infrastructureErrors: infraList };
    }, [rows, findingsOnly, excludedStatuses]);

    const filteredFindingsCount = useMemo(() => {
        if (!findingsOnly) return total;
        return securityVulnerabilities.reduce((sum, g) => sum + g.items.length, 0) +
               infrastructureErrors.reduce((sum, g) => sum + g.items.length, 0);
    }, [securityVulnerabilities, infrastructureErrors, findingsOnly, total]);

    useEffect(() => {
        if (findingsOnly && onUpdateCount) {
            onUpdateCount(filteredFindingsCount);
        }
    }, [filteredFindingsCount, findingsOnly, onUpdateCount]);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleExpandAll = () => {
        const newExpanded: Record<string, boolean> = {};
        for (const g of [...securityVulnerabilities, ...infrastructureErrors]) {
            newExpanded[g.key] = true;
        }
        setExpandedGroups(newExpanded);
    };

    const handleCollapseAll = () => {
        setExpandedGroups({});
    };

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
            // Query all findings at once for client-side grouping so pagination doesn't break groups
            limit: findingsOnly ? 100000 : limit,
            findingsOnly,
            identityFilter,
            heatmapFilter,
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
            setTotal(newTotal);
            setIsLoading(false);
        }
    }, [runId, filter, debouncedSearch, sortConfig, heatmapFilter, queryResults, findingsOnly, limit, identityFilter]);

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

    const count5xx = rows.filter(r => r.status >= 500 || r.status === 0).length;

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
                    <div className="inspector-actions-row">
                        {(securityVulnerabilities.length > 0 || infrastructureErrors.length > 0) && (
                            <div className="inspector-actions-btn-group">
                                <button
                                    onClick={handleExpandAll}
                                    className="btn btn-ghost btn-sm btn-action-small"
                                >
                                    Expand All
                                </button>
                                <button
                                    onClick={handleCollapseAll}
                                    className="btn btn-ghost btn-sm btn-action-small"
                                >
                                    Collapse All
                                </button>
                            </div>
                        )}
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
                    {seenIdentities.size > 1 && (
                        <select
                            className="input select-input"
                            value={identityFilter}
                            onChange={(e) => setIdentityFilter(e.target.value)}
                            style={{ width: 'auto', minWidth: '130px', flexShrink: 0 }}
                            aria-label="Filter by user"
                        >
                            <option value="all">All Users</option>
                            {Array.from(seenIdentities).sort().map((idName) => (
                                <option key={idName} value={idName}>
                                    {formatIdentityName(idName)}
                                </option>
                            ))}
                        </select>
                    )}
                    {findingsOnly && availableStatuses.length > 0 && (
                        <StatusFilterDropdown
                            availableStatuses={availableStatuses}
                            excludedStatuses={excludedStatuses}
                            setExcludedStatuses={setExcludedStatuses}
                        />
                    )}
                    {isLoading && !findingsOnly && (
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>loading…</span>
                    )}
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-disabled)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {findingsOnly ? (
                            `${filteredFindingsCount.toLocaleString()} finding${filteredFindingsCount !== 1 ? 's' : ''}`
                        ) : (
                            `${total.toLocaleString()} req${total !== 1 ? 's' : ''}`
                        )}
                        {!findingsOnly && total > limit && (
                            <>
                                <span>(showing {Math.min(rows.length, limit).toLocaleString()})</span>
                                <button
                                    className="btn btn-ghost btn-sm btn-show-all"
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
                        {securityVulnerabilities.length > 0 && (
                            <div className="inspector-section">
                                <div className="inspector-section-header">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inspector-section-icon security-shield">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                    </svg>
                                    <h3 className="inspector-section-title">Security Vulnerabilities ({securityVulnerabilities.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.count, 0), 0)})</h3>
                                </div>
                                <div className="inspector-section-list">
                                    {securityVulnerabilities.map((group) => {
                                        const isCritical = group.color === 'var(--color-error)';
                                        const totalReqs = group.items.reduce((sum, item) => sum + item.count, 0);
                                        return (
                                            <div key={group.key} className={`findings-group ${isCritical ? 'findings-group-critical' : ''}`}>
                                                <div 
                                                    className="findings-group-header" 
                                                    onClick={() => toggleGroup(group.key)}
                                                >
                                                    <div className="findings-group-title-row">
                                                        <span className={`findings-group-chevron ${!expandedGroups[group.key] ? 'collapsed' : ''}`}>▼</span>
                                                        <span className="findings-group-count" style={{ backgroundColor: group.color }} title={`${totalReqs} total requests across ${group.items.length} unique targets`}>
                                                            {totalReqs}
                                                        </span>
                                                        {isCritical && <span className="badge-critical-indicator">CRITICAL</span>}
                                                        <span className="findings-group-title">{group.title}</span>
                                                    </div>
                                                </div>
                                                {expandedGroups[group.key] && (() => {
                                                     const groupLimit = groupLimits[group.key] || 50;
                                                     const visibleItems = group.items.slice(0, groupLimit);
                                                     return (
                                                         <div className="findings-group-items">
                                                             {visibleItems.map((item, idx) => (
                                                                 <FindingItem
                                                                     key={item.result.id || idx}
                                                                     item={item}
                                                                     groupColor={group.color}
                                                                     onSelect={handleSelectResultStable}
                                                                 />
                                                             ))}
                                                             {group.items.length > groupLimit && (
                                                                 <button
                                                                     className="btn btn-ghost btn-sm btn-load-more-findings"
                                                                     onClick={(e) => {
                                                                         e.stopPropagation();
                                                                         setGroupLimits(prev => ({
                                                                             ...prev,
                                                                             [group.key]: groupLimit + 50
                                                                         }));
                                                                     }}
                                                                 >
                                                                     Show More (+{Math.min(50, group.items.length - groupLimit)})
                                                                 </button>
                                                             )}
                                                         </div>
                                                     );
                                                 })()}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {infrastructureErrors.length > 0 && (
                            <div className="inspector-section">
                                <div className="inspector-section-header">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inspector-section-icon server-icon">
                                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                                        <line x1="6" y1="6" x2="6.01" y2="6" />
                                        <line x1="6" y1="18" x2="6.01" y2="18" />
                                    </svg>
                                    <h3 className="inspector-section-title">Infrastructure &amp; Runtime Errors ({infrastructureErrors.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.count, 0), 0)})</h3>
                                </div>
                                <div className="inspector-section-list">
                                    {infrastructureErrors.map((group) => {
                                        const totalReqs = group.items.reduce((sum, item) => sum + item.count, 0);
                                        return (
                                            <div key={group.key} className="findings-group">
                                                <div 
                                                    className="findings-group-header" 
                                                    onClick={() => toggleGroup(group.key)}
                                                >
                                                    <div className="findings-group-title-row">
                                                        <span className={`findings-group-chevron ${!expandedGroups[group.key] ? 'collapsed' : ''}`}>▼</span>
                                                        <span className="findings-group-count" style={{ backgroundColor: group.color }} title={`${totalReqs} total requests across ${group.items.length} unique targets`}>
                                                            {totalReqs}
                                                        </span>
                                                        <span className="findings-group-title">{group.title}</span>
                                                    </div>
                                                </div>
                                            {expandedGroups[group.key] && (() => {
                                                 const groupLimit = groupLimits[group.key] || 50;
                                                 const visibleItems = group.items.slice(0, groupLimit);
                                                 return (
                                                     <div className="findings-group-items">
                                                         {visibleItems.map((item, idx) => (
                                                             <FindingItem
                                                                 key={item.result.id || idx}
                                                                 item={item}
                                                                 groupColor={group.color}
                                                                 onSelect={handleSelectResultStable}
                                                             />
                                                         ))}
                                                         {group.items.length > groupLimit && (
                                                             <button
                                                                 className="btn btn-ghost btn-sm btn-load-more-findings"
                                                                 onClick={(e) => {
                                                                     e.stopPropagation();
                                                                     setGroupLimits(prev => ({
                                                                         ...prev,
                                                                         [group.key]: groupLimit + 50
                                                                     }));
                                                                 }}
                                                             >
                                                                 Show More (+{Math.min(50, group.items.length - groupLimit)})
                                                             </button>
                                                         )}
                                                     </div>
                                                 );
                                             })()}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {!findingsOnly && total > rows.length && (
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
                            itemContent={(_index, r) => {
                                const isMcpErr = r.method === 'CALL' || r.method === 'MCP' || (r.endpoint && r.endpoint.startsWith('mcp://tool/'));
                                const displayStatus = isMcpErr ? (r.status === 200 ? 400 : r.status) : r.status;
                                const rowClass = isMcpErr ? (displayStatus >= 500 ? 'status-5xx' : 'status-4xx') : getStatusClass(r.status);
                                const badgeClass = isMcpErr ? (displayStatus >= 500 ? 'badge badge-error' : 'badge badge-warning') : getBadgeClass(r.status);
                                
                                return (
                                    <div
                                        key={r.id}
                                        className={`log-row ${rowClass}`}
                                        onClick={() => onSelectResult(r)}
                                        style={{
                                            opacity: r.triage === 'ignored' || r.triage === 'false_positive' ? 0.6 : 1
                                        }}
                                    >
                                        <span className="log-timestamp">{formatTime(r.timestamp)}</span>
                                        <span className={`method method-${r.method.toLowerCase()}`}>{r.method}</span>
                                        <span className="log-path">
                                            {r.endpoint}
                                            {r.triage && r.triage !== 'none' && (
                                                <span 
                                                    className={`badge ${
                                                        r.triage === 'acknowledged' 
                                                            ? 'badge-success' 
                                                            : r.triage === 'false_positive' 
                                                            ? 'badge-error' 
                                                            : 'badge-warning'
                                                    }`} 
                                                    style={{ marginLeft: '8px' }}
                                                >
                                                    {r.triage}
                                                </span>
                                            )}
                                        </span>
                                        <span className="log-payload" title={r.payloadPreview}>
                                            {r.payloadPreview?.replace(/\s+/g, ' ')}
                                        </span>
                                        <span className={badgeClass} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            {displayStatus >= 500 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>}
                                            {displayStatus >= 400 && displayStatus < 500 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>}
                                            {!isMcpErr && r.status >= 200 && r.status < 300 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>}
                                            {r.status === 0 ? <span title="Infinity (Timeout / Network Error)">∞</span> : (isMcpErr ? `-${displayStatus}` : r.status || 'ERR')}
                                        </span>
                                        <span className="badge-profile">{r.profile}</span>
                                    <span className="log-size">{formatBytes(r.payloadSize)}</span>
                                    <span className="log-duration">{r.duration}ms</span>
                                </div>
                            ); }}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
