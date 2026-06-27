import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import './LoginScreen.css';

interface LoginScreenProps {
    onLogin: (username: string, password: string, twoFactorCode?: string) => Promise<{ twoFactorRequired?: boolean } | void>;
    onRegister: (username: string, password: string, email?: string) => Promise<void>;
    onGuest?: () => Promise<void>;
}

const FEATURE_DETAILS = {
    fuzzing: {
        title: "Smart Fuzzing",
        details: "Swazz parses your OpenAPI/Swagger specification or sniffed traffic to understand parameters, types, and constraints. It then dynamically generates targeted fuzzing payloads.",
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
        title: "CI/CD Audit Pipelines",
        details: "Run Swazz scans natively in GitHub Actions, GitLab CI, or any container runner environment. Block insecure code before it hits production.",
        goal: "Automate security tests on every commit, pull request, or release build to enforce compliance rules.",
        benefit: "Catch vulnerabilities early in the development lifecycle when they are cheapest to fix, ensuring continuous security defaults.",
        image: "/screenshots/audit_pipelines.png"
    },
    compliance: {
        title: "Compliance Mapping",
        details: "Every discovered crash, anomaly, or security issue is automatically mapped to the OWASP Top 10 API Security Risks and industry-standard Common Weakness Enumeration (CWE) patterns.",
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
        title: "OpenAPI & GraphQL",
        details: "Full native support for parsing OpenAPI v2/v3 specs, Postman collections, and interactive GraphQL schemas.",
        goal: "Automatically explore all query parameters, mutations, and deep request endpoints.",
        benefit: "No manual endpoint mapping. Drop in any standard API definition format and start scanning instantly.",
        image: "/screenshots/openapi_graphql.png"
    },
    privaterunners: {
        title: "Private Runners",
        details: "Run scanning agents inside your secure VPC or private network. Only metadata is sent back to the coordinator.",
        goal: "Scan internal pre-production environments without opening firewall ports or exposing private APIs.",
        benefit: "Strict security boundaries. Your target application traffic never leaves your trusted network.",
        image: "/screenshots/private_runners.png"
    }
};

