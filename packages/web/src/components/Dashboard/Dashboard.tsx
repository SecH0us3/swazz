import { useState, useEffect } from 'react';
import type { RunStats } from '../../types.js';
import { StatsBar } from './StatsBar.js';
import { Heatmap } from './Heatmap.js';
import type { HeatmapFilter } from './Heatmap.js';
import { useAppStore } from '../../store/appStore.js';

interface Props {
    stats: RunStats | null;
    endpointKeys: string[];
    heatmapFilter: HeatmapFilter | null;
    onHeatmapFilter: (f: HeatmapFilter | null) => void;
    isRunning: boolean;
}

export function Dashboard({ stats, endpointKeys, heatmapFilter, onHeatmapFilter, isRunning }: Props) {
    const [version, setVersion] = useState<string>('<TAG>');

    useEffect(() => {
        if (!stats) {
            fetch('/api/version')
                .then(res => res.json())
                .then(data => {
                    if (data.version && data.version !== 'dev') {
                        setVersion(data.version);
                    }
                })
                .catch(() => {});
        }
    }, [stats]);

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
                                            docker pull ghcr.io/sech0us3/swazz:{version}{'\n'}
                                            docker run -p 8080:8080 ghcr.io/sech0us3/swazz:{version}
                                        </code>
                                    </pre>
                                </div>
                                <div>
                                    <div className="welcome-docker-item-label">
                                        Headless CLI Fuzzer (CI/CD)
                                    </div>
                                    <pre className="welcome-pre">
                                        <code>
                                            docker pull ghcr.io/sech0us3/swazz-cli:{version}{'\n'}
                                            docker run --rm -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:{version} --config /app/swazz.config.json .
                                        </code>
                                    </pre>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Documentation Call to Action (CTA) & Quick Links */}
                    <div className="welcome-footer">
                        <a 
                            href="https://sech0us3.github.io/swazz/usage.html" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="welcome-footer-link"
                        >
                            📖 Read the Usage & Configuration Guide →
                        </a>

                        <div className="welcome-quick-links">
                            <button 
                                className="welcome-quick-link-btn" 
                                onClick={() => useAppStore.setState({ activeTab: 'about' })}
                            >
                                About Project
                            </button>
                            <span className="welcome-quick-link-separator">•</span>
                            <a 
                                href="https://SecH0us3.github.io/swazz/" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="welcome-quick-link"
                            >
                                Documentation
                            </a>
                            <span className="welcome-quick-link-separator">•</span>
                            <button 
                                className="welcome-quick-link-btn" 
                                onClick={() => useAppStore.setState({ isHotkeysHelpOpen: true })}
                            >
                                <span>Keys</span>
                                <kbd className="welcome-quick-hotkeys-kbd">?</kbd>
                            </button>
                            <span className="welcome-quick-link-separator">•</span>
                            <a 
                                href="https://github.com/SecH0us3/swazz" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="welcome-quick-github-link" 
                                title="GitHub Repository"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                                </svg>
                                <span>GitHub</span>
                            </a>
                        </div>

                        <p className="welcome-footer-tip">
                            Tip: The docker commands above automatically reference the running version ({version}). You can replace it with any other release tag (e.g., v1.0.0) or short commit SHA.
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
