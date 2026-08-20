// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useEffect } from 'react';
import './LandingShowcase.css';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

function ScanCounter() {
    const [count, setCount] = useState<number | null>(null);
    const [displayCount, setDisplayCount] = useState<number>(0);

    useEffect(() => {
        const fetchUrl = `${PROXY_URL}/api/telemetry/scans/count`;
        fetch(fetchUrl)
            .then(res => {
                if (!res.ok) {
                    throw new Error(`HTTP error! Status: ${res.status}`);
                }
                return res.json();
            })
            .then(data => {
                if (data && typeof data.total === 'number') {
                    setCount(data.total);
                } else {
                    setCount(1000000);
                }
            })
            .catch(err => {
                console.error('Failed to fetch scan count:', err);
                setCount(1000000); // fallback
            });
    }, []);

    useEffect(() => {
        if (count === null) return;
        let startTimestamp: number | null = null;
        let animationFrameId: number;
        const duration = 2000;
        
        const step = (timestamp: number) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            
            // easeOutQuart
            const ease = 1 - Math.pow(1 - progress, 4);
            
            setDisplayCount(Math.floor(ease * count));
            
            if (progress < 1) {
                animationFrameId = window.requestAnimationFrame(step);
            } else {
                setDisplayCount(count);
            }
        };
        
        animationFrameId = window.requestAnimationFrame(step);
        return () => window.cancelAnimationFrame(animationFrameId);
    }, [count]);

    if (count === null) {
        return <>0+ Scans</>;
    }

    return <>{displayCount.toLocaleString()}+ Scans</>;
}

export interface AttackScenario {
    id: string;
    name: string;
    category: string;
    cwe: string;
    owasp: string;
    severity: 'Critical' | 'High' | 'Medium';
    endpoint: string;
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    originalSpec: {
        headers: Record<string, string>;
        body?: string;
        description: string;
    };
    mutatedPayload: {
        headers: Record<string, string>;
        body?: string;
        mutationDiff: string;
    };
    detectionResult: {
        status: number;
        statusText: string;
        findingTitle: string;
        findingSummary: string;
        remediationTip: string;
    };
}

