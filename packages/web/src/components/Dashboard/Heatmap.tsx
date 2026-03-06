import React, { useState, useMemo } from 'react';
import type { RunStats } from '@swazz/core';

export interface HeatmapFilter {
    endpoint: string;
    status: number;
}

type StatusBucket = 'all' | '2xx' | '4xx' | '5xx';

interface Props {
    stats: RunStats;
    endpointPaths: string[];
    activeFilter: HeatmapFilter | null;
    onCellClick: (filter: HeatmapFilter | null) => void;
}

function getCellColor(status: number, count: number, maxCount: number): string {
    if (count === 0) return 'var(--bg-elevated)';
    const intensity = Math.min(count / Math.max(maxCount, 1), 1);
    const lightness = 20 + intensity * 40;
    if (status >= 500) return `hsl(350, 89%, ${lightness}%)`;
    if (status >= 400) return `hsl(45, 96%, ${lightness}%)`;
    return `hsl(160, 84%, ${lightness}%)`;
}

function matchesBucket(code: number, bucket: StatusBucket): boolean {
    if (bucket === 'all') return true;
    if (bucket === '2xx') return code >= 200 && code < 300;
    if (bucket === '4xx') return code >= 400 && code < 500;
    if (bucket === '5xx') return code >= 500;
    return true;
}

export function Heatmap({ stats, endpointPaths, activeFilter, onCellClick }: Props) {
    const [hoveredCell, setHoveredCell] = useState<{ ep: string; code: number } | null>(null);
    const [search, setSearch] = useState('');
    const [statusBucket, setStatusBucket] = useState<StatusBucket>('all');

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
        let list = endpointPaths;

        // Hide endpoints with no hits for the selected status bucket
        if (statusBucket !== 'all') {
            list = list.filter((ep) => {
                const counts = stats.endpointCounts[ep] ?? {};
                return Object.entries(counts).some(
                    ([code, count]) => count > 0 && matchesBucket(Number(code), statusBucket),
                );
            });
        }

        // Text search on top
        const q = search.trim().toLowerCase();
        if (q) list = list.filter((ep) => ep.toLowerCase().includes(q));

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
    }, [endpointPaths, search, statusBucket, stats]);

    const maxCount = Math.max(
        1,
        ...Object.values(stats.endpointCounts).flatMap((codes) => Object.values(codes)),
    );

    const handleCellClick = (ep: string, code: number, count: number) => {
        if (count === 0) return;
        if (activeFilter?.endpoint === ep && activeFilter?.status === code) {
            onCellClick(null);
        } else {
            onCellClick({ endpoint: ep, status: code });
        }
    };

    const buckets: { key: StatusBucket; label: string }[] = [
        { key: 'all', label: 'All' },
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
                            <span>{activeFilter.status}</span>
                            <span style={{ opacity: 0.6 }}>·</span>
                            <span style={{ fontFamily: 'var(--font-mono)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {activeFilter.endpoint}
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
                    <input
                        className="input heatmap-search"
                        placeholder="Filter endpoints…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
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
                            const bucketClass = code >= 500 ? 'code-5xx' : code >= 400 ? 'code-4xx' : 'code-2xx';
                            return (
                                <div key={code} className={`heatmap-code-label ${bucketClass}`}>{code}</div>
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
                                {visibleEndpoints.map((ep) => (
                                    <div key={ep} className="heatmap-row">
                                        {/* Label — takes all remaining space */}
                                        <div className="heatmap-label" title={ep}>{ep}</div>
                                        {/* Cells — right side, fixed width */}
                                        {statusCodes.map((code, ci) => {
                                            const count = stats.endpointCounts[ep]?.[code] || 0;
                                            const isHovered = hoveredCell?.ep === ep && hoveredCell?.code === code;
                                            const isActive = activeFilter?.endpoint === ep && activeFilter?.status === code;
                                            const isClickable = count > 0;

                                            return (
                                                <div
                                                    key={code}
                                                    className={`heatmap-cell${isActive ? ' heatmap-cell-active' : ''}`}
                                                    style={{
                                                        background: getCellColor(code, count, maxCount),
                                                        animationDelay: `${ci * 20}ms`,
                                                        cursor: isClickable ? 'pointer' : 'default',
                                                    }}
                                                    onMouseEnter={() => setHoveredCell({ ep, code })}
                                                    onMouseLeave={() => setHoveredCell(null)}
                                                    onClick={() => handleCellClick(ep, code, count)}
                                                >
                                                    {isHovered && count > 0 && (
                                                        <div className="tooltip">
                                                            {code}: {count} req{count > 1 ? 's' : ''}<br />
                                                            <span style={{ opacity: 0.6, fontSize: 10 }}>click to filter</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Footer info ──────────────────── */}
                    <div className="heatmap-footer">
                        <span>{visibleEndpoints.length} / {endpointPaths.length} endpoints</span>
                        <span>{statusCodes.length} / {allStatusCodes.length} codes shown</span>
                    </div>
                </>
            )}
        </div>
    );
}
