import React from 'react';
import type { RunStats } from '@swazz/core';
import { StatsBar } from './StatsBar.js';
import { Heatmap } from './Heatmap.js';
import type { HeatmapFilter } from './Heatmap.js';

interface Props {
    stats: RunStats | null;
    endpointKeys: string[];
    heatmapFilter: HeatmapFilter | null;
    onHeatmapFilter: (f: HeatmapFilter | null) => void;
    isRunning: boolean;
}

export function Dashboard({ stats, endpointKeys, heatmapFilter, onHeatmapFilter, isRunning }: Props) {
    if (!stats) {
        return (
            <div className="dashboard">
                <div className="empty-state">
                    <div className="empty-state-icon">⚡</div>
                    <div className="empty-state-text" style={{ maxWidth: '600px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div className="empty-state-title" style={{ fontSize: '18px', fontWeight: 600 }}>Welcome to Swazz API Fuzzer</div>
                        </div>
                        
                        <div style={{ background: 'var(--bg-elevated)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                            <h4 style={{ color: 'var(--text-primary)', margin: '0 0 12px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                🌍 Web Interface Quick Start
                            </h4>
                            <ul style={{ margin: '0', paddingLeft: '24px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <li>Enter your <strong>OpenAPI/Swagger URL</strong> or target domain in the top field.</li>
                                <li>Press <span style={{ padding: '2px 6px', background: 'var(--bg-surface)', borderRadius: '4px', border: '1px solid var(--border-hover)', fontSize: '11px', color: 'var(--text-primary)' }}>Start</span> to begin finding vulnerabilities.</li>
                                <li>Click on <strong>Heatmap cells</strong> to filter the request log by specific endpoints and status codes.</li>
                                <li>Select any request in the <strong>Timeline</strong> to inspect full payloads and headers.</li>
                            </ul>
                        </div>

                        <div style={{ background: 'var(--bg-elevated)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                            <h4 style={{ color: 'var(--text-primary)', margin: '0 0 12px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                💻 Local CLI & CI/CD
                            </h4>
                            <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                Run Swazz locally against internal APIs or integrate it into your CI/CD pipeline to catch vulnerabilities before they reach production:
                            </p>
                            <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: '6px', margin: '0 0 12px 0', fontSize: '12px', overflowX: 'auto', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                <code><span style={{ color: 'var(--text-muted)' }}># Initialize configuration</span>{'\n'}npm run start --workspace=packages/cli -- init{'\n\n'}<span style={{ color: 'var(--text-muted)' }}># Run the fuzzer</span>{'\n'}npm run start --workspace=packages/cli -- run{'\n\n'}<span style={{ color: 'var(--text-muted)' }}># View help options</span>{'\n'}npm run start --workspace=packages/cli -- --help</code>
                            </pre>
                            <p style={{ margin: '0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                Tip: Use the <code style={{ color: 'var(--color-info)' }}>--fail-on-findings</code> flag in CI pipelines to automatically fail builds if security issues are discovered.
                            </p>
                        </div>
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