export const SIMULATOR_SCENARIOS: AttackScenario[] = [
    {
        id: 'bola',
        name: 'BOLA / ID Tampering',
        category: 'Broken Object Level Auth',
        owasp: 'API1:2023 BOLA',
        cwe: 'CWE-639',
        severity: 'Critical',
        endpoint: '/api/v1/users/{id}/billing',
        method: 'GET',
        originalSpec: {
            headers: {
                'Authorization': 'Bearer user_token_1042',
                'Accept': 'application/json'
            },
            description: 'Valid request: Accessing authenticated user ID 1042 profile.'
        },
        mutatedPayload: {
            headers: {
                'Authorization': 'Bearer user_token_1042',
                'Accept': 'application/json'
            },
            mutationDiff: 'GET /api/v1/users/1043/billing  [Tampered path parameter to foreign ID 1043]'
        },
        detectionResult: {
            status: 200,
            statusText: '200 OK (Data Leak)',
            findingTitle: 'Broken Object Level Authorization Detected',
            findingSummary: 'User 1042 successfully accessed confidential billing records of User 1043 without tenant-level authorization checks.',
            remediationTip: 'Enforce record-level ownership checks inside database queries using authenticated session context.'
        }
    },
    {
        id: 'sqli',
        name: 'JSON SQL Injection',
        category: 'Injection in Structured Body',
        owasp: 'API8:2023 Security Misconfiguration',
        cwe: 'CWE-89',
        severity: 'Critical',
        endpoint: '/api/v2/orders/search',
        method: 'POST',
        originalSpec: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer live_token'
            },
            body: JSON.stringify({ category: 'hardware', limit: 20 }, null, 2),
            description: 'Valid request: Filtering hardware orders with schema-compliant JSON body.'
        },
        mutatedPayload: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer live_token'
            },
            body: JSON.stringify({ category: "hardware' OR 1=1;--", limit: 20 }, null, 2),
            mutationDiff: 'category: "hardware\' OR 1=1;--" [Semantic AST mutation in nested JSON parameter]'
        },
        detectionResult: {
            status: 500,
            statusText: '500 SQL Syntax Error',
            findingTitle: 'Unescaped SQL Query Execution in JSON Property',
            findingSummary: 'Database driver returned raw SQL syntax error (PG::SyntaxError: unterminated quoted string).',
            remediationTip: 'Always use parameterized SQL queries and ORM prepared statements for JSON payload fields.'
        }
    },
    {
        id: 'ssrf',
        name: 'SSRF via Header Injection',
        category: 'Server-Side Request Forgery',
        owasp: 'API7:2023 SSRF',
        cwe: 'CWE-918',
        severity: 'High',
        endpoint: '/api/v1/integrations/webhook/test',
        method: 'POST',
        originalSpec: {
            headers: {
                'Content-Type': 'application/json',
                'X-Callback-URL': 'https://customer.app/events'
            },
            body: JSON.stringify({ event: 'ping' }, null, 2),
            description: 'Valid request: Triggering external client webhook URL.'
        },
        mutatedPayload: {
            headers: {
                'Content-Type': 'application/json',
                'X-Callback-URL': 'http://169.254.169.254/latest/meta-data/'
            },
            body: JSON.stringify({ event: 'ping' }, null, 2),
            mutationDiff: 'X-Callback-URL: http://169.254.169.254/... [Cloud metadata link-local injection]'
        },
        detectionResult: {
            status: 200,
            statusText: '200 OK (Internal Metadata Leaked)',
            findingTitle: 'SSRF against Cloud Instance Metadata Service',
            findingSummary: 'Backend fetched AWS/GCP instance metadata endpoint and reflected internal security tokens.',
            remediationTip: 'Activate Swazz SSRF Protection and disallow RFC 1918 & 169.254.0.0/16 private IP ranges in HTTP transport.'
        }
    },
    {
        id: 'mass_assignment',
        name: 'Privilege Mass Assignment',
        category: 'Mass Assignment / Property Escalation',
        owasp: 'API6:2023 Unrestricted Flows',
        cwe: 'CWE-915',
        severity: 'High',
        endpoint: '/api/v1/users/profile',
        method: 'PATCH',
        originalSpec: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer member_token'
            },
            body: JSON.stringify({ display_name: 'Security Lead' }, null, 2),
            description: 'Valid request: Updating self profile display name.'
        },
        mutatedPayload: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer member_token'
            },
            body: JSON.stringify({ display_name: 'Security Lead', role: 'admin', is_superuser: true }, null, 2),
            mutationDiff: '+ "role": "admin", + "is_superuser": true [Unfiltered schema property injection]'
        },
        detectionResult: {
            status: 200,
            statusText: '200 OK (Role Escalated)',
            findingTitle: 'Privilege Escalation via Unrestricted Parameter Binding',
            findingSummary: 'Object attributes were updated with elevated admin privileges without schema whitelisting.',
            remediationTip: 'Explicitly define permitted DTO request fields and discard undeclared JSON keys in updates.'
        }
    }
];

export const FEATURE_DETAILS = {
    fuzzing: {
        title: "Discover Zero-Days",
        details: "Swazz parses your OpenAPI/Swagger/SOAP/GraphQL specifications to understand parameters, types, and constraints. It then dynamically generates targeted fuzzing payloads and shows request mutation visual diffs highlighting the exact payload modifications.",
        goal: "Discover injection vulnerabilities, parser crashes, and edge-case exceptions by sending semantically valid but payload-corrupted requests.",
        benefit: "Discover bugs deep inside business logic that standard scanners (which get blocked by early input validation) completely miss.",
        image: "/screenshots/smart_fuzzing.png"
    },
    har: {
        title: "Replay Real Traffic",
        details: "Import HTTP Archive (HAR) files recorded from browser actions, Postman, or integration tests. Swazz instantly replays, mutates, and fuzzes the captured traffic.",
        goal: "Perform automated regression security testing or quickly audit custom endpoint flows without writing scripts.",
        benefit: "Zero configuration. Simply capture real-world traffic by interacting with your application, upload the HAR file, and run scans immediately.",
        image: "/screenshots/har_replay.png"
    },
    pipelines: {
        title: "Automate Security Testing",
        details: "Run Swazz scans natively in GitHub Actions, GitLab CI, or any container environment. Stream real-time fuzzer metrics, status codes, and request mutation rates directly to your dashboard.",
        goal: "Automate security tests on every commit, pull request, or release build with real-time performance observability.",
        benefit: "Catch vulnerabilities early in the development lifecycle and monitor fuzzer throughput instantly.",
        image: "/screenshots/audit_pipelines.png"
    },
    compliance: {
        title: "Pass Compliance Audits",
        details: "Every discovered crash, anomaly, or security issue is automatically mapped to the OWASP Top 10 API Security Risks (such as BOLA, Broken Auth, or Rate Limiting) and industry-standard Common Weakness Enumeration (CWE) patterns.",
        goal: "Generate compliant audit evidence and prioritize vulnerabilities based on standardized security classifications.",
        benefit: "Developers can resolve issues faster by directly viewing remediation links, tutorials, and vulnerability context maps.",
        image: "/screenshots/compliance_mapping.png"
    },
    grouping: {
        title: "Stop Alert Fatigue",
        details: "Automatically groups scan responses by structural similarity, headers, status codes, and failure characteristics.",
        goal: "Reduce finding fatigue by deduplicating thousands of fuzzing payloads into a few distinct root causes.",
        benefit: "Triage scans in minutes instead of wading through endless repetitive alerts.",
        image: "/screenshots/response_grouping.png"
    },
    integration: {
        title: "Integrate with Jira & GitHub",
        details: "Exports standard SARIF (Static Analysis Results Interchange Format) logs. These are natively parsed by GitHub Code Scanning, GitLab Security Hub, Jira, and other vulnerability systems.",
        goal: "Integrate scan results into existing issue trackers, developers' dashboards, and security visualization tools.",
        benefit: "Security teams can monitor vulnerabilities without teaching developers new platforms; alerts surface directly in standard PR reviews.",
        image: "/screenshots/sarif_integration.png"
    },
    extension: {
        title: "Browser Extension",
        details: "Capture HTTP/HTTPS requests, custom headers, and authentication tokens directly as you navigate your application. Swazz's browser extension streams live traffic directly to your local runner profile.",
        goal: "Eliminate manual HAR file exports and automatically record real-time user session flows for immediate fuzzing.",
        benefit: "Start fuzzing single endpoints or multi-step browser interactions with zero configuration.",
        image: "/screenshots/browser_extension.png"
    }
};

