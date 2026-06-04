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
                <div className="empty-state" style={{ maxWidth: '800px', margin: '40px auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px', textAlign: 'left', color: 'var(--text-secondary)' }}>
                    
                    {/* Hero Section */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px' }}>
                        <div style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '50%',
                            background: 'var(--accent-subtle)',
                            border: '1px solid var(--accent)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '32px',
                            boxShadow: 'var(--shadow-glow)',
                            marginBottom: '8px'
                        }}>
                            ⚡
                        </div>
                        <h2 style={{ 
                            fontSize: '28px', 
                            fontWeight: 700, 
                            letterSpacing: '-0.02em',
                            margin: 0,
                            background: 'linear-gradient(135deg, var(--text-primary) 30%, var(--accent-light) 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent'
                        }}>
                            Welcome to Swazz API Fuzzer
                        </h2>
                        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '580px', margin: '0 auto', lineHeight: '1.6' }}>
                            A high-performance smart fuzzer that parses OpenAPI specifications to automatically discover crashes, injections, and logic errors in your APIs.
                        </p>
                        
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                            <button 
                                className="btn btn-primary" 
                                style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                                onClick={() => {
                                    document.querySelector<HTMLInputElement>('.sidebar input.input')?.focus();
                                }}>
                                🚀 Try Petstore Demo
                            </button>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                Target: https://petstore.swagger.io/v2/swagger.json
                            </span>
                        </div>
                    </div>

                    {/* Content Columns */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
                        
                        {/* Web UI Card */}
                        <div style={{ 
                            background: 'var(--bg-card)', 
                            border: '1px solid var(--border-default)', 
                            borderRadius: '12px', 
                            padding: '24px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px',
                            boxShadow: 'var(--shadow-sm)'
                        }}>
                            <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                🌍 Web Dashboard Mode
                            </h3>
                            <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', lineHeight: '1.5' }}>
                                <li>Enter target <strong>OpenAPI URL</strong> or domain in the configuration panel.</li>
                                <li>Configure authentication, headers, or query parameters.</li>
                                <li>Click <strong>Run Fuzzer</strong> to start finding vulnerabilities in real-time.</li>
                                <li>Explore the live <strong>Heatmap</strong> and inspect requests in the <strong>Timeline</strong>.</li>
                            </ul>
                        </div>

                        {/* Docker Card */}
                        <div style={{ 
                            background: 'var(--bg-card)', 
                            border: '1px solid var(--border-default)', 
                            borderRadius: '12px', 
                            padding: '24px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px',
                            boxShadow: 'var(--shadow-sm)'
                        }}>
                            <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                🐳 Docker Quick Start
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 500 }}>
                                        Web API Server & Dashboard
                                    </div>
                                    <pre style={{ 
                                        background: 'var(--bg-app)', 
                                        border: '1px solid var(--border-subtle)', 
                                        padding: '10px 12px', 
                                        borderRadius: '6px', 
                                        fontSize: '11px', 
                                        overflowX: 'auto', 
                                        color: 'var(--text-primary)', 
                                        fontFamily: 'var(--font-mono)',
                                        margin: 0
                                    }}>
                                        <code>
                                            docker pull ghcr.io/sech0us3/swazz:sha-ade4df2{'\n'}
                                            docker run -p 8080:8080 ghcr.io/sech0us3/swazz:sha-ade4df2
                                        </code>
                                    </pre>
                                </div>
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 500 }}>
                                        Headless CLI Fuzzer (CI/CD)
                                    </div>
                                    <pre style={{ 
                                        background: 'var(--bg-app)', 
                                        border: '1px solid var(--border-subtle)', 
                                        padding: '10px 12px', 
                                        borderRadius: '6px', 
                                        fontSize: '11px', 
                                        overflowX: 'auto', 
                                        color: 'var(--text-primary)', 
                                        fontFamily: 'var(--font-mono)',
                                        margin: 0
                                    }}>
                                        <code>
                                            docker pull ghcr.io/sech0us3/swazz-cli:sha-ade4df2{'\n'}
                                            docker run --rm -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:sha-ade4df2 --config /app/swazz.config.json .
                                        </code>
                                    </pre>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Documentation Call to Action (CTA) */}
                    <div style={{ 
                        borderTop: '1px solid var(--border-subtle)', 
                        paddingTop: '24px', 
                        display: 'flex', 
                        flexDirection: 'column',
                        alignItems: 'center', 
                        gap: '12px', 
                        textAlign: 'center' 
                    }}>
                        <a 
                            href="https://sech0us3.github.io/swazz/usage.html" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '8px', 
                                color: 'var(--accent-light)', 
                                fontSize: '14px', 
                                fontWeight: 500, 
                                textDecoration: 'none'
                            }}
                        >
                            📖 Read the Usage & Configuration Guide →
                        </a>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                            Tip: To learn how to configure authentication pipelines, custom injection wordlists, or rule filters, refer to the documentation.
                        </p>
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
