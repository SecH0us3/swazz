import React from 'react';
import type { RunStats, FuzzResult } from '@swazz/core';
import { StatsBar } from './StatsBar.js';
import { Heatmap } from './Heatmap.js';
import type { HeatmapFilter } from './Heatmap.js';

interface Props {
    stats: RunStats | null;
    results: FuzzResult[];
    endpointKeys: string[];
    heatmapFilter: HeatmapFilter | null;
    onHeatmapFilter: (f: HeatmapFilter | null) => void;
    isRunning: boolean;
}

export function Dashboard({ stats, results, endpointKeys, heatmapFilter, onHeatmapFilter, isRunning }: Props) {
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
            <StatsBar stats={stats} isRunning={isRunning} />
            <Heatmap
                stats={stats}
                endpointKeys={endpointKeys}
                activeFilter={heatmapFilter}
                onCellClick={onHeatmapFilter}
            />
        </div>
    );
}