interface LandingShowcaseProps {
    onActionClick?: () => void;
    actionText?: string;
    showPricing?: boolean;
}

export function LandingShowcase({ onActionClick, actionText, showPricing = true }: LandingShowcaseProps) {
    const [selectedFeature, setSelectedFeature] = useState<any>(null);
    const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
    const [activeDeploymentTab, setActiveDeploymentTab] = useState<'cli'|'docker'|'local'|'worker'>('cli');
    const [activeScenarioId, setActiveScenarioId] = useState<string>('bola');
    const [isSimulating, setIsSimulating] = useState<boolean>(false);
    const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
    const [showWaitlistModal, setShowWaitlistModal] = useState(false);
    const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
    const [waitlistEmail, setWaitlistEmail] = useState('');
    const [waitlistName, setWaitlistName] = useState('');
    const [waitlistCompany, setWaitlistCompany] = useState('');

    const activeScenario = SIMULATOR_SCENARIOS.find(s => s.id === activeScenarioId) || SIMULATOR_SCENARIOS[0];

    const handleRunSimulation = () => {
        setIsSimulating(true);
        setTimeout(() => {
            setIsSimulating(false);
        }, 600);
    };

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedStates(prev => ({ ...prev, [id]: true }));
        setTimeout(() => {
            setCopiedStates(prev => ({ ...prev, [id]: false }));
        }, 2000);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (fullscreenImageUrl) {
                    setFullscreenImageUrl(null);
                } else if (selectedFeature) {
                    setSelectedFeature(null);
                } else if (showWaitlistModal) {
                    setShowWaitlistModal(false);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fullscreenImageUrl, selectedFeature, showWaitlistModal]);

    return (
        <main className="landing-main">
            {/* AMBIENT FUTURISTIC CYBER BACKGROUND */}
            <div className="cyber-ambient-backdrop" aria-hidden="true">
                <img 
                    src="/assets/cyber_futuristic_bg.jpg" 
                    alt="" 
                    className="cyber-backdrop-image"
                />
                <div className="cyber-laser-scanner"></div>
                <div className="cyber-grid-overlay"></div>
            </div>

            {/* HERO SECTION */}
            <section className="landing-hero">
                <div className="landing-hero-badge">
                    <span className="badge-pulse-dot"></span>
                    <span>Autonomous API Resilience &amp; Zero-Day Fuzzing</span>
                </div>
                <h1 className="landing-hero-title">Break Your APIs Before Hackers Do</h1>
                <p className="landing-hero-subtitle">
                    Turn OpenAPI specs, GraphQL schemas, and HAR recordings into intelligent, context-aware fuzzing payloads. Uncover hidden business logic flaws, BOLA exploits, and injection vulnerabilities in seconds.
                </p>
                <div className="landing-hero-ctas">
                    {onActionClick && (
                        <button type="button" onClick={onActionClick} className="btn-landing-primary">
                            {actionText || "Run a live demo scan"}
                        </button>
                    )}
                    <a href="#simulator" className="btn-landing-secondary">
                        Try live fuzzer simulator ↓
                    </a>
                </div>
            </section>

            {/* TRUST BAR (SOCIAL PROOF & TELEMETRY) */}
            <section className="trust-bar">
                <div className="trust-text">Trusted for mission-critical API security</div>
                <div className="trust-logos">
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                        </svg>
                        <ScanCounter />
                    </div>
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                        OWASP API Top 10
                    </div>
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        PCI-DSS Compliant
                    </div>
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                        BSL 1.1 Licensed
                    </div>
                </div>
            </section>

            {/* LIVE FUZZING SIMULATOR PLAYGROUND */}
            <section id="simulator" className="simulator-section">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Interactive Attack Simulator</div>
                    <h2>Experience Semantic Fuzzing in Action</h2>
                    <p>Select an API attack vector below to see how Swazz parses valid contracts, mutates AST structures, and isolates root-cause vulnerabilities.</p>
                </div>

                <div className="simulator-container">
                    {/* Scenario Tabs */}
                    <div className="simulator-scenario-bar" role="tablist" aria-label="Simulator Scenarios">
                        {SIMULATOR_SCENARIOS.map(scenario => (
                            <button
                                key={scenario.id}
                                role="tab"
                                aria-selected={activeScenarioId === scenario.id}
                                className={`scenario-tab-btn ${activeScenarioId === scenario.id ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveScenarioId(scenario.id);
                                    handleRunSimulation();
                                }}
                            >
                                <span className={`severity-pill ${scenario.severity.toLowerCase()}`}>
                                    {scenario.severity}
                                </span>
                                <span className="scenario-tab-title">{scenario.name}</span>
                            </button>
                        ))}
                    </div>

                    {/* Simulator Console Box */}
                    <div className={`simulator-console ${isSimulating ? 'simulating' : ''}`}>
                        <div className="simulator-header-bar">
                            <div className="simulator-endpoint-tag">
                                <span className={`method-badge method-${activeScenario.method.toLowerCase()}`}>
                                    {activeScenario.method}
                                </span>
                                <span className="endpoint-path-text">{activeScenario.endpoint}</span>
                            </div>
                            <div className="simulator-action-group">
                                <span className="cwe-badge">{activeScenario.cwe} • {activeScenario.owasp}</span>
                                <button 
                                    type="button" 
                                    className="btn-simulator-run"
                                    onClick={handleRunSimulation}
                                    disabled={isSimulating}
                                >
                                    {isSimulating ? 'Mutating Payload...' : '↻ Re-run Mutation'}
                                </button>
                            </div>
                        </div>

                        {/* Split Diff Playground */}
                        <div className="simulator-body-grid">
                            {/* Left: Original Request */}
                            <div className="simulator-panel original-panel">
                                <div className="panel-title">
                                    <span>Original OpenAPI Contract</span>
                                    <span className="panel-status-indicator normal">Valid Schema</span>
                                </div>
                                <div className="panel-code-box">
                                    <div className="code-line-desc">{activeScenario.originalSpec.description}</div>
                                    <div className="headers-block">
                                        {Object.entries(activeScenario.originalSpec.headers).map(([k, v]) => (
                                            <div key={k} className="header-line">
                                                <span className="code-key">{k}:</span> <span className="code-val">{v}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {activeScenario.originalSpec.body && (
                                        <pre className="code-json-body">{activeScenario.originalSpec.body}</pre>
                                    )}
                                </div>
                            </div>

                            {/* Right: Swazz Mutated Payload */}
                            <div className="simulator-panel mutated-panel">
                                <div className="panel-title">
                                    <span>Swazz Semantic Mutation</span>
                                    <span className="panel-status-indicator mutated">Payload Mutated</span>
                                </div>
                                <div className="panel-code-box">
                                    <div className="mutation-diff-pill">
                                        ⚡ {activeScenario.mutatedPayload.mutationDiff}
                                    </div>
                                    <div className="headers-block">
                                        {Object.entries(activeScenario.mutatedPayload.headers).map(([k, v]) => (
                                            <div key={k} className="header-line">
                                                <span className="code-key">{k}:</span> <span className="code-val">{v}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {activeScenario.mutatedPayload.body && (
                                        <pre className="code-json-body highlight-mutated">{activeScenario.mutatedPayload.body}</pre>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Result / Detection Telemetry */}
                        <div className="simulator-result-footer">
                            <div className="result-header">
                                <span className={`result-status-badge status-${activeScenario.detectionResult.status >= 500 ? '500' : 'vuln'}`}>
                                    {activeScenario.detectionResult.statusText}
                                </span>
                                <strong className="result-finding-title">{activeScenario.detectionResult.findingTitle}</strong>
                            </div>
                            <p className="result-summary-text">{activeScenario.detectionResult.findingSummary}</p>
                            <div className="result-remediation-box">
                                <span className="remediation-label">💡 Recommended Fix:</span> {activeScenario.detectionResult.remediationTip}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* DEMO VIDEO / SHOWCASE */}
            <section id="demo" className="landing-video-section">
                <div className="glass-container">
                    <div className="glass-header">
                        <div className="glass-dots">
                            <span className="glass-dot"></span>
                            <span className="glass-dot"></span>
                            <span className="glass-dot"></span>
                        </div>
                        <div className="glass-address-bar">https://swazz.secmy.app/</div>
                    </div>
                    <div className="glass-content">
                        <video src="/swazz_demo.webm" className="landing-video-element" controls autoPlay muted loop playsInline></video>
                    </div>
                </div>
            </section>

            {/* INTERACTIVE BENCHMARK & COMPARISON MATRIX */}
            <section id="benchmarks" className="benchmark-section">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Technical Benchmarks</div>
                    <h2>How Swazz Outperforms Legacy Scanners</h2>
                    <p>Traditional DAST tools fail against modern microservices because they lack schema awareness and flood developers with repetitive noise.</p>
                </div>

                <div className="benchmark-table-wrapper">
                    <table className="benchmark-table">
                        <thead>
                            <tr>
                                <th scope="col" className="col-capability">Capability</th>
                                <th scope="col" className="col-swazz">
                                    <div className="swazz-col-header">
                                        <span className="swazz-brand-name">Swazz</span>
                                        <span className="swazz-pill">Next-Gen</span>
                                    </div>
                                </th>
                                <th scope="col" className="col-legacy">Traditional DAST Scanners</th>
                                <th scope="col" className="col-generic">Generic Random Fuzzers</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="cap-title">
                                    <strong>Semantic Spec Awareness</strong>
                                    <span>Parses OpenAPI, SOAP &amp; GraphQL parameter constraints and types.</span>
                                </td>
                                <td className="val-swazz">
                                    <span className="check-icon">✓</span> Deep AST parsing &amp; smart mutation
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Blind regex &amp; string injection
                                </td>
                                <td className="val-other">
                                    <span className="partial-icon">~</span> Basic schema checks only
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Zero-Setup HAR Replay</strong>
                                    <span>Replay real browser user journeys and authenticate traffic in 1 click.</span>
                                </td>
                                <td className="val-swazz">
                                    <span className="check-icon">✓</span> Instant drag-and-drop &amp; Chrome Extension
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Heavy proxy &amp; manual certificate setup
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Unsupported
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>OWASP API Top 10 Classification</strong>
                                    <span>Automatic mapping to BOLA, Broken Auth, and SSRF CWEs.</span>
                                </td>
                                <td className="val-swazz">
                                    <span className="check-icon">✓</span> Native 2023 classification + remediation
                                </td>
                                <td className="val-other">
                                    <span className="partial-icon">~</span> Generic web vulnerabilities only
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Raw HTTP status logs
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Response Deduplication (Anti-Fatigue)</strong>
                                    <span>Groups thousands of responses by structural root causes.</span>
                                </td>
                                <td className="val-swazz">
                                    <span className="check-icon">✓</span> Automatic clustering (Zero alert fatigue)
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Endless duplicate alert lists
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Unprocessed stdout streams
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Sub-Second Edge Execution &amp; CI/CD</strong>
                                    <span>Runs natively in GitHub Actions and Cloudflare Edge Workers.</span>
                                </td>
                                <td className="val-swazz">
                                    <span className="check-icon">✓</span> Blazing fast Go engine + Edge routing
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Multi-GB Java VM overhead
                                </td>
                                <td className="val-other">
                                    <span className="partial-icon">~</span> Single-thread Python / CLI only
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Native SARIF Export</strong>
                                    <span>Surface security alerts directly in standard PR reviews and Jira.</span>
                                </td>
                                <td className="val-swazz">
                                    <span className="check-icon">✓</span> Standard SARIF for GitHub Code Scanning
                                </td>
                                <td className="val-other">
                                    <span className="partial-icon">~</span> Proprietary XML/HTML exports
                                </td>
                                <td className="val-other">
                                    <span className="cross-icon">✗</span> Non-standard text output
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            {/* BENTO GRID */}
            <section id="features" className="landing-features">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Enterprise Architecture</div>
                    <h2>Everything You Need to Ship Secure APIs</h2>
                    <p>Designed from the ground up for modern AppSec and DevSecOps engineering teams.</p>
                </div>
                
                <div className="landing-bento-grid">
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.fuzzing)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                                <polyline points="2 17 12 22 22 17"></polyline>
                                <polyline points="2 12 12 17 22 12"></polyline>
                            </svg>
                        </div>
                        <h3>Smart Fuzzing</h3>
                        <p>Context-aware payload generation mapping exactly to your API constraints and types.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.extension)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="2" y1="12" x2="22" y2="12"></line>
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                            </svg>
                        </div>
                        <h3>Browser Extension</h3>
                        <p>Capture real-time browser requests and authentication headers directly into Swazz.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.har)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </div>
                        <h3>Zero-Setup HAR</h3>
                        <p>Instantly replay and mutate traffic from browser recordings without configuration.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.pipelines)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            </svg>
                        </div>
                        <h3>CI/CD Integration</h3>
                        <p>Native pipelines for GitHub Actions and GitLab with real-time performance telemetry.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.compliance)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                            </svg>
                        </div>
                        <h3>OWASP Top 10 Mapping</h3>
                        <p>Classify vulnerabilities instantly to industry-standard API Security Risks and CWEs.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.grouping)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </div>
                        <h3>Response Grouping</h3>
                        <p>Automatically deduplicate thousands of payloads into distinct root causes for fast triage.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.integration)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                        </div>
                        <h3>SARIF Exports</h3>
                        <p>Generate standard SARIF logs to integrate with GitHub Code Scanning and Jira.</p>
                    </div>
                </div>
            </section>

            {/* QUICKSTART TERMINAL & DEPLOYMENT */}
            <section id="solutions" className="deployment-section">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Zero Friction</div>
                    <h2>Deploy &amp; Run Anywhere</h2>
                    <p>Run locally via CLI, deploy inside Docker, or automate seamlessly in CI/CD pipelines.</p>
                </div>
                
                <div className="deployment-container">
                    <div className="deployment-tabs" role="tablist" aria-label="Deployment Options">
                        <button 
                            type="button" 
                            role="tab"
                            aria-selected={activeDeploymentTab === 'cli'}
                            className={`deploy-tab-btn ${activeDeploymentTab === 'cli' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('cli')}
                        >
                            CLI Quickstart
                        </button>
                        <button 
                            type="button" 
                            role="tab"
                            aria-selected={activeDeploymentTab === 'docker'}
                            className={`deploy-tab-btn ${activeDeploymentTab === 'docker' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('docker')}
                        >
                            Docker
                        </button>
                        <button 
                            type="button" 
                            role="tab"
                            aria-selected={activeDeploymentTab === 'local'}
                            className={`deploy-tab-btn ${activeDeploymentTab === 'local' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('local')}
                        >
                            Local (No Docker)
                        </button>
                        <button 
                            type="button" 
                            role="tab"
                            aria-selected={activeDeploymentTab === 'worker'}
                            className={`deploy-tab-btn ${activeDeploymentTab === 'worker' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('worker')}
                        >
                            Cloudflare Worker
                        </button>
                    </div>
                    <div className="deployment-content">
                        {activeDeploymentTab === 'cli' && (
                            <div className="deployment-code-wrapper">
                                <div className="code-header">
                                    <span>Run Instant CLI Scan against OpenAPI Spec</span>
                                    <button 
                                        type="button"
                                        className="deploy-copy-btn" 
                                        onClick={() => handleCopy(`npx @swazz/cli start --spec https://petstore.swagger.io/v2/swagger.json`, 'cli-start')}
                                    >
                                        {copiedStates['cli-start'] ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="code-terminal">
                                    <code>{`# Run Swazz CLI scanner instantly against any OpenAPI/Swagger URL
npx @swazz/cli start --spec https://petstore.swagger.io/v2/swagger.json`}</code>
                                </pre>
                            </div>
                        )}
                        {activeDeploymentTab === 'docker' && (
                            <div className="deployment-code-wrapper">
                                <div className="code-header">
                                    <span>Option A: Run Standalone Scanner (CLI)</span>
                                    <button 
                                        type="button"
                                        className="deploy-copy-btn" 
                                        onClick={() => handleCopy(`docker pull ghcr.io/sech0us3/swazz-cli:latest\ndocker run --rm -it -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:latest --config /app/swazz.config.json`, 'docker-cli')}
                                    >
                                        {copiedStates['docker-cli'] ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="code-terminal">
                                    <code>{`docker pull ghcr.io/sech0us3/swazz-cli:latest\ndocker run --rm -it -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:latest --config /app/swazz.config.json`}</code>
                                </pre>

                                <div className="code-header code-header-spaced">
                                    <span>Option B: Run Full Local Stack (Compose)</span>
                                    <button 
                                        type="button"
                                        className="deploy-copy-btn" 
                                        onClick={() => handleCopy(`git clone https://github.com/SecH0us3/swazz.git\ncd swazz && docker compose up --build`, 'docker-compose')}
                                    >
                                        {copiedStates['docker-compose'] ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="code-terminal">
                                    <code>{`# Clone the repository and start all services (Dashboard, Coordinator, and Runner Agent)
git clone https://github.com/SecH0us3/swazz.git
cd swazz && docker compose up --build`}</code>
                                </pre>
                            </div>
                        )}
                        {activeDeploymentTab === 'local' && (
                            <div className="deployment-code-wrapper">
                                <div className="code-header">
                                    <span>Run the Full Stack Locally (Without Docker)</span>
                                    <button 
                                        type="button"
                                        className="deploy-copy-btn" 
                                        onClick={() => handleCopy(`git clone https://github.com/SecH0us3/swazz.git\ncd swazz && ./start-dev.sh`, 'local-nodocker')}
                                    >
                                        {copiedStates['local-nodocker'] ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="code-terminal">
                                    <code>{`# Clone the repository
git clone https://github.com/SecH0us3/swazz.git
cd swazz

# Install dependencies and start all dev servers + Go Runner Agent
./start-dev.sh`}</code>
                                </pre>
                            </div>
                        )}
                        {activeDeploymentTab === 'worker' && (
                            <div className="deployment-code-wrapper">
                                <div className="code-header">
                                    <span>Bind to your own Cloudflare account</span>
                                    <button 
                                        type="button"
                                        className="deploy-copy-btn" 
                                        onClick={() => handleCopy(`export default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/api/swazz")) {\n      return await env.SWAZZ_COORDINATOR.fetch(request);\n    }\n    return await fetch(request);\n  }\n}`, 'worker')}
                                    >
                                        {copiedStates['worker'] ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="code-terminal">
                                    <code>{`export default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    if (url.pathname.startsWith("/api/swazz")) {\n      return await env.SWAZZ_COORDINATOR.fetch(request);\n    }\n    return await fetch(request);\n  }\n}`}</code>
                                </pre>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            {showPricing && (
                <section id="pricing" className="pricing-section">
                    <div className="landing-section-header">
                        <div className="section-eyebrow">Fair Licensing</div>
                        <h2>Transparent Security Pricing</h2>
                        <p>Swazz is licensed under BSL 1.1 — Free for non-commercial use &amp; businesses under $1M revenue. Commercial Enterprise licenses available for large teams.</p>
                    </div>

                    <div className="pricing-grid">
                        <div className="pricing-card">
                            <h3>Community Edition</h3>
                            <div className="price">Free <span>(BSL 1.1)</span></div>
                            <ul className="pricing-features">
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Self-Hosted &amp; Local CLI Fuzzer
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Private Dedicated &amp; Shared Runners
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    OpenAPI, HAR, SOAP &amp; GraphQL Support
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    14-Day Free Trial for Enterprise Features
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Free for Revenue &lt; $1,000,000 / Open Source
                                </li>
                            </ul>
                            <button type="button" onClick={onActionClick} className="btn-pricing primary">
                                Get Started Free
                            </button>
                        </div>
                        
                        <div className="pricing-card featured">
                            <div className="pricing-badge">Commercial</div>
                            <h3>Commercial &amp; Enterprise</h3>
                            <div className="price">Custom</div>
                            <ul className="pricing-features">
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    BSL 1.1 Enterprise Production Grant
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Enterprise SAML SSO &amp; Okta Integration
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    RBAC &amp; Multi-Tenant Organizations
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Custom Compliance PDF Reports (PCI-DSS, SOC2)
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Jira &amp; GitLab Security Center Integration
                                </li>
                            </ul>
                            <button type="button" onClick={() => setShowWaitlistModal(true)} className="btn-pricing secondary">
                                Request Enterprise License
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* FOOTER */}
            <footer className="landing-footer">
                <div className="footer-logo">
                    <div className="logo-icon-container">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                    </div>
                    <span className="footer-logo-text">Swazz</span>
                </div>
                <div className="footer-links">
                    <a href="https://sech0us3.github.io/swazz/" target="_blank" rel="noopener noreferrer">Documentation</a>
                    <a href="https://github.com/SecH0us3/swazz" target="_blank" rel="noopener noreferrer">GitHub</a>
                    <a href="https://yoursec.substack.com/" target="_blank" rel="noopener noreferrer">Blog</a>
                </div>
                <div className="footer-copyright">
                    &copy; {new Date().getFullYear()} Swazz Security. All rights reserved.
                </div>
            </footer>

            {/* Feature Detail Modal */}
            {selectedFeature && (
                <div className="feature-modal-backdrop" onClick={() => setSelectedFeature(null)}>
                    <div className="feature-modal-split" onClick={(e) => e.stopPropagation()}>
                        <div className="feature-modal-left">
                            <button type="button" className="auth-modal-close" onClick={() => setSelectedFeature(null)} aria-label="Close modal">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                            <h3>{selectedFeature.title}</h3>
                            <div className="feature-detail-section">
                                <h4>What it is</h4>
                                <p>{selectedFeature.details}</p>
                            </div>
                            <div className="feature-detail-section">
                                <h4>The Goal</h4>
                                <p>{selectedFeature.goal}</p>
                            </div>
                            <div className="feature-detail-section">
                                <h4>Why you need it</h4>
                                <p>{selectedFeature.benefit}</p>
                            </div>
                        </div>
                        <div className="feature-modal-right">
                            {selectedFeature.image && (
                                <img 
                                    src={selectedFeature.image} 
                                    alt={selectedFeature.title} 
                                    className="feature-modal-screenshot clickable" 
                                    onClick={() => setFullscreenImageUrl(selectedFeature.image || null)}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Enterprise Waitlist Modal */}
            {showWaitlistModal && (
                <div className="feature-modal-backdrop" onClick={() => setShowWaitlistModal(false)}>
                    <div className="waitlist-modal-content" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="auth-modal-close" onClick={() => setShowWaitlistModal(false)} aria-label="Close modal">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                        <div className="waitlist-header">
                            <div className="waitlist-icon">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                </svg>
                            </div>
                            <h2>Swazz Enterprise Waitlist</h2>
                            <p>Unlock custom BSL 1.1 commercial licensing, SAML SSO, RBAC, dedicated cloud runners, and custom compliance reports.</p>
                        </div>
                        {waitlistSubmitted ? (
                            <div className="waitlist-success">
                                <div className="success-icon">✓</div>
                                <h3>Request Received!</h3>
                                <p>Thank you, {waitlistName || 'security teammate'}. Our enterprise licensing team will contact you at <strong>{waitlistEmail}</strong> shortly.</p>
                                <button type="button" className="btn-pricing primary" onClick={() => { setShowWaitlistModal(false); setWaitlistSubmitted(false); }}>
                                    Close
                                </button>
                            </div>
                        ) : (
                            <form className="waitlist-form" onSubmit={(e) => { e.preventDefault(); setWaitlistSubmitted(true); }}>
                                <div className="form-group">
                                    <label htmlFor="waitlist-name">Full Name</label>
                                    <input 
                                        id="waitlist-name" 
                                        type="text" 
                                        required 
                                        data-1p-ignore
                                        placeholder="Alex Smith" 
                                        value={waitlistName} 
                                        onChange={(e) => setWaitlistName(e.target.value)} 
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="waitlist-email">Work Email</label>
                                    <input 
                                        id="waitlist-email" 
                                        type="email" 
                                        required 
                                        data-1p-ignore
                                        placeholder="alex@company.com" 
                                        value={waitlistEmail} 
                                        onChange={(e) => setWaitlistEmail(e.target.value)} 
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="waitlist-company">Company Name</label>
                                    <input 
                                        id="waitlist-company" 
                                        type="text" 
                                        required 
                                        data-1p-ignore
                                        placeholder="Acme Security Inc." 
                                        value={waitlistCompany} 
                                        onChange={(e) => setWaitlistCompany(e.target.value)} 
                                    />
                                </div>
                                <button type="submit" className="btn-pricing primary">
                                    Submit Enterprise Access Request
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Fullscreen Image Zoom Overlay */}
            {fullscreenImageUrl && (
                <div className="feature-modal-backdrop fullscreen-backdrop" onClick={() => setFullscreenImageUrl(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="fullscreen-image-container">
                        <button type="button" onClick={() => setFullscreenImageUrl(null)} aria-label="Close fullscreen view" className="fullscreen-close-btn">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                        <img src={fullscreenImageUrl} alt="Fullscreen View" className="fullscreen-image" />
                    </div>
                </div>
            )}
        </main>
    );
}
