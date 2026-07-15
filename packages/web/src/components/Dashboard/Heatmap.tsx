import React, { useState, useMemo, useCallback, useRef } from 'react';
import type { RunStats } from '../../types.js';

export interface HeatmapFilter {
    method: string;
    path: string;
    status: number;
}

type StatusBucket = 'any' | '2xx' | '4xx' | '5xx';

interface Props {
    stats: RunStats;
    endpointKeys: string[];
    vulnerableEndpoints?: Set<string>;
    activeFilter: HeatmapFilter | null;
    onCellClick: (filter: HeatmapFilter | null) => void;
}

function getCellColor(status: number, count: number, maxCount: number): string {
    if (count === 0) return 'var(--bg-elevated)';
    const intensity = Math.min(count / Math.max(maxCount, 1), 1);
    const lightness = 20 + intensity * 40;
    if (status >= 500 || status === 0) return `hsl(350, 89%, ${lightness}%)`;
    if (status >= 400) return `hsl(45, 96%, ${lightness}%)`;
    return `hsl(160, 84%, ${lightness}%)`;
}

function matchesBucket(code: number, bucket: StatusBucket): boolean {
    if (bucket === 'any') return true;
    if (bucket === '2xx') return code >= 200 && code < 300;
    if (bucket === '4xx') return code >= 400 && code < 500;
    if (bucket === '5xx') return code >= 500 || code === 0;
    return true;
}

interface HeatmapCellProps {
    code: number;
    count: number;
    maxCount: number;
    isActive: boolean;
    animationDelay: string;
    onClick: (code: number, count: number) => void;
}

