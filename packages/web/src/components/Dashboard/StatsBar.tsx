import React from 'react';
import type { RunStats } from '@swazz/core';

interface Props {
    stats: RunStats;
    isRunning: boolean;
}

function StatNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
    return (
        <span className="stat-value">
            {decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString()}
        </span>
    );
}

function get2xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 200 && Number(s) < 300)
        .reduce((sum, [, c]) => sum + c, 0);
}

function get4xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 400 && Number(s) < 500)
        .reduce((sum, [, c]) => sum + c, 0);
}

function get5xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 500)
        .reduce((sum, [, c]) => sum + c, 0);
}

export function StatsBar({ stats, isRunning }: Props) {
    const count2xx = get2xx(stats);
    const count4xx = get4xx(stats);
    const count5xx = get5xx(stats);

    const { completedEndpoints, totalEndpoints, currentEndpoint, currentProfile } = stats.progress;
    const pct = totalEndpoints > 0 ? Math.round((completedEndpoints / totalEndpoints) * 100) : 0;
    const showProgress = isRunning && totalEndpoints > 0;

    return (
        <div className="stats-bar card">
            <div className="stats-bar-row">
                {/* RPS */}
                <div className="stat-card stat-rps">
                    <span className="stat-label">Req / sec</span>
                    <StatNumber value={stats.requestsPerSecond} decimals={1} />
                </div>
                <div className="stat-divider" />

                {/* Total */}
                <div className="stat-card stat-total">
                    <span className="stat-label">Total</span>
                    <StatNumber value={stats.totalRequests} />
                </div>
                <div className="stat-divider" />

                {/* 2xx */}
                <div className="stat-card stat-2xx">
                    <span className="stat-label">2xx Success</span>
                    <StatNumber value={count2xx} />
                </div>
                <div className="stat-divider" />

                {/* 4xx */}
                <div className="stat-card stat-4xx">
                    <span className="stat-label">4xx Client</span>
                    <StatNumber value={count4xx} />
                </div>
                <div className="stat-divider" />

                {/* 5xx */}
                <div className={`stat-card stat-5xx ${count5xx > 0 ? 'has-errors' : ''}`}>
                    <span className="stat-label">{count5xx > 0 ? '5xx CRASHES' : '5xx Errors'}</span>
                    <StatNumber value={count5xx} />
                </div>
            </div>

            {showProgress && (
                <div className="progress-strip">
                    <div className="progress-bar-track">
                        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="progress-meta">
                        <span className="progress-pct">{pct}%</span>
                        <span className="progress-label">
                            {completedEndpoints}/{totalEndpoints} endpoints
                            {currentEndpoint ? (
                                <> · <span className="progress-current">
                                    {currentProfile && <span className="progress-profile">{currentProfile}</span>}
                                    {currentEndpoint}
                                </span></>
                            ) : null}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
