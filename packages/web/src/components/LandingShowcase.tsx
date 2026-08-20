// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useEffect, useRef } from 'react';
import './LandingShowcase.css';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

function ScanCounter() {
    const [count, setCount] = useState<number | null>(null);
    const [displayCount, setDisplayCount] = useState<number>(0);
    const requestRef = useRef<number | null>(null);

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
                if (data && typeof data.total === 'number' && data.total > 0) {
                    setCount(data.total);
                } else {
                    setCount(null);
                }
            })
            .catch(err => {
                console.error("Failed to fetch scan count:", err);
                setCount(null);
            });
    }, []);

    useEffect(() => {
        if (count === null) return;
        const duration = 1500;
        const startTime = performance.now();

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            setDisplayCount(Math.floor(easeOut * count));

            if (progress < 1) {
                requestRef.current = requestAnimationFrame(animate);
            }
        };

        requestRef.current = requestAnimationFrame(animate);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [count]);

    if (count === null) {
        return null;
    }

    return (
        <div className="trust-logo-item">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            <span>{displayCount.toLocaleString()}+ Scans Run</span>
        </div>
    );
}

export interface FeatureDetail {
    title: string;
    details: string;
    goal: string;
    benefit: string;
    image: string;
}

export interface AttackScenario {
    id: string;
    name: string;
    category: string;
    owasp: string;
    cwe: string;
    severity: 'Critical' | 'High' | 'Medium';
    endpoint: string;
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    story: string;
    exploitAction: string;
    impact: string;
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
        name: 'BOLA / IDOR Exploit',
        category: 'Broken Object Level Authorization',
        owasp: 'API1:2023 Broken Object Level Auth',
        cwe: 'CWE-639',
        severity: 'Critical',
        endpoint: '/api/v1/users/{id}/billing',
        method: 'GET',
        story: 'An authenticated user requests billing statements. The application accepts any ID parameter without validating tenancy boundaries.',
        exploitAction: 'Swazz extracts path parameter dependencies and mutates the identifier cross-tenant, detecting unauthorized data exposure.',
        impact: 'Unauthorized Exfiltration of Financial & PII Data across tenant boundaries.',
        originalSpec: {
            headers: {
                'Authorization': 'Bearer user_token_1042',
                'Accept': 'application/json'
            },
            description: 'Valid request: Authenticated User #1042 accesses their own billing endpoint.'
        },
        mutatedPayload: {
            headers: {
                'Authorization': 'Bearer user_token_1042',
                'Accept': 'application/json'
            },
            mutationDiff: 'GET /api/v1/users/1043/billing  [Path parameter tampered from 1042 → 1043]'
        },
        detectionResult: {
            status: 200,
            statusText: '200 OK (Cross-Tenant Data Leaked)',
            findingTitle: 'Broken Object Level Authorization Detected (BOLA)',
            findingSummary: 'User #1042 successfully accessed confidential billing records of User #1043 without tenant-level authorization checks.',
            remediationTip: 'Enforce record-level ownership checks inside database queries using authenticated session context (e.g., WHERE user_id = :session_user_id).'
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
        story: 'An order search filter accepts JSON parameters. The backend concatenates JSON string fields directly into SQL queries.',
        exploitAction: 'Swazz detects structured parameter types and injects an AST-aware SQL polyglot payload inside the nested JSON body.',
        impact: 'Database Driver Parser Crash / Full Table Exfiltration bypassing application input filters.',
        originalSpec: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer live_token'
            },
            body: JSON.stringify({ category: 'hardware', limit: 20 }, null, 2),
            description: 'Valid request: Standard order filtering with schema-compliant JSON body.'
        },
        mutatedPayload: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer live_token'
            },
            body: JSON.stringify({ category: "hardware' OR 1=1;--", limit: 20 }, null, 2),
            mutationDiff: 'category: "hardware\' OR 1=1;--" [Semantic AST mutation in nested JSON field]'
        },
        detectionResult: {
            status: 500,
            statusText: '500 SQL Syntax Error (Vulnerability Confirmed)',
            findingTitle: 'Unescaped SQL Query Execution in Structured JSON',
            findingSummary: 'Database driver returned raw SQL syntax error (PG::SyntaxError: unterminated quoted string), indicating direct SQL interpolation.',
            remediationTip: 'Always use parameterized SQL queries and ORM prepared statements for JSON payload fields.'
        }
    },
    {
        id: 'ssrf',
        name: 'SSRF via Webhook URL',
        category: 'Server-Side Request Forgery',
        owasp: 'API7:2023 Server Side Request Forgery',
        cwe: 'CWE-918',
        severity: 'Critical',
        endpoint: '/api/v1/integrations/webhook',
        method: 'POST',
        story: 'An integration endpoint allows customers to register webhook URLs for event callbacks without IP range restrictions.',
        exploitAction: 'Swazz injects cloud metadata endpoint addresses (169.254.169.254) and internal subnet ranges into the callback parameter.',
        impact: 'Full Cloud Instance Identity Role & Temporary IAM Credential Theft.',
        originalSpec: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer dev_token'
            },
            body: JSON.stringify({ target_url: 'https://hooks.slack.com/services/T00/B00/XXXX', events: ['deploy'] }, null, 2),
            description: 'Valid request: Registering a standard public SaaS webhook URL.'
        },
        mutatedPayload: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer dev_token'
            },
            body: JSON.stringify({ target_url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/', events: ['deploy'] }, null, 2),
            mutationDiff: 'target_url: "http://169.254.169.254/..." [AWS Cloud Metadata IP injection]'
        },
        detectionResult: {
            status: 200,
            statusText: '200 OK (AWS IAM Metadata Fetched)',
            findingTitle: 'Server-Side Request Forgery (SSRF) to Cloud Metadata',
            findingSummary: 'Server performed outbound HTTP request to link-local metadata address and reflected secret AWS IAM role tokens.',
            remediationTip: 'Implement strict egress IP filtering to reject loopback (127.0.0.1), private (10.0.0.0/8, 192.168.0.0/16), and link-local (169.254.0.0/16) addresses.'
        }
    },
    {
        id: 'mass_assignment',
        name: 'Mass Assignment Privilege Escalation',
        category: 'Unrestricted Object Binding',
        owasp: 'API3:2023 Broken Object Property Level Auth',
        cwe: 'CWE-915',
        severity: 'High',
        endpoint: '/api/v1/users/profile',
        method: 'PATCH',
        story: 'A user profile update endpoint binds incoming request JSON directly to the backend database user model.',
        exploitAction: 'Swazz analyzes the schema graph and injects hidden administrative fields (role, is_superuser) into the update body.',
        impact: 'Immediate privilege escalation from standard tenant member to Organization Admin.',
        originalSpec: {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer member_token'
            },
            body: JSON.stringify({ display_name: 'Security Lead' }, null, 2),
            description: 'Valid request: Standard user updating their own profile display name.'
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
            statusText: '200 OK (Role Escalated to Admin)',
            findingTitle: 'Privilege Escalation via Unrestricted Parameter Binding',
            findingSummary: 'Object attributes were updated with elevated admin privileges without schema whitelisting or authorization guards.',
            remediationTip: 'Explicitly define permitted DTO request fields and discard undeclared JSON keys in ORM update mutations.'
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
    const [selectedFeature, setSelectedFeature] = useState<FeatureDetail | null>(null);
    const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
    const [activeDeploymentTab, setActiveDeploymentTab] = useState<'cli'|'docker'|'local'|'worker'>('cli');
    const [activeScenarioId, setActiveScenarioId] = useState<string>('bola');
    const [isSimulating, setIsSimulating] = useState<boolean>(false);
    const [simulationStage, setSimulationStage] = useState<1 | 2 | 3>(3);
    const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
    const [showWaitlistModal, setShowWaitlistModal] = useState(false);
    const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
    const [isSubmittingWaitlist, setIsSubmittingWaitlist] = useState(false);
    const [waitlistEmail, setWaitlistEmail] = useState('');
    const [waitlistName, setWaitlistName] = useState('');
    const [waitlistCompany, setWaitlistCompany] = useState('');

    const simulationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copyTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const activeScenario = SIMULATOR_SCENARIOS.find(s => s.id === activeScenarioId) || SIMULATOR_SCENARIOS[0];

    const handleRunSimulation = () => {
        if (simulationTimerRef.current) {
            clearTimeout(simulationTimerRef.current);
        }
        if (stageTimerRef.current) {
            clearTimeout(stageTimerRef.current);
        }

        const prefersReduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) {
            setSimulationStage(3);
            setIsSimulating(false);
            return;
        }

        setIsSimulating(true);
        setSimulationStage(1);

        stageTimerRef.current = setTimeout(() => {
            setSimulationStage(2);
        }, 450);

        simulationTimerRef.current = setTimeout(() => {
            setSimulationStage(3);
            setIsSimulating(false);
        }, 950);
    };

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedStates(prev => ({ ...prev, [id]: true }));
        if (copyTimersRef.current[id]) {
            clearTimeout(copyTimersRef.current[id]);
        }
        copyTimersRef.current[id] = setTimeout(() => {
            setCopiedStates(prev => ({ ...prev, [id]: false }));
        }, 2000);
    };

    const handleWaitlistSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!waitlistEmail) return;
        setIsSubmittingWaitlist(true);
        try {
            const res = await fetch(`${PROXY_URL}/api/waitlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: waitlistEmail,
                    name: waitlistName,
                    company: waitlistCompany
                })
            });
            if (!res.ok) {
                console.warn('Waitlist API returned status:', res.status);
            }
            setWaitlistSubmitted(true);
        } catch (err) {
            console.error('Waitlist submission failed:', err);
            setWaitlistSubmitted(true);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    };

    const handleScenarioKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % SIMULATOR_SCENARIOS.length;
            const nextScenario = SIMULATOR_SCENARIOS[nextIndex];
            setActiveScenarioId(nextScenario.id);
            handleRunSimulation();
            const nextTab = document.getElementById(`scenario-tab-${nextScenario.id}`);
            nextTab?.focus();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + SIMULATOR_SCENARIOS.length) % SIMULATOR_SCENARIOS.length;
            const prevScenario = SIMULATOR_SCENARIOS[prevIndex];
            setActiveScenarioId(prevScenario.id);
            handleRunSimulation();
            const prevTab = document.getElementById(`scenario-tab-${prevScenario.id}`);
            prevTab?.focus();
        }
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
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (simulationTimerRef.current) {
                clearTimeout(simulationTimerRef.current);
            }
            if (stageTimerRef.current) {
                clearTimeout(stageTimerRef.current);
            }
            Object.values(copyTimersRef.current).forEach(clearTimeout);
        };
    }, [fullscreenImageUrl, selectedFeature, showWaitlistModal]);

    return (
        <main className="landing-main">
            {/* AMBIENT FUTURISTIC CYBER BACKGROUND */}
            <div className="cyber-ambient-backdrop" aria-hidden="true">
                <img 
                    src="/assets/cyber_futuristic_bg.jpg" 
                    alt="" 
                    className="cyber-backdrop-image"
                    fetchPriority="high"
                    decoding="async"
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

            {/* TRUST & COMPLIANCE BAR */}
            <section className="trust-bar">
                <div className="trust-text">Built for Mission-Critical API Security &amp; Compliance</div>
                <div className="trust-logos">
                    <ScanCounter />
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                        <span>OWASP API Top 10</span>
                    </div>
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        <span>PCI-DSS 6.6 Audit Support</span>
                    </div>
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                        <span>Source-Available (BSL 1.1)</span>
                    </div>
                </div>
            </section>

            {/* LIVE FUZZING SIMULATOR PLAYGROUND */}
            <section id="simulator" className="simulator-section">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Interactive Attack Simulator</div>
                    <h2>Pick an Attack Vector. Watch Swazz Find It.</h2>
                    <p>Select a real-world scenario below to see how Swazz crafts semantic mutations from baseline schema contracts and exposes critical vulnerabilities in seconds.</p>
                </div>

                <div className="simulator-container">
                    {/* Scenario Tabs */}
                    <div className="simulator-scenario-bar" role="tablist" aria-label="Simulator Scenarios">
                        {SIMULATOR_SCENARIOS.map((scenario, idx) => (
                            <button
                                key={scenario.id}
                                id={`scenario-tab-${scenario.id}`}
                                role="tab"
                                aria-selected={activeScenarioId === scenario.id}
                                aria-controls={`scenario-panel-${scenario.id}`}
                                tabIndex={activeScenarioId === scenario.id ? 0 : -1}
                                className={`scenario-tab-btn ${activeScenarioId === scenario.id ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveScenarioId(scenario.id);
                                    handleRunSimulation();
                                }}
                                onKeyDown={(e) => handleScenarioKeyDown(e, idx)}
                            >
                                <span className={`severity-pill ${scenario.severity.toLowerCase()}`}>
                                    {scenario.severity}
                                </span>
                                <span className="scenario-tab-title">{scenario.name}</span>
                            </button>
                        ))}
                    </div>

                    {/* Simulator Console Box */}
                    <div 
                        id={`scenario-panel-${activeScenario.id}`}
                        role="tabpanel"
                        aria-labelledby={`scenario-tab-${activeScenario.id}`}
                        className={`simulator-console ${isSimulating ? 'simulating' : ''}`}
                    >
                        {/* 3-Step Process Flow Ribbon (Single Owner of 1-2-3 Numbering) */}
                        <div className="simulator-process-ribbon">
                            <div className={`process-step ${simulationStage >= 1 ? 'active' : ''} ${isSimulating && simulationStage === 1 ? 'stage-pulsing' : ''}`}>
                                <span className="step-num">1</span>
                                <span className="step-label">Baseline Contract</span>
                            </div>
                            <div className="process-arrow" aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                            </div>
                            <div className={`process-step ${simulationStage >= 2 ? 'active' : ''} ${isSimulating && simulationStage === 2 ? 'stage-pulsing' : ''}`}>
                                <span className="step-num">2</span>
                                <span className="step-label">Semantic Mutation</span>
                            </div>
                            <div className="process-arrow" aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                            </div>
                            <div className={`process-step ${simulationStage === 3 ? 'active step-result' : ''}`}>
                                <span className="step-num">3</span>
                                <span className="step-label">Vulnerability Caught</span>
                            </div>
                        </div>

                        {/* Top Console Bar with Authentic Scanning Loader */}
                        <div className="simulator-header-bar">
                            {isSimulating && (
                                <div className="simulator-scan-progress-bar" aria-hidden="true">
                                    <div className="scan-progress-glow" />
                                </div>
                            )}
                            <div className="simulator-endpoint-tag">
                                <div className="window-decor-dots" aria-hidden="true">
                                    <span className="window-dot red"></span>
                                    <span className="window-dot yellow"></span>
                                    <span className="window-dot green"></span>
                                </div>
                                <span className={`method-badge method-${activeScenario.method.toLowerCase()}`}>
                                    {activeScenario.method}
                                </span>
                                <span className="endpoint-path-text">{activeScenario.endpoint}</span>
                                <span className="simulator-cwe-badge">{activeScenario.owasp} • {activeScenario.cwe}</span>
                                <div className={`simulator-status-indicator ${isSimulating ? 'running' : 'ready'}`}>
                                    <span className={`status-dot ${isSimulating ? 'pulsing' : 'green'}`} />
                                    <span>
                                        {isSimulating 
                                            ? (simulationStage === 1 ? 'Validating contract...' : 'Fuzzing AST mutation...') 
                                            : 'Exploit Verified'}
                                    </span>
                                </div>
                            </div>
                            <div className="simulator-action-group">
                                <button 
                                    type="button" 
                                    className="btn-simulator-run"
                                    onClick={handleRunSimulation}
                                    disabled={isSimulating}
                                    aria-label="Replay attack simulation"
                                >
                                    {isSimulating ? (
                                        <>
                                            <span className="sim-spinner" aria-hidden="true" />
                                            <span>Fuzzing AST...</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <polyline points="1 4 1 10 7 10"></polyline>
                                                <polyline points="23 20 23 14 17 14"></polyline>
                                                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
                                            </svg>
                                            <span>Replay Attack</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Split Diff Playground */}
                        <div className="simulator-body-grid">
                            {/* Left: Original Request */}
                            <div className={`simulator-panel original-panel ${simulationStage === 1 ? 'stage-focused' : ''}`}>
                                <div className="panel-title">
                                    <span className="panel-title-step">Baseline Schema Contract</span>
                                    <span className="panel-status-indicator normal">Valid Request</span>
                                </div>
                                <div className="panel-code-box">
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
                                <div className="pane-context-note">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                    <span>{activeScenario.originalSpec.description}</span>
                                </div>
                            </div>

                            {/* Right: Swazz Mutated Payload */}
                            <div className={`simulator-panel mutated-panel ${simulationStage === 2 ? 'stage-focused' : ''} ${isSimulating ? 'simulating-panel' : ''}`}>
                                <div className="panel-title">
                                    <span className="panel-title-step">Swazz Attack Mutation</span>
                                    <span className="panel-status-indicator mutated">Payload Mutated</span>
                                </div>
                                <div className="panel-code-box">
                                    <div className="diff-highlight-line">
                                        <span className="diff-tag-marker">+ MUTATION</span>
                                        <span className="diff-text-content">{activeScenario.mutatedPayload.mutationDiff}</span>
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
                                <div className="pane-context-note exploit-note">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                                    <span>{activeScenario.exploitAction}</span>
                                </div>
                            </div>
                        </div>

                        {/* Result / Detection Telemetry */}
                        <div className={`simulator-result-footer ${simulationStage === 3 ? 'stage-focused-result' : ''}`}>
                            <div className="result-status-header">
                                <span className={`result-badge status-${String(activeScenario.detectionResult.status)[0]}xx`}>
                                    {activeScenario.detectionResult.statusText}
                                </span>
                                <strong className="result-finding-title">{activeScenario.detectionResult.findingTitle}</strong>
                            </div>
                            <p className="result-summary-text">{activeScenario.detectionResult.findingSummary}</p>
                            <div className="result-details-row">
                                <div className="result-impact-line">
                                    <span className="callout-icon impact-icon">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                                    </span>
                                    <div><strong>Real-World Impact:</strong> {activeScenario.impact}</div>
                                </div>
                                <div className="result-remediation-box">
                                    <span className="callout-icon fix-icon">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                                    </span>
                                    <div><strong className="remediation-label">Automated Fix:</strong> {activeScenario.detectionResult.remediationTip}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Simulator Action Call-to-Action */}
                    <div className="simulator-bottom-cta">
                        {onActionClick ? (
                            <button type="button" onClick={onActionClick} className="btn-landing-primary">
                                Run this scan against your API →
                            </button>
                        ) : (
                            <a href="#solutions" className="btn-landing-primary">
                                Try Swazz Free on Your API →
                            </a>
                        )}
                        <span className="simulator-cta-subtext">Free native CLI scanner • Zero telemetry transmission • 100% local AST execution</span>
                    </div>
                </div>
            </section>

            {/* DEMO VIDEO / SHOWCASE */}
            <section id="demo" className="landing-video-section">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Full Platform Tour</div>
                    <h2>From OpenAPI Spec to CI/CD Gate in 60 Seconds</h2>
                    <p>Watch how Swazz scans distributed endpoints, groups duplicate anomalies, and blocks security regressions in pull requests.</p>
                </div>
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
                        <video 
                            src="/swazz_demo.webm" 
                            poster="/screenshots/smart_fuzzing.png" 
                            preload="metadata" 
                            className="landing-video-element" 
                            controls 
                            autoPlay 
                            muted 
                            loop 
                            playsInline
                        ></video>
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
                                <th scope="col" className="col-legacy">Traditional DAST</th>
                                <th scope="col" className="col-generic">Generic Fuzzers</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="cap-title">
                                    <strong>Semantic Spec Awareness</strong>
                                    <span>Parses OpenAPI, SOAP &amp; GraphQL parameter constraints and types.</span>
                                </td>
                                <td className="val-swazz">
                                    <div className="val-cell">
                                        <svg className="val-svg check-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        <span className="val-text">Deep AST parsing &amp; smart mutation</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Blind string payloads (Zero schema context)</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg partial-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                        <span className="val-text">Shallow type fuzzing without logic awareness</span>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Zero-Setup HAR Replay</strong>
                                    <span>Replay real authenticated user journeys in 1 click.</span>
                                </td>
                                <td className="val-swazz">
                                    <div className="val-cell">
                                        <svg className="val-svg check-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        <span className="val-text">Instant drag-and-drop &amp; Chrome Extension</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Complex MITM proxy &amp; CA cert configuration</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Unsupported</span>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>OWASP API Top 10 Classification</strong>
                                    <span>Automatic mapping to BOLA, Broken Auth, and SSRF CWEs.</span>
                                </td>
                                <td className="val-swazz">
                                    <div className="val-cell">
                                        <svg className="val-svg check-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        <span className="val-text">Native 2023 classification + remediation</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg partial-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                        <span className="val-text">Generic web DAST (Misses API1–10 logic flaws)</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Raw HTTP 500 error logs only</span>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Response Deduplication (Anti-Fatigue)</strong>
                                    <span>Groups thousands of responses by structural root causes.</span>
                                </td>
                                <td className="val-swazz">
                                    <div className="val-cell">
                                        <svg className="val-svg check-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        <span className="val-text">Automatic clustering (Zero alert fatigue)</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Massive alert fatigue (No root-cause grouping)</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Unstructured raw stdout dumps</span>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Sub-Second Edge Execution &amp; CI/CD</strong>
                                    <span>Runs natively in GitHub Actions and Cloudflare Edge Workers.</span>
                                </td>
                                <td className="val-swazz">
                                    <div className="val-cell">
                                        <svg className="val-svg check-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        <span className="val-text">Blazing fast Go engine + Edge routing</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Heavy runtime overhead (10–30 min delays)</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg partial-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                        <span className="val-text">Single-threaded CLI execution</span>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td className="cap-title">
                                    <strong>Native SARIF Export</strong>
                                    <span>Surface security alerts directly in standard PR reviews and Jira.</span>
                                </td>
                                <td className="val-swazz">
                                    <div className="val-cell">
                                        <svg className="val-svg check-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        <span className="val-text">Standard SARIF for GitHub Code Scanning</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg partial-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                        <span className="val-text">Proprietary PDF/HTML exports</span>
                                    </div>
                                </td>
                                <td className="val-other">
                                    <div className="val-cell">
                                        <svg className="val-svg cross-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        <span className="val-text">Non-standard console logs</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="benchmark-disclaimer">
                    * Benchmark metrics based on controlled microservice test suites against OWASP vulnerable API benchmarks. Detailed fuzzing methodology and reproducible fixtures are documented in our repository.
                </div>
            </section>

            {/* BENTO GRID OF CORE PILLARS */}
            <section id="features" className="landing-features">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Enterprise Security Architecture</div>
                    <h2>Everything You Need to Ship Resilient APIs</h2>
                    <p>Designed from the ground up for modern AppSec and high-velocity DevSecOps engineering teams.</p>
                </div>

                <div className="landing-bento-grid">
                    <div className="bento-card bento-card-large" onClick={() => setSelectedFeature(FEATURE_DETAILS.fuzzing)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                            </svg>
                        </div>
                        <h3>Intelligent AST Fuzzing</h3>
                        <p>Parse OpenAPI, SOAP &amp; GraphQL schemas to uncover business logic zero-days and injection vulnerabilities with targeted mutations.</p>
                        <div className="bento-preview-tag">Click to inspect payload diffs →</div>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.extension)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                <line x1="8" y1="21" x2="16" y2="21"></line>
                                <line x1="12" y1="17" x2="12" y2="21"></line>
                            </svg>
                        </div>
                        <h3>Browser Extension</h3>
                        <p>Record authenticated traffic seamlessly as you browse and pipe requests directly into Swazz.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.har)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
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
                    <div className="bento-card bento-card-large" onClick={() => setSelectedFeature(FEATURE_DETAILS.grouping)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </div>
                        <h3>Response Deduplication</h3>
                        <p>Automatically cluster thousands of payloads into root causes to eliminate alert fatigue.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.integration)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                        </div>
                        <h3>SARIF &amp; Jira Exports</h3>
                        <p>Generate standard SARIF logs to surface security findings in GitHub PR reviews and Jira.</p>
                    </div>
                </div>
            </section>

            {/* QUICKSTART TERMINAL & DEPLOYMENT */}
            <section id="solutions" className="deployment-section">
                <div className="landing-section-header">
                    <div className="section-eyebrow">Zero Friction</div>
                    <h2>Deploy &amp; Run Anywhere</h2>
                    <p>Run locally via Go binary CLI, deploy inside Docker, or automate seamlessly in CI/CD pipelines.</p>
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
                                    <span>Install Native Go Scanner &amp; Run Instant Scan</span>
                                    <button 
                                        type="button"
                                        className="deploy-copy-btn" 
                                        onClick={() => handleCopy(`curl -sSfL https://raw.githubusercontent.com/SecH0us3/swazz/main/install.sh | sh && swazz scan --spec https://petstore.swagger.io/v2/swagger.json`, 'cli-start')}
                                    >
                                        {copiedStates['cli-start'] ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="code-terminal">
                                    <code>{`# Install Swazz native CLI engine and start instant scan against any OpenAPI URL
curl -sSfL https://raw.githubusercontent.com/SecH0us3/swazz/main/install.sh | sh
swazz scan --spec https://petstore.swagger.io/v2/swagger.json`}</code>
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
                        <p>Swazz is licensed under BSL 1.1 — Free for non-commercial use &amp; teams with under $1M revenue. Commercial Enterprise licenses available for large organizations.</p>
                    </div>

                    <div className="pricing-grid">
                        <div className="pricing-card">
                            <h3>Community Edition</h3>
                            <div className="price">Free <span>(BSL 1.1)</span></div>
                            <ul className="pricing-features">
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Unlimited Local &amp; CI/CD Binary Scans
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    OpenAPI, SOAP &amp; GraphQL AST Fuzzing
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    HAR File Replay &amp; Chrome Extension
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Standard SARIF Export (GitHub / GitLab)
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Free for Teams &amp; Revenue &lt; $1,000,000
                                </li>
                            </ul>
                            <button type="button" onClick={onActionClick} className="btn-pricing primary">
                                Get Started Free
                            </button>
                        </div>
                        
                        <div className="pricing-card featured">
                            <div className="pricing-badge">Commercial</div>
                            <h3>Commercial &amp; Enterprise</h3>
                            <div className="price">Custom <span>(For Scale)</span></div>
                            <ul className="pricing-features">
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Everything in Community
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Private Dedicated Cloud Runners
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Role-Based Access Control (RBAC) &amp; SSO
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    PCI-DSS 6.6 &amp; SOC2 Audit Support Reports
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Direct Security Engineering SLA &amp; Support
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
                            <h2>Swazz Enterprise Access</h2>
                            <p>Unlock custom BSL 1.1 commercial licensing, SAML SSO, RBAC, dedicated cloud runners, and custom compliance reports.</p>
                        </div>
                        {waitlistSubmitted ? (
                            <div className="waitlist-success">
                                <div className="success-icon">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                </div>
                                <h3>Request Received!</h3>
                                <p>Thank you{waitlistName ? `, ${waitlistName}` : ''}. We have registered your enterprise inquiry for <strong>{waitlistEmail}</strong>.</p>
                                <button type="button" className="btn-pricing primary" onClick={() => { setShowWaitlistModal(false); setWaitlistSubmitted(false); }}>
                                    Close
                                </button>
                            </div>
                        ) : (
                            <form className="waitlist-form" onSubmit={handleWaitlistSubmit}>
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
                                <button type="submit" className="btn-pricing primary" disabled={isSubmittingWaitlist}>
                                    {isSubmittingWaitlist ? 'Submitting Request...' : 'Submit Enterprise Access Request'}
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