const HeatmapCell: React.FC<HeatmapCellProps> = React.memo(({
    code,
    count,
    maxCount,
    isActive,
    animationDelay,
    onClick
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const isClickable = count > 0;

    return (
        <div
            className={`heatmap-cell${isActive ? ' heatmap-cell-active' : ''}`}
            style={{
                background: getCellColor(code, count, maxCount),
                animationDelay,
                cursor: isClickable ? 'pointer' : 'default',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => onClick(code, count)}
        >
            {isHovered && count > 0 && (
                <div className="tooltip">
                    {code === 0 ? '∞' : code}: {count} req{count > 1 ? 's' : ''}<br />
                    <span style={{ opacity: 0.6, fontSize: 10 }}>click to filter</span>
                </div>
            )}
        </div>
    );
});

interface HeatmapRowProps {
    epKey: string;
    statusCodes: number[];
    endpointCounts: Record<number, number>;
    maxCount: number;
    activeFilter: HeatmapFilter | null;
    isVulnerable?: boolean;
    onCellClick: (epKey: string, code: number, count: number) => void;
}

const HeatmapRow: React.FC<HeatmapRowProps> = React.memo(({
    epKey,
    statusCodes,
    endpointCounts,
    maxCount,
    activeFilter,
    isVulnerable,
    onCellClick
}) => {
    const [method, ...rest] = epKey.split(' ');
    const path = rest.join(' ');

    const handleCellClick = useCallback((code: number, count: number) => {
        onCellClick(epKey, code, count);
    }, [epKey, onCellClick]);

    return (
        <div className="heatmap-row">
            {/* Label — takes all remaining space */}
            <div className="heatmap-label" title={epKey}>
                <span className={`method method-${method.toLowerCase()}`}>{method}</span>
                <span className="path">{path}</span>
                {isVulnerable && (
                    <span className="heatmap-vuln-indicator" title="Vulnerability detected!">
                        ⚠️
                    </span>
                )}
            </div>
            {/* Cells — right side, fixed width */}
            {statusCodes.map((code, ci) => {
                const count = endpointCounts[code] || 0;
                const isActive = activeFilter?.method === method && activeFilter?.path === path && activeFilter?.status === code;

                return (
                    <HeatmapCell
                        key={code}
                        code={code}
                        count={count}
                        maxCount={maxCount}
                        isActive={isActive}
                        animationDelay={`${ci * 20}ms`}
                        onClick={handleCellClick}
                    />
                );
            })}
        </div>
    );
}, (prevProps, nextProps) => {
    if (prevProps.epKey !== nextProps.epKey) return false;
    if (prevProps.maxCount !== nextProps.maxCount) return false;
    if (prevProps.isVulnerable !== nextProps.isVulnerable) return false;
    
    if (prevProps.statusCodes.length !== nextProps.statusCodes.length) return false;
    for (let i = 0; i < prevProps.statusCodes.length; i++) {
        if (prevProps.statusCodes[i] !== nextProps.statusCodes[i]) return false;
    }
    
    const prevCounts = prevProps.endpointCounts || {};
    const nextCounts = nextProps.endpointCounts || {};
    for (const code of nextProps.statusCodes) {
        if ((prevCounts[code] || 0) !== (nextCounts[code] || 0)) return false;
    }
    
    const [method, ...rest] = prevProps.epKey.split(' ');
    const path = rest.join(' ');
    
    const wasActiveInPrev = prevProps.activeFilter?.method === method && prevProps.activeFilter?.path === path;
    const isActiveInNext = nextProps.activeFilter?.method === method && nextProps.activeFilter?.path === path;
    
    if (wasActiveInPrev !== isActiveInNext) return false;
    if (isActiveInNext && prevProps.activeFilter?.status !== nextProps.activeFilter?.status) return false;
    if (prevProps.onCellClick !== nextProps.onCellClick) return false;

    return true;
});

export function Heatmap({ stats, endpointKeys, vulnerableEndpoints, activeFilter, onCellClick }: Props) {
    const [search, setSearch] = useState('');
    const [statusBucket, setStatusBucket] = useState<StatusBucket>('any');

    // All status codes that appeared
    const allStatusCodes = useMemo(() => {
        const codes = new Set<number>();
        for (const epCounts of Object.values(stats.endpointCounts)) {
            for (const code of Object.keys(epCounts)) codes.add(Number(code));
        }
        return [...codes].sort((a, b) => a - b);
    }, [stats]);

    // Status codes filtered by bucket
    const statusCodes = useMemo(
        () => allStatusCodes.filter((c) => matchesBucket(c, statusBucket)),
        [allStatusCodes, statusBucket],
    );

    // Endpoint rows filtered by search AND by whether they have hits in the selected bucket
    const visibleEndpoints = useMemo(() => {
        let list = endpointKeys;

        // Hide endpoints with no hits for the selected status bucket
        list = list.filter((epKey) => {
            const counts = stats.endpointCounts[epKey] ?? {};
            return Object.entries(counts).some(
                ([code, count]) => count > 0 && matchesBucket(Number(code), statusBucket),
            );
        });

        // Text search on top
        const q = search.trim().toLowerCase();
        if (q) list = list.filter((epKey) => epKey.toLowerCase().includes(q));

        // Sort: 5xx first, then 4xx, then alphabetical
        return list.sort((a, b) => {
            const countsA = stats.endpointCounts[a] ?? {};
            const countsB = stats.endpointCounts[b] ?? {};

            const has5xxA = Object.entries(countsA).some(([code, count]) => count > 0 && Number(code) >= 500);
            const has5xxB = Object.entries(countsB).some(([code, count]) => count > 0 && Number(code) >= 500);
            if (has5xxA && !has5xxB) return -1;
            if (!has5xxA && has5xxB) return 1;

            const has4xxA = Object.entries(countsA).some(([code, count]) => count > 0 && Number(code) >= 400 && Number(code) < 500);
            const has4xxB = Object.entries(countsB).some(([code, count]) => count > 0 && Number(code) >= 400 && Number(code) < 500);
            if (has4xxA && !has4xxB) return -1;
            if (!has4xxA && has4xxB) return 1;

            return a.localeCompare(b);
        });
    }, [endpointKeys, search, statusBucket, stats]);

    const maxCount = Math.max(
        1,
        ...Object.values(stats.endpointCounts).flatMap((codes) => Object.values(codes)),
    );

    const activeFilterRef = useRef(activeFilter);
    activeFilterRef.current = activeFilter;

    const onCellClickRef = useRef(onCellClick);
    onCellClickRef.current = onCellClick;

    const handleCellClick = useCallback((epKey: string, code: number, count: number) => {
        if (count === 0) return;
        const [method, ...rest] = epKey.split(' ');
        const path = rest.join(' ');

        const active = activeFilterRef.current;
        if (active?.method === method && active?.path === path && active?.status === code) {
            onCellClickRef.current(null);
        } else {
            onCellClickRef.current({ method, path, status: code });
        }
    }, []);

    const buckets: { key: StatusBucket; label: string }[] = [
        { key: 'any', label: 'Any' },
        { key: '2xx', label: '2xx' },
        { key: '4xx', label: '4xx' },
        { key: '5xx', label: '5xx' },
    ];

    return (
        <div className="heatmap card">
            {/* ── Header ──────────────────────────────── */}
            <div className="heatmap-header">
                <span className="heatmap-title">Endpoint × Status Heatmap</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginLeft: 'auto' }}>
                    {/* Active cell filter chip */}
                    {activeFilter && (
                        <button
                            onClick={() => onCellClick(null)}
                            className="heatmap-active-chip"
                        >
                            <span>{activeFilter.status === 0 ? '∞' : activeFilter.status}</span>
                            <span style={{ opacity: 0.6 }}>·</span>
                            <span style={{ fontFamily: 'var(--font-mono)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span style={{ color: 'var(--text-disabled)', marginRight: 4 }}>{activeFilter.method}</span>
                                {activeFilter.path}
                            </span>
                            <span style={{ opacity: 0.55, marginLeft: 2 }}>✕</span>
                        </button>
                    )}

                    {/* Status bucket filter buttons */}
                    <div className="heatmap-buckets">
                        {buckets.map((b) => (
                            <button
                                key={b.key}
                                className={`heatmap-bucket-btn ${statusBucket === b.key ? 'active' : ''} ${b.key}`}
                                onClick={() => setStatusBucket(b.key)}
                            >
                                {b.label}
                            </button>
                        ))}
                    </div>

                    {/* Endpoint name search */}
                    <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
                        <input
                            className="input heatmap-search"
                            placeholder="Filter endpoints…"
                            aria-label="Filter endpoints"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ paddingRight: search ? 28 : undefined }}
                        />
                        {search && (
                            <button
                                className="btn btn-icon"
                                style={{ position:'absolute', right:4, top:'50%', transform:'translateY(-50%)', width:20, height:20, padding:0, minHeight:0, minWidth:0 }}
                                onClick={() => setSearch('')}
                                aria-label="Clear filter"
                                title="Clear filter"
                            >✕</button>
                        )}
                    </div>
                </div>
            </div>

            {allStatusCodes.length === 0 ? (
                <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)', textAlign: 'center', padding: 'var(--space-6)' }}>
                    No data yet — start a fuzz run to populate the heatmap
                </div>
            ) : (
                <>
                    <div className="heatmap-codes">
                        {/* Spacer matches the label column */}
                        <div className="heatmap-label-spacer" />
                        {statusCodes.map((code) => {
                            const bucketClass = (code >= 500 || code === 0) ? 'code-5xx' : code >= 400 ? 'code-4xx' : 'code-2xx';
                            return (
                                <div key={code} className={`heatmap-code-label ${bucketClass}`}>{code === 0 ? '∞' : code}</div>
                            );
                        })}
                    </div>

                    {/* ── Scrollable rows ─────────────── */}
                    <div className="heatmap-scroll">
                        {visibleEndpoints.length === 0 ? (
                            <div style={{ padding: 'var(--space-3)', color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)' }}>
                                No endpoints match "{search}"
                            </div>
                        ) : (
                            <div className="heatmap-grid">
                                {visibleEndpoints.map((epKey) => (
                                    <HeatmapRow
                                        key={epKey}
                                        epKey={epKey}
                                        statusCodes={statusCodes}
                                        endpointCounts={stats.endpointCounts[epKey] ?? {}}
                                        maxCount={maxCount}
                                        activeFilter={activeFilter}
                                        isVulnerable={vulnerableEndpoints?.has(epKey)}
                                        onCellClick={handleCellClick}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Footer info ──────────────────── */}
                    <div className="heatmap-footer">
                        <span>{visibleEndpoints.length} / {endpointKeys.length} endpoints</span>
                        <span>{statusCodes.length} / {allStatusCodes.length} codes shown</span>
                    </div>
                </>
            )}
        </div>
    );
}
