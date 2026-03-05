import React from 'react';
import type { RunStats } from '@swazz/core';

interface Props {
    stats: RunStats;
}

export function StatusChart({ stats }: Props) {
    const total = stats.totalRequests || 1;

    const count2xx = Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 200 && Number(s) < 300)
        .reduce((sum, [, c]) => sum + c, 0);
    const count4xx = Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 400 && Number(s) < 500)
        .reduce((sum, [, c]) => sum + c, 0);
    const count5xx = Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 500)
        .reduce((sum, [, c]) => sum + c, 0);

    const r = 60;
    const stroke = 12;
    const circumference = 2 * Math.PI * r;

    const pct2xx = count2xx / total;
    const pct4xx = count4xx / total;
    const pct5xx = count5xx / total;

    const offset2xx = 0;
    const offset4xx = pct2xx * circumference;
    const offset5xx = (pct2xx + pct4xx) * circumference;

    return (
        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Distribution
            </div>

            <svg width="140" height="140" viewBox="0 0 140 140">
                {/* Background circle */}
                <circle cx="70" cy="70" r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth={stroke} />

                {/* 2xx segment */}
                {count2xx > 0 && (
                    <circle
                        cx="70" cy="70" r={r}
                        fill="none"
                        stroke="var(--color-success)"
                        strokeWidth={stroke}
                        strokeDasharray={`${pct2xx * circumference} ${circumference}`}
                        strokeDashoffset={-offset2xx}
                        strokeLinecap="round"
                        transform="rotate(-90 70 70)"
                        style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                )}

                {/* 4xx segment */}
                {count4xx > 0 && (
                    <circle
                        cx="70" cy="70" r={r}
                        fill="none"
                        stroke="var(--color-warning)"
                        strokeWidth={stroke}
                        strokeDasharray={`${pct4xx * circumference} ${circumference}`}
                        strokeDashoffset={-offset4xx}
                        strokeLinecap="round"
                        transform="rotate(-90 70 70)"
                        style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                )}

                {/* 5xx segment */}
                {count5xx > 0 && (
                    <circle
                        cx="70" cy="70" r={r}
                        fill="none"
                        stroke="var(--color-error)"
                        strokeWidth={stroke}
                        strokeDasharray={`${pct5xx * circumference} ${circumference}`}
                        strokeDashoffset={-offset5xx}
                        strokeLinecap="round"
                        transform="rotate(-90 70 70)"
                        style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                )}

                {/* Center text */}
                <text x="70" y="66" textAnchor="middle" fill="var(--text-primary)" fontSize="20" fontWeight="600" fontFamily="var(--font-ui)">
                    {stats.totalRequests}
                </text>
                <text x="70" y="82" textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontFamily="var(--font-ui)">
                    requests
                </text>
            </svg>

            {/* Legend */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-xs)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>2xx: {count2xx}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning)' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>4xx: {count4xx}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-error)' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>5xx: {count5xx}</span>
                </div>
            </div>
        </div>
    );
}
