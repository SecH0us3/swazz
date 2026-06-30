import { useState, useEffect } from 'react';
import './Auth/LoginScreen.css';

export const FEATURE_DETAILS = {
    fuzzing: {
        title: "Smart Fuzzing & Mutation Diffs",
        details: "Swazz parses your OpenAPI/Swagger/SOAP/GraphQL specifications to understand parameters, types, and constraints. It then dynamically generates targeted fuzzing payloads and shows request mutation visual diffs highlighting the exact payload modifications.",
        goal: "Discover injection vulnerabilities, parser crashes, and edge-case exceptions by sending semantically valid but payload-corrupted requests.",
        benefit: "Discover bugs deep inside business logic that standard scanners (which get blocked by early input validation) completely miss.",
        image: "/screenshots/smart_fuzzing.png"
    },
    har: {
        title: "Zero-Setup HAR Replay",
        details: "Import HTTP Archive (HAR) files recorded from browser actions, Postman, or integration tests. Swazz instantly replays, mutates, and fuzzes the captured traffic.",
        goal: "Perform automated regression security testing or quickly audit custom endpoint flows without writing scripts.",
        benefit: "Zero configuration. Simply capture real-world traffic by interacting with your application, upload the HAR file, and run scans immediately.",
        image: "/screenshots/har_replay.png"
    },
    pipelines: {
        title: "CI/CD & Real-Time Metrics",
        details: "Run Swazz scans natively in GitHub Actions, GitLab CI, or any container environment. Stream real-time fuzzer metrics, status codes, and request mutation rates directly to your dashboard.",
        goal: "Automate security tests on every commit, pull request, or release build with real-time performance observability.",
        benefit: "Catch vulnerabilities early in the development lifecycle and monitor fuzzer throughput instantly.",
        image: "/screenshots/audit_pipelines.png"
    },
    compliance: {
        title: "OWASP Top 10 Mapping",
        details: "Every discovered crash, anomaly, or security issue is automatically mapped to the OWASP Top 10 API Security Risks (such as BOLA, Broken Auth, or Rate Limiting) and industry-standard Common Weakness Enumeration (CWE) patterns.",
        goal: "Generate compliant audit evidence and prioritize vulnerabilities based on standardized security classifications.",
        benefit: "Developers can resolve issues faster by directly viewing remediation links, tutorials, and vulnerability context maps.",
        image: "/screenshots/compliance_mapping.png"
    },
    integration: {
        title: "Seamless Integration (SARIF)",
        details: "Exports standard SARIF (Static Analysis Results Interchange Format) logs. These are natively parsed by GitHub Code Scanning, GitLab Security Hub, Jira, and other vulnerability systems.",
        goal: "Integrate scan results into existing issue trackers, developers' dashboards, and security visualization tools.",
        benefit: "Security teams can monitor vulnerabilities without teaching developers new platforms; alerts surface directly in standard PR reviews.",
        image: "/screenshots/sarif_integration.png"
    },
    grouping: {
        title: "Response Grouping",
        details: "Automatically groups scan responses by structural similarity, headers, status codes, and failure characteristics.",
        goal: "Reduce finding fatigue by deduplicating thousands of fuzzing payloads into a few distinct root causes.",
        benefit: "Triage scans in minutes instead of wading through endless repetitive alerts.",
        image: "/screenshots/response_grouping.png"
    },
    multispec: {
        title: "OpenAPI, Swagger, GraphQL & SOAP",
        details: "Full native support for parsing OpenAPI v2/v3, Swagger, GraphQL schemas, Postman collections, and SOAP WSDL specifications.",
        goal: "Automatically explore and fuzz all query parameters, mutations, SOAP actions, and deep request endpoints.",
        benefit: "No manual endpoint mapping. Drop in any standard API definition format (JSON, YAML, WSDL, GraphQL) and start scanning instantly.",
        image: "/screenshots/openapi_graphql.png"
    },
    privaterunners: {
        title: "Private Runners (Ed25519 Auth)",
        details: "Run scanning agents inside your secure VPC or private network. Runners use secure Ed25519 public-key signatures for coordinator authentication. Only metadata is sent back to the coordinator.",
        goal: "Scan internal pre-production environments without opening firewall ports or exposing private APIs.",
        benefit: "Strict security boundaries. Your target application traffic never leaves your trusted network.",
        image: "/screenshots/private_runners.png"
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
    const [activeTab, setActiveTab] = useState<'cloud' | 'docker' | 'worker'>('cloud');

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
        <main className="landing-main" style={{ width: '100%', overflowY: 'auto' }}>
            <section className="landing-hero">
                <h1 className="landing-hero-title">Smart API Fuzzing <span className="text-nowrap">for Modern Security</span></h1>
                <p className="landing-hero-subtitle">
                    Supercharge your API security with intelligent, high-performance fuzzing for developers and researchers. Swazz is a Modern, User-Friendly DAST
                </p>
                {actionText && onActionClick && (
                    <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
                        <button type="button" onClick={onActionClick} className="btn-cloud-cta" style={{ fontSize: '1.2rem', padding: '12px 32px' }}>
                            {actionText}
                        </button>
                    </div>
                )}
            </section>

            <section id="demo" className="landing-video-section">
                <div className="landing-video-frame">
                    <div className="video-frame-header">
                        <div className="video-frame-dots">
                            <span className="dot dot-red"></span>
                            <span className="dot dot-yellow"></span>
                            <span className="dot dot-green"></span>
                        </div>
                        <div className="video-frame-address">https://swazz.secmy.app/</div>
                    </div>
                    <div className="video-frame-content">
                        <video src="/swazz_demo.webm" className="landing-video-element" controls autoPlay muted loop playsInline></video>
                    </div>
                </div>
            </section>

            <section id="features" className="landing-features">
                <h2 className="landing-section-title">Key Features</h2>
                <div className="landing-bento-grid">
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.fuzzing)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                                <polyline points="2 17 12 22 22 17"></polyline>
                                <polyline points="2 12 12 17 22 12"></polyline>
                            </svg>
                        </div>
                        <h3>Smart Fuzzing & Mutation Diffs</h3>
                        <p>Context-aware payload generation and visual diffs of request mutations.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.har)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </div>
                        <h3>Zero-Setup HAR</h3>
                        <p>Instant HAR replay without manual configuration.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.pipelines)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            </svg>
                        </div>
                        <h3>CI/CD & Real-Time Metrics</h3>
                        <p>Stream live metrics and integrate security audits into CI/CD pipelines.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.compliance)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                        </div>
                        <h3>OWASP Top 10 Mapping</h3>
                        <p>Map vulnerabilities to OWASP API Security Top 10 risks and CWEs.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.grouping)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </div>
                        <h3>Response Grouping</h3>
                        <p>Structural clustering of errors to prevent duplicate alerts.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.multispec)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                            </svg>
                        </div>
                        <h3>OpenAPI, Swagger, GraphQL & SOAP</h3>
                        <p>Native parsing for all Swagger, Postman, WSDL, and GraphQL specs.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.integration)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                        </div>
                        <h3>Seamless Integration</h3>
                        <p>Generate SARIF reports for easy integration into existing security ecosystems like GitHub, GitLab, or Jira.</p>
                    </div>
                    <div className="bento-card" onClick={() => setSelectedFeature(FEATURE_DETAILS.privaterunners)}>
                        <div className="bento-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                                <line x1="6" y1="18" x2="6.01" y2="18"></line>
                            </svg>
                        </div>
                        <h3>Private Runners (Ed25519 Auth)</h3>
                        <p>Secure Ed25519-authenticated agents to scan private APIs safely.</p>
                    </div>
                </div>
            </section>

            <section id="solutions" className="landing-how-it-works">
                <h2 className="landing-section-title">How it Works</h2>
                <div className="code-switcher-container">
                    <div className="code-switcher-tabs">
                        <button 
                            type="button" 
                            className={`tab-btn ${activeTab === 'cloud' ? 'active' : ''}`}
                            onClick={() => setActiveTab('cloud')}
                        >
                            Cloud (Hosted)
                        </button>
                        <button 
                            type="button" 
                            className={`tab-btn ${activeTab === 'docker' ? 'active' : ''}`}
                            onClick={() => setActiveTab('docker')}
                        >
                            Docker & local
                        </button>
                        <button 
                            type="button" 
                            className={`tab-btn ${activeTab === 'worker' ? 'active' : ''}`}
                            onClick={() => setActiveTab('worker')}
                        >
                            Cloudflare worker
                        </button>
                    </div>
                    <div className="code-switcher-content">
                        {activeTab === 'cloud' && (
                            <div className="code-block-wrapper">
                                <div className="code-header">Hosted Fuzzing Cloud</div>
                                <div className="cloud-hosted-info">
                                    <p>No installation required. Run fuzzing scans instantly using our secure, hosted cloud infrastructure. Just sign up and start fuzzing for free.</p>
                                    <ul className="cloud-hosted-features">
                                        <li>⚡ Zero-setup configuration</li>
                                        <li>🔒 Secure edge routing</li>
                                        <li>🆓 Free registration with community runner pools</li>
                                    </ul>
                                </div>
                            </div>
                        )}
                        {activeTab === 'docker' && (
                            <div className="code-block-wrapper">
                                <div className="code-header">Docker Coordinator & local running</div>
                                <pre className="code-terminal">
                                    <code>{`docker pull sech0us3/swazz-coordinator\ndocker run -p 8787:8787 -e JWT_SECRET="your-secret" sech0us3/swazz-coordinator`}</code>
                                </pre>
                                <div className="code-header code-header-spaced">SARIF Export Output Example</div>
                                <pre className="code-terminal">
                                    <code>{`{\n  "version": "2.1.0",\n  "runs": [\n    {\n      "tool": {\n        "driver": {\n          "name": "swazz",\n          "rules": [\n            {\n              "id": "swazz/sql-error-leak",\n              "shortDescription": { "text": "Database error signature leaked in the response body" }\n            }\n          ]\n        }\n      },\n      "results": [\n        {\n          "ruleId": "swazz/sql-error-leak",\n          "level": "error",\n          "message": { "text": "Database error signature (MySQL) leaked in the response body." },\n          "locations": [\n            {\n              "physicalLocation": { "artifactLocation": { "uri": "/users" } },\n              "logicalLocations": [ { "name": "GET", "kind": "function" } ]\n            }\n          ]\n        }\n      ]\n    }\n  ]\n}`}</code>
                                </pre>
                            </div>
                        )}
                        {activeTab === 'worker' && (
                            <div className="code-block-wrapper">
                                <div className="code-header">Custom Cloudflare Worker Coordinator</div>
                                <pre className="code-terminal">
                                    <code>{`export default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    // Route Swazz API requests to coordinator via Service Binding\n    if (url.pathname.startsWith("/api/swazz")) {\n      return await env.SWAZZ_COORDINATOR.fetch(request);\n    }\n    // Pass through all other normal web/app requests\n    return await fetch(request);\n  }\n}`}</code>
                                </pre>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {showPricing && (
                <section id="pricing" className="landing-pricing-section">
                    <h2 className="landing-section-title">Empowering the Community</h2>

                    <div className="pricing-cards-grid">
                        <div className="pricing-card card-neon-border">
                            <h3>Community Plan</h3>
                            <div className="price-tag">Free</div>
                            <ul className="pricing-features-list">
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Shared Runners
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Standard Fuzzing
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Open Source Access
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Private Runners
                                </li>
                            </ul>
                            <button type="button" onClick={onActionClick} className="btn-pricing-secondary">
                                Get Started
                            </button>
                        </div>

                        <div className="pricing-card card-neon-border">
                            <h3>Supporter Plan</h3>
                            <div className="price-tag">Support Us</div>
                            <ul className="pricing-features-list">
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Everything in Free
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Priority Runner Queue
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Advanced Payload Generation
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Help fund infrastructure
                                </li>
                            </ul>
                            <button type="button" onClick={onActionClick} className="btn-pricing-primary">
                                Support Us
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* Feature Detail Modal */}
            {selectedFeature && (
                <div className="feature-modal-backdrop" onClick={() => setSelectedFeature(null)}>
                    <div className="feature-modal feature-modal-split" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="auth-modal-close" onClick={() => setSelectedFeature(null)} aria-label="Close modal">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                        <div className="feature-modal-left">
                            <h3>{selectedFeature.title}</h3>
                            <div className="feature-modal-body">
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
                        </div>
                        <div className="feature-modal-right">
                            {selectedFeature.image && (
                                <div className="feature-modal-screenshot-wrapper">
                                    <img 
                                        src={selectedFeature.image} 
                                        alt={selectedFeature.title} 
                                        className="feature-modal-screenshot clickable-screenshot" 
                                        onClick={() => setFullscreenImageUrl(selectedFeature.image || null)}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Fullscreen Image Zoom Overlay */}
            {fullscreenImageUrl && (
                <div className="fullscreen-image-backdrop" onClick={() => setFullscreenImageUrl(null)}>
                    <div className="fullscreen-image-container" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="auth-modal-close" onClick={() => setFullscreenImageUrl(null)} aria-label="Close fullscreen view">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
