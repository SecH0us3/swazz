import React, { useState, useMemo } from 'react';
import type { RunStats } from '@swazz/core';

interface Props {
    stats: RunStats;
    endpointPaths: string[];
}

function getCellColor(status: number, count: number, maxCount: number): string {
    if (count === 0) return 'var(--bg-elevated)';
    const intensity = Math.min(count / Math.max(maxCount, 1), 1);
    const lightness = 20 + intensity * 40;

    if (status >= 500) return `hsl(350, 89%, ${lightness}%)`;
    if (status >= 400) return `hsl(45, 96%, ${lightness}%)`;
    return `hsl(160, 84%, ${lightness}%)`;
}

export function Heatmap({ stats, endpointPaths }: Props) {
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

    return (
        <div className="heatmap card">
            <div className="heatmap-header">
                <span className="heatmap-title">Endpoint × Status Heatmap</span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-disabled)' }}>
                    {statusCodes.length} codes
                </span>
            </div>

            {statusCodes.length === 0 ? (
                <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)', textAlign: 'center', padding: 'var(--space-4)' }}>
                    No data yet
                </div>
            ) : (
                <>
                    {/* Column headers */}
                    <div className="heatmap-codes">
                        {statusCodes.map((code) => (
                            <div key={code} className="heatmap-code-label">{code}</div>
                        ))}
                    </div>

                    {/* Rows */}
                    <div className="heatmap-grid">
                        {endpointPaths.map((ep) => (
                            <div key={ep} className="heatmap-row">
                                <div className="heatmap-label" title={ep}>{ep}</div>
                                {statusCodes.map((code, ci) => {
                                    const count = stats.endpointCounts[ep]?.[code] || 0;
                                    const isHovered = hoveredCell?.ep === ep && hoveredCell?.code === code;

                                    return (
                                        <div
                                            key={code}
                                            className="heatmap-cell"
                                            style={{
                                                background: getCellColor(code, count, maxCount),
                                                animationDelay: `${ci * 30}ms`,
                                            }}
                                            onMouseEnter={() => setHoveredCell({ ep, code })}
                                            onMouseLeave={() => setHoveredCell(null)}
                                        >
                                            {isHovered && count > 0 && (
                                                <div className="tooltip">
                                                    {ep} → {code}: {count}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

