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
                <div className="empty-state empty-state-welcome">
                    
                    {/* Hero Section */}
                    <div className="welcome-hero">
                        <div className="welcome-hero-icon">
                            ⚡
                        </div>
                        <h2 className="welcome-hero-title">
                            Welcome to Swazz API Fuzzer
                        </h2>
                        <p className="welcome-hero-desc">
                            A high-performance smart fuzzer that parses OpenAPI specifications to automatically discover crashes, injections, and logic errors in your APIs.
                        </p>
                        
                        <div className="welcome-hero-actions">
                            <button 
                                className="btn btn-primary welcome-hero-btn" 
                                onClick={() => {
                                    document.querySelector<HTMLInputElement>('.sidebar input.input')?.focus();
                                }}>
                                🚀 Try Petstore Demo
                            </button>
                            <span className="welcome-hero-btn-target">
                                Target: https://petstore.swagger.io/v2/swagger.json
                            </span>
                        </div>
                    </div>

                    {/* Content Columns */}
                    <div className="welcome-grid">
                        
                        {/* Web UI Card */}
                        <div className="welcome-card">
                            <h3 className="welcome-card-title">
                                🌍 Web Dashboard Mode
                            </h3>
                            <ul className="welcome-card-list">
                                <li>Enter target <strong>OpenAPI URL</strong> or domain in the configuration panel.</li>
                                <li>Configure authentication, headers, or query parameters.</li>
                                <li>Click <strong>Run Fuzzer</strong> to start finding vulnerabilities in real-time.</li>
                                <li>Explore the live <strong>Heatmap</strong> and inspect requests in the <strong>Timeline</strong>.</li>
                            </ul>
                        </div>

                        {/* Docker Card */}
                        <div className="welcome-card">
                            <h3 className="welcome-card-title">
                                🐳 Docker Quick Start
                            </h3>
                            <div className="welcome-docker-group">
                                <div>
                                    <div className="welcome-docker-item-label">
                                        Web API Server & Dashboard
                                    </div>
                                    <pre className="welcome-pre">
                                        <code>
                                            docker pull ghcr.io/sech0us3/swazz:sha-ade4df2{'\n'}
                                            docker run -p 8080:8080 ghcr.io/sech0us3/swazz:sha-ade4df2
                                        </code>
                                    </pre>
                                </div>
                                <div>
                                    <div className="welcome-docker-item-label">
                                        Headless CLI Fuzzer (CI/CD)
                                    </div>
                                    <pre className="welcome-pre">
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
                    <div className="welcome-footer">
                        <a 
                            href="https://sech0us3.github.io/swazz/usage.html" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="welcome-footer-link"
                        >
                            📖 Read the Usage & Configuration Guide →
                        </a>
                        <p className="welcome-footer-tip">
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
