import { useState, useEffect } from 'react';
import './LandingShowcase.css';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

function ScanCounter() {
    const [count, setCount] = useState<number | null>(null);
    const [displayCount, setDisplayCount] = useState<number>(0);

    useEffect(() => {
        try {
            const fetchUrl = new URL('/api/telemetry/scans/count', PROXY_URL || window.location.origin).toString();
            fetch(fetchUrl)
                .then(res => res.json())
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
        } catch (e) {
            console.error('Failed to construct URL:', e);
            setCount(1000000);
        }
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
        return <>1M+ Scans</>;
    }

    return <>{displayCount.toLocaleString()}+ Scans</>;
}

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
    const [activeDeploymentTab, setActiveDeploymentTab] = useState<'cloud'|'docker'|'local'|'worker'>('cloud');
    const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

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
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fullscreenImageUrl, selectedFeature]);

    return (
        <main className="landing-main">
            {/* HERO SECTION */}
            <section className="landing-hero">
                <h1 className="landing-hero-title">Break Your APIs Before Hackers Do</h1>
                <p className="landing-hero-subtitle">
                    Automatically generate intelligent fuzzing payloads from your OpenAPI specs to uncover hidden logic flaws and injection vulnerabilities that standard scanners miss.
                </p>
                <div className="landing-hero-ctas">
                    {onActionClick && (
                        <button type="button" onClick={onActionClick} className="btn-landing-primary">
                            Run a live demo scan
                        </button>
                    )}
                    <a href="https://sech0us3.github.io/swazz/" target="_blank" rel="noopener noreferrer" className="btn-landing-secondary">
                         Read the docs
                    </a>
                </div>
            </section>

            {/* TRUST BAR (SOCIAL PROOF) */}
            <section className="trust-bar">
                <div className="trust-text">Trusted by modern security teams</div>
                <div className="trust-logos">
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                        </svg>
                        <ScanCounter />
                    </div>
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                        OWASP Compliant
                    </div>
                    <div className="trust-logo-item">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        SOC 2 Type II
                    </div>
                </div>
            </section>

            {/* DEMO VIDEO / CRYSTALLINE SHIELD */}
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

            {/* BENTO GRID */}
            <section id="features" className="landing-features">
                <h2 className="landing-section-title">Everything You Need to Ship Secure APIs</h2>
                <div className="landing-bento-grid">
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.fuzzing)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                                <polyline points="2 17 12 22 22 17"></polyline>
                                <polyline points="2 12 12 17 22 12"></polyline>
                            </svg>
                        </div>
                        <h3>Smart Fuzzing</h3>
                        <p>Context-aware payload generation mapping exactly to your API constraints and types.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.har)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </div>
                        <h3>Zero-Setup HAR</h3>
                        <p>Instantly replay and mutate traffic from browser recordings without configuration.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.pipelines)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            </svg>
                        </div>
                        <h3>CI/CD Integration</h3>
                        <p>Native pipelines for GitHub Actions and GitLab with real-time performance telemetry.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.compliance)}>
                        <div className="bento-icon-wrapper">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                        </div>
                        <h3>SARIF Exports</h3>
                        <p>Generate standard SARIF logs to integrate with GitHub Code Scanning and Jira.</p>
                    </div>
                </div>
            </section>

            {/* Frictionless Deployment (Solutions) */}
            <section id="solutions" className="deployment-section">
                <div className="landing-section-header">
                    <h2>Frictionless Deployment</h2>
                    <p>Deploy anywhere. From zero-setup cloud to secure on-premise execution.</p>
                </div>
                
                <div className="deployment-container">
                    <div className="deployment-tabs">
                        <button 
                            type="button" 
                            className={`deploy-tab-btn ${activeDeploymentTab === 'cloud' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('cloud')}
                        >
                            Cloud (Hosted)
                        </button>
                        <button 
                            type="button" 
                            className={`deploy-tab-btn ${activeDeploymentTab === 'docker' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('docker')}
                        >
                            Docker (Compose & CLI)
                        </button>
                        <button 
                            type="button" 
                            className={`deploy-tab-btn ${activeDeploymentTab === 'local' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('local')}
                        >
                            Local (No Docker)
                        </button>
                        <button 
                            type="button" 
                            className={`deploy-tab-btn ${activeDeploymentTab === 'worker' ? 'active' : ''}`}
                            onClick={() => setActiveDeploymentTab('worker')}
                        >
                            Cloudflare Worker
                        </button>
                    </div>
                    <div className="deployment-content">
                        {activeDeploymentTab === 'cloud' && (
                            <div>
                                <p className="deploy-marketing-text">No installation required. Run fuzzing scans instantly using our secure, hosted cloud infrastructure.</p>
                                <ul className="deploy-features">
                                    <li>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        Zero-setup configuration
                                    </li>
                                    <li>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        Secure edge routing
                                    </li>
                                    <li>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        Free registration with community runner pools
                                    </li>
                                </ul>
                            </div>
                        )}
                        {activeDeploymentTab === 'docker' && (
                            <div className="deployment-code-wrapper">
                                <div className="code-header">Option A: Run Standalone Scanner (CLI)
                                    <button 
                                        className="deploy-copy-btn" 
                                        onClick={() => handleCopy(`docker pull ghcr.io/sech0us3/swazz-cli:latest\ndocker run --rm -it -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:latest --config /app/swazz.config.json`, 'docker-cli')}
                                    >
                                        {copiedStates['docker-cli'] ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="code-terminal">
                                    <code>{`docker pull ghcr.io/sech0us3/swazz-cli:latest\ndocker run --rm -it -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:latest --config /app/swazz.config.json`}</code>
                                </pre>

                                <div className="code-header code-header-spaced">Option B: Run Full Local Stack (Compose)
                                    <button 
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
                                <div className="code-header">Run the Full Stack Locally (Without Docker)
                                    <button 
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
                                <div className="code-header">Bind to your own Cloudflare account
                                    <button 
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
                        <h2>Transparent Security Pricing</h2>
                        <p>Start with our robust open-source engine for free. Scale to enterprise cloud when your team grows.</p>
                    </div>

                    <div className="pricing-grid">
                        <div className="pricing-card">
                            <h3>Community Edition</h3>
                            <div className="price">Free</div>
                            <ul className="pricing-features">
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Shared Runners
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Standard Fuzzing Rules
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Open Source Access
                                </li>
                            </ul>
                            <button type="button" onClick={onActionClick} className="btn-pricing primary">
                                Get Started
                            </button>
                        </div>
                        
                        <div className="pricing-card featured">
                            <div className="pricing-badge">Recommended</div>
                            <h3>Enterprise Cloud</h3>
                            <div className="price">Custom</div>
                            <ul className="pricing-features">
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Private Dedicated Runners
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Custom Auth Injections (SAML/OAuth)
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Priority Email Support
                                </li>
                                <li>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    Advanced CI/CD SARIF Exports
                                </li>
                            </ul>
                            <button type="button" onClick={onActionClick} className="btn-pricing secondary">
                                Contact Sales
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* FOOTER */}
            <footer className="landing-footer">
                <div className="footer-logo">
                    <div className="logo-icon-container">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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

            {/* Fullscreen Image Zoom Overlay */}
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
