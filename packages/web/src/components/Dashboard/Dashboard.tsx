import React, { useState, useMemo } from 'react';
import type { RunStats, FuzzResult } from '@swazz/core';
import { StatsBar } from './StatsBar.js';
import { Heatmap } from './Heatmap.js';
import { StatusChart } from './StatusChart.js';

interface Props {
    stats: RunStats | null;
    results: FuzzResult[];
    endpointPaths: string[];
}

export function Dashboard({ stats, results, endpointPaths }: Props) {
    if (!stats) {
        return (
            <div className="dashboard">
                <div className="empty-state">
                    <div className="empty-state-icon">⚡</div>
                    <div className="empty-state-text">
                        Configure your target and press <strong>Start</strong> to begin fuzzing
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard">
            <StatsBar stats={stats} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 'var(--space-4)', alignItems: 'start' }}>
                <Heatmap stats={stats} endpointPaths={endpointPaths} />
                <StatusChart stats={stats} />
            </div>
        </div>
    );
}