export function LoginScreen({ onLogin, onRegister, onGuest }: LoginScreenProps) {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');
    const [isMagicLinkMode, setIsMagicLinkMode] = useState(false);
    const [magicLinkSent, setMagicLinkSent] = useState(false);
    const [magicLinkUrl, setMagicLinkUrl] = useState('');
    const { requestMagicLink } = useAuth();
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [twoFactorRequired, setTwoFactorRequired] = useState(false);
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [activeTab, setActiveTab] = useState<'cloud' | 'docker' | 'worker'>('cloud');
    const [selectedFeature, setSelectedFeature] = useState<{ title: string; details: string; goal: string; benefit: string; image?: string } | null>(null);
    const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(() => {
        // Auto-open modal for E2E tests to keep them compatible
        return typeof window !== 'undefined' && (window.navigator?.webdriver || window.location.search.includes('e2e'));
    });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (fullscreenImageUrl) {
                    setFullscreenImageUrl(null);
                } else if (selectedFeature) {
                    setSelectedFeature(null);
                } else {
                    closeAuthModal();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fullscreenImageUrl, selectedFeature]);

    const calculatePasswordStrength = (pwd: string) => {
        let score = 0;
        const feedback: string[] = [];
        if (pwd.length >= 8) {
            score++;
        } else {
            feedback.push('At least 8 characters');
        }
        if (/[A-Z]/.test(pwd)) {
            score++;
        } else {
            feedback.push('One uppercase letter');
        }
        if (/[a-z]/.test(pwd)) {
            score++;
        } else {
            feedback.push('One lowercase letter');
        }
        if (/[0-9]/.test(pwd)) {
            score++;
        } else {
            feedback.push('One number');
        }
        if (/[^A-Za-z0-9]/.test(pwd)) {
            score++;
        } else {
            feedback.push('One special character');
        }
        const finalScore = Math.max(0, Math.min(4, score - (pwd.length >= 8 ? 0 : 1)));
        return { score: finalScore, feedback };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            if (isMagicLinkMode) {
                const res = await requestMagicLink(username);
                setMagicLinkSent(true);
                if (res.magic_link) {
                    setMagicLinkUrl(res.magic_link);
                }
            } else if (isRegistering) {
                const { score } = calculatePasswordStrength(password);
                if (score < 4) {
                    throw new Error('Please choose a stronger password matching all complexity requirements.');
                }
                await onRegister(username, password, email || undefined);
            } else {
                const res = await onLogin(username, password, twoFactorRequired ? twoFactorCode : undefined);
                if (res && res.twoFactorRequired) {
                    setTwoFactorRequired(true);
                    setTwoFactorCode('');
                }
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegisterClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        const form = (e.currentTarget as HTMLElement).closest('form');
        if (form && !form.reportValidity()) {
            return;
        }
        setError('');
        setIsRegistering(true);
        setIsLoading(true);
        try {
            const { score } = calculatePasswordStrength(password);
            if (score < 4) {
                throw new Error('Please choose a stronger password matching all complexity requirements.');
            }
            await onRegister(username, password, email || undefined);
        } catch (err: any) {
            setError(err.message);
            setIsRegistering(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGuestClick = async () => {
        if (!onGuest) return;
        setError('');
        setIsLoading(true);
        try {
            await onGuest();
        } catch (err: any) {
            setError(err.message || 'Failed to enter as guest');
        } finally {
            setIsLoading(false);
        }
    };

    const openAuthModal = (registerMode: boolean) => {
        setIsRegistering(registerMode);
        setError('');
        setShowModal(true);
    };

    const closeAuthModal = () => {
        if (isLoading) return;
        setShowModal(false);
        setTwoFactorRequired(false);
        setError('');
    };

    return (
        <div className="landing-page-container">
            {/* Nav Bar */}
            <header className="landing-nav">
                <div className="landing-nav-left">
                    <div className="landing-logo">
                        <div className="logo-icon-container">
                            <svg className="landing-logo-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                        </div>
                        <span className="landing-logo-text">Swazz</span>
                    </div>
                    <nav className="landing-nav-links">
                        <a href="#features" className="nav-link">Features</a>
                        <a href="#solutions" className="nav-link">Solutions</a>
                        <a href="https://sech0us3.github.io/swazz/" className="nav-link" target="_blank" rel="noopener noreferrer">Docs</a>
                        <a href="https://yoursec.substack.com/" className="nav-link" target="_blank" rel="noopener noreferrer">Blog</a>
                        <a href="https://github.com/SecH0us3/swazz" className="nav-link" target="_blank" rel="noopener noreferrer">GitHub</a>
                        <a href="#pricing" className="nav-link">Pricing</a>
                    </nav>
                </div>
                <div className="landing-nav-right">
                    <button type="button" onClick={() => openAuthModal(false)} className="btn-nav-accent">
                        Let's go
                    </button>
                </div>
            </header>

            <main className="landing-main">
                {/* Hero Section */}
                <section className="landing-hero">
                    <h1 className="landing-hero-title">Smart API Fuzzing <span className="text-nowrap">for Modern Security</span></h1>
                    <p className="landing-hero-subtitle">
                        Supercharge your API security with intelligent, high-performance fuzzing for developers and researchers. Swazz is a Modern, User-Friendly DAST
                    </p>
                </section>

                {/* Walkthrough Video Section */}
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

                {/* Key Features Section */}
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
                            <h3>Smart Fuzzing</h3>
                            <p>Context-aware payload generation based on API schemas.</p>
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
                            <h3>Audit Pipelines</h3>
                            <p>Seamless integration into CI/CD for continuous security.</p>
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
                            <h3>Compliance Mapping</h3>
                            <p>Map vulnerabilities to OWASP and industry standards.</p>
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
                            <h3>OpenAPI & GraphQL</h3>
                            <p>Native parsing for all Swagger, Postman, and GraphQL specs.</p>
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
                            <h3>Private Runners</h3>
                            <p>Scan internal environments safely by deploying runner agents inside your own secure network infrastructure.</p>
                        </div>
                    </div>
                </section>

                {/* How it Works Section */}
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
                                        <div className="cloud-cta-container">
                                            <button type="button" onClick={() => openAuthModal(true)} className="btn-cloud-cta">
                                                Register Free
                                            </button>
                                        </div>
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

                {/* Pricing & Sponsorship Section */}
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
                            <button type="button" onClick={() => openAuthModal(true)} className="btn-pricing-secondary">
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
                                    Sponsor on GitHub
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Priority Feature Requests
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Direct Support
                                </li>
                                <li>
                                    <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Early Access to Updates
                                </li>
                            </ul>
                            <a href="https://github.com/sponsors/SecH0us3" target="_blank" rel="noopener noreferrer" className="btn-pricing-primary">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                                </svg>
                                Sponsor on GitHub
                            </a>
                        </div>
                    </div>
                </section>
            </main>



            {/* Auth Modal Popup Overlay */}
            {showModal && (
                <div 
                    className="auth-modal-backdrop" 
                    onClick={closeAuthModal}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            closeAuthModal();
                        }
                    }}
                >
                    <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="auth-modal-close" onClick={closeAuthModal} aria-label="Close modal">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                        
                        {twoFactorRequired ? (
                            <>
                                <div className="login-header">
                                    <h2>Two-Factor Verification</h2>
                                    <p>Enter the 6-digit verification code from your authenticator app to access your account.</p>
                                </div>
                                {error && (
                                    <div className="login-error">
                                        <div className="error-content">
                                            <span className="error-text">{error}</span>
                                        </div>
                                    </div>
                                )}
                                <form className="login-form" onSubmit={handleSubmit}>
                                    <div className="form-group">
                                        <label htmlFor="twoFactorCode">Verification Code</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            id="twoFactorCode"
                                            name="twoFactorCode"
                                            value={twoFactorCode}
                                            onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                                            placeholder="000000"
                                            autoComplete="one-time-code"
                                            required
                                            pattern="^\d{6}$"
                                            title="6-digit verification code"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="login-actions">
                                        <button type="submit" disabled={isLoading} className="login-btn">
                                            {isLoading ? <span className="spinner"></span> : 'Verify'}
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => {
                                                setTwoFactorRequired(false);
                                                setError('');
                                            }} 
                                            className="register-btn"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            </>
                        ) : (
                            <>
                                <div className="login-header">
                                    <h2>{isRegistering ? 'Create Account' : (isMagicLinkMode ? 'Passwordless Login' : 'Welcome to Swazz')}</h2>
                                    {!isRegistering && !isMagicLinkMode ? (
                                        <p className="login-subtitle">
                                            Enter your credentials to access your workspace. <br />
                                            New user? Click <strong>Create</strong> to sign up.
                                        </p>
                                    ) : isMagicLinkMode ? (
                                        <p>Enter your username to request a magic login link.</p>
                                    ) : (
                                        <p>Register to start fuzzing</p>
                                    )}
                                </div>

                                {!isRegistering && (
                                    <div className="auth-tabs">
                                        <button 
                                            type="button" 
                                            onClick={() => { setIsMagicLinkMode(false); setError(''); setMagicLinkSent(false); }}
                                            className={`auth-tab-btn ${!isMagicLinkMode ? 'active' : ''}`}
                                        >
                                            Password
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => { setIsMagicLinkMode(true); setError(''); setMagicLinkSent(false); }}
                                            className={`auth-tab-btn ${isMagicLinkMode ? 'active' : ''}`}
                                        >
                                            Magic Link
                                        </button>
                                    </div>
                                )}

                                {error && (
                                    <div className="login-error">
                                        <div className="error-content">
                                            <span className="error-text">{error}</span>
                                            {error === 'Invalid credentials' && (
                                                <div className="login-error-tip">
                                                    New user? Click <strong>Create</strong> to sign up.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {isMagicLinkMode && magicLinkSent ? (
                                    <div className="magic-link-success">
                                        <div className="magic-link-icon-container">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        </div>
                                        <h3>Magic Link Sent</h3>
                                        <p>If username <strong>{username}</strong> exists, a magic link has been generated.</p>
                                        
                                        {magicLinkUrl && (
                                            <div className="magic-link-test-container">
                                                <div className="magic-link-test-title">Developer Mode URL:</div>
                                                <a href={magicLinkUrl} className="magic-link-test-url">
                                                    {magicLinkUrl}
                                                </a>
                                            </div>
                                        )}
                                        
                                        <button 
                                            type="button" 
                                            onClick={() => {
                                                setMagicLinkSent(false);
                                                setMagicLinkUrl('');
                                                setIsMagicLinkMode(false);
                                            }} 
                                            className="register-btn"
                                        >
                                            Back to Login
                                        </button>
                                    </div>
                                ) : (
                                    <form className="login-form" onSubmit={handleSubmit}>
                                        <div className="form-group">
                                            <label htmlFor="username">Username</label>
                                            <input
                                                key={isRegistering ? "signup-username" : "signin-username"}
                                                type="text"
                                                id="username"
                                                name="username"
                                                value={username}
                                                onChange={(e) => setUsername(e.target.value)}
                                                placeholder="Enter username"
                                                autoComplete="username"
                                                required
                                                pattern="^[a-zA-Z0-9_\-]{3,20}$"
                                                title="3 to 20 characters, alphanumeric, including hyphen or underscore"
                                                autoFocus
                                            />
                                            <span id="username-hint" className="field-hint">3-20 characters (letters, numbers, _ or -)</span>
                                        </div>

                                        {isRegistering && (
                                            <div className="form-group">
                                                <label htmlFor="email">Email Address (Optional)</label>
                                                <input
                                                    type="email"
                                                    id="email"
                                                    name="email"
                                                    value={email}
                                                    onChange={(e) => setEmail(e.target.value)}
                                                    placeholder="you@example.com"
                                                    autoComplete="email"
                                                />
                                            </div>
                                        )}

                                        {!isMagicLinkMode && (
                                            <div className="form-group">
                                                <label htmlFor="password">Password</label>
                                                <div className="password-input-wrapper">
                                                    <input
                                                        key={isRegistering ? "signup-password" : "signin-password"}
                                                        type={showPassword ? "text" : "password"}
                                                        id="password"
                                                        name="password"
                                                        value={password}
                                                        onChange={(e) => setPassword(e.target.value)}
                                                        placeholder="••••••••"
                                                        autoComplete={isRegistering ? "new-password" : "current-password"}
                                                        required
                                                        minLength={8}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="password-toggle-btn"
                                                        onClick={() => setShowPassword(!showPassword)}
                                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                                    >
                                                        {showPassword ? (
                                                            <svg className="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                                                <line x1="1" y1="1" x2="23" y2="23"></line>
                                                            </svg>
                                                        ) : (
                                                            <svg className="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                                <circle cx="12" cy="12" r="3"></circle>
                                                            </svg>
                                                        )}
                                                    </button>
                                                </div>
                                                {isRegistering && (
                                                    <div className="password-strength-container">
                                                        <div className="password-strength-row">
                                                            <span className="password-strength-label">Strength:</span>
                                                            <span className={`password-strength-value strength-${calculatePasswordStrength(password).score}`}>
                                                                {['Weak', 'Fair', 'Good', 'Strong', 'Excellent'][calculatePasswordStrength(password).score]}
                                                            </span>
                                                        </div>
                                                        <div className="password-strength-bar">
                                                            <div className={`password-strength-fill strength-${calculatePasswordStrength(password).score}`}></div>
                                                        </div>
                                                        <ul className="password-requirements">
                                                            <li className={`password-req-item ${password.length >= 8 ? 'met' : ''}`}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    {password.length >= 8 ? (
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    ) : (
                                                                        <>
                                                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                        </>
                                                                    )}
                                                                </svg>
                                                                At least 8 characters
                                                            </li>
                                                            <li className={`password-req-item ${/[A-Z]/.test(password) ? 'met' : ''}`}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    {/[A-Z]/.test(password) ? (
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    ) : (
                                                                        <>
                                                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                        </>
                                                                    )}
                                                                </svg>
                                                                One uppercase letter
                                                            </li>
                                                            <li className={`password-req-item ${/[a-z]/.test(password) ? 'met' : ''}`}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    {/[a-z]/.test(password) ? (
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    ) : (
                                                                        <>
                                                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                        </>
                                                                    )}
                                                                </svg>
                                                                One lowercase letter
                                                            </li>
                                                            <li className={`password-req-item ${/[0-9]/.test(password) ? 'met' : ''}`}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    {/[0-9]/.test(password) ? (
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    ) : (
                                                                        <>
                                                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                        </>
                                                                    )}
                                                                </svg>
                                                                One number
                                                            </li>
                                                            <li className={`password-req-item ${/[^A-Za-z0-9]/.test(password) ? 'met' : ''}`}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    {/[^A-Za-z0-9]/.test(password) ? (
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    ) : (
                                                                        <>
                                                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                        </>
                                                                    )}
                                                                </svg>
                                                                One special character
                                                            </li>
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="login-actions">
                                            <button type="submit" disabled={isLoading} className="login-btn">
                                                {isLoading && !isRegistering ? (
                                                    <span className="spinner"></span>
                                                ) : (
                                                    isRegistering ? 'Get Started' : (isMagicLinkMode ? 'Send Link' : 'Enter')
                                                )}
                                            </button>
                                            {!isRegistering && !isMagicLinkMode && (
                                                <button type="button" onClick={handleRegisterClick} disabled={isLoading} className="register-btn">
                                                    {isLoading && isRegistering ? (
                                                        <span className="spinner"></span>
                                                    ) : (
                                                        'Create'
                                                    )}
                                                </button>
                                            )}
                                        </div>

                                        {onGuest && (
                                            <div className="guest-action-wrapper">
                                                <span className="guest-divider">or</span>
                                                <button type="button" onClick={handleGuestClick} className="guest-btn" disabled={isLoading}>
                                                    Continue as Guest
                                                </button>
                                                <p className="guest-warning">
                                                    * Temporary account. All guest data will be permanently deleted after 24 hours.
                                                </p>
                                            </div>
                                        )}
                                    </form>
                                )}
                                <div className="login-footer">
                                    <button 
                                        type="button" 
                                        onClick={() => { setIsRegistering(true); setError(''); setIsMagicLinkMode(false); }} 
                                        className="e2e-signup-btn"
                                    >
                                        Sign up
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Feature Details Modal */}
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
        </div>
    );
}
