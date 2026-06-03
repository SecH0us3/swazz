import type { RunStats } from '../../types.js';
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
                    <div className="empty-state-text" style={{ maxWidth: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: '4px', marginBottom: '16px' }}>
                                <iframe
                                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                                    src=""
                                    title="Swazz API Fuzzer Tutorial"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                ></iframe>
                            </div>
                            <a href="https://SecH0us3.github.io/swazz/" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                📚 Read Official Documentation
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                    <polyline points="12 5 19 12 12 19"></polyline>
                                </svg>
                            </a>
                        </div>
                        
                        <div style={{ background: 'var(--bg-elevated)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
                            <h4 style={{ color: 'var(--text-primary)', margin: '0 0 12px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                🌍 Web Interface Quick Start
                            </h4>
                            <ul style={{ margin: '0', paddingLeft: '1.25rem', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <li>Enter your <strong>OpenAPI/Swagger URL</strong> or target domain in the top field.</li>
                                <li>Press <span style={{ padding: "2px 6px", background: "var(--bg-surface)", borderRadius: "4px", border: "1px solid var(--border-hover)", fontSize: "11px", color: "var(--text-primary)" }}>Run</span> to begin finding vulnerabilities.</li>
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
                            <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: '6px', margin: '0 0 12px 0', fontSize: '11px', overflowX: 'auto', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                <code><span style={{ color: 'var(--text-muted)' }}># Clone the repository and install dependencies</span>{'\n'}git clone https://github.com/SecH0us3/swazz{'\n'}cd swazz{'\n'}npm install{'\n\n'}<span style={{ color: 'var(--text-muted)' }}># Navigate to backend package and run scan</span>{'\n'}cd packages/container{'\n'}go run main.go start --config ../../swazz.config.json{'\n\n'}<span style={{ color: 'var(--text-muted)' }}># Generate a visual HTML report</span>{'\n'}go run main.go start --config ../../swazz.config.json --format html -o report.html</code>
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
