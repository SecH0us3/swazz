import React, { useState, useMemo } from 'react';
import type { RunStats } from '@swazz/core';

export interface HeatmapFilter {
    endpoint: string;
    status: number;
}

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

export function Heatmap({ stats, endpointPaths, activeFilter, onCellClick }: Props) {
    const [hoveredCell, setHoveredCell] = useState<{ ep: string; code: number } | null>(null);

    // Dynamic columns: collect all status codes that actually appeared
    const statusCodes = useMemo(() => {
        const codes = new Set<number>();
        for (const epCounts of Object.values(stats.endpointCounts)) {
            for (const code of Object.keys(epCounts)) {
                codes.add(Number(code));
            }
        }
        return [...codes].sort((a, b) => a - b);
    }, [stats]);

    const maxCount = Math.max(
        1,
        ...Object.values(stats.endpointCounts).flatMap((codes) => Object.values(codes)),
    );

    const handleCellClick = (ep: string, code: number, count: number) => {
        if (count === 0) return;
        // Toggle off if same cell clicked again
        if (activeFilter?.endpoint === ep && activeFilter?.status === code) {
            onCellClick(null);
        } else {
            onCellClick({ endpoint: ep, status: code });
        }
    };

    return (
        <div className="heatmap card">
            <div className="heatmap-header">
                <span className="heatmap-title">Endpoint × Status Heatmap</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {activeFilter && (
                        <button
                            onClick={() => onCellClick(null)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'rgba(99,102,241,0.12)',
                                border: '1px solid rgba(99,102,241,0.35)',
                                borderRadius: 'var(--radius-full)',
                                padding: '2px 8px',
                                fontSize: 10,
                                color: 'var(--color-action-hover)',
                                cursor: 'pointer',
                                fontFamily: 'var(--font-mono)',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {activeFilter.status} · {activeFilter.endpoint}
                            <span style={{ marginLeft: 2, opacity: 0.7 }}>✕</span>
                        </button>
                    )}
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-disabled)' }}>
                        {statusCodes.length} codes
                    </span>
                </div>
            </div>

            {statusCodes.length === 0 ? (
                <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)', textAlign: 'center', padding: 'var(--space-4)' }}>
                    No data yet
                </div>
            ) : (
                <>
                    {/* Column headers */}
                    <div className="heatmap-codes">
                        <div className="heatmap-label" style={{ visibility: 'hidden' }}>placeholder</div>
                        {statusCodes.map((code) => (
                            <div key={code} className="heatmap-code-label">{code}</div>
                        ))}
                    </div>

                    {/* Scrollable rows */}
                    <div className="heatmap-scroll">
                        <div className="heatmap-grid">
                            {endpointPaths.map((ep) => (
                                <div key={ep} className="heatmap-row">
                                    <div className="heatmap-label" title={ep}>{ep}</div>
                                    {statusCodes.map((code, ci) => {
                                        const count = stats.endpointCounts[ep]?.[code] || 0;
                                        const isHovered = hoveredCell?.ep === ep && hoveredCell?.code === code;
                                        const isActive = activeFilter?.endpoint === ep && activeFilter?.status === code;
                                        const isClickable = count > 0;

                                        return (
                                            <div
                                                key={code}
                                                className={`heatmap-cell ${isActive ? 'heatmap-cell-active' : ''}`}
                                                style={{
                                                    background: getCellColor(code, count, maxCount),
                                                    animationDelay: `${ci * 30}ms`,
                                                    cursor: isClickable ? 'pointer' : 'default',
                                                    outline: isActive ? '2px solid var(--color-action)' : undefined,
                                                    outlineOffset: '2px',
                                                }}
                                                onMouseEnter={() => setHoveredCell({ ep, code })}
                                                onMouseLeave={() => setHoveredCell(null)}
                                                onClick={() => handleCellClick(ep, code, count)}
                                            >
                                                {isHovered && count > 0 && (
                                                    <div className="tooltip">
                                                        {ep} → {code}: {count}
                                                        <br />
                                                        <span style={{ opacity: 0.7 }}>Click to filter</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
