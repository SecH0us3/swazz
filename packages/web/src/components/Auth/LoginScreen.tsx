import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useAuth } from '../../hooks/useAuth.js';
import './LoginScreen.css';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

interface LoginScreenProps {
    onLogin: (username: string, password: string, twoFactorCode?: string, turnstileToken?: string) => Promise<{ twoFactorRequired?: boolean } | void>;
    onRegister: (username: string, password: string, email?: string, turnstileToken?: string) => Promise<void>;
    onGuest?: (turnstileToken?: string) => Promise<void>;
}

const FEATURE_DETAILS = {
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

export function LoginScreen({ onLogin, onRegister, onGuest }: LoginScreenProps) {
    const turnstileSiteKey = useAppStore(state => state.turnstileSiteKey);
    const [turnstileResponse, setTurnstileResponse] = useState('');
    const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(null);

    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');
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

    // Initialize Turnstile script dynamically
    useEffect(() => {
        if (!turnstileSiteKey) return;
        const scriptId = 'cf-turnstile-script';
        let script = document.getElementById(scriptId) as HTMLScriptElement;
        if (!script) {
            script = document.createElement('script');
            script.id = scriptId;
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.defer = true;
            document.body.appendChild(script);
        }
    }, [turnstileSiteKey]);

    // Explicitly render Turnstile when container is available
    useEffect(() => {
        if (!turnstileSiteKey) return;
        
        let active = true;
        let widgetId: string | null = null;
        
        const checkAndRender = () => {
            if (!active) return;
            const container = document.getElementById('cf-turnstile-container');
            if (container && (window as any).turnstile) {
                try {
                    // Clear the container first to avoid double rendering issues
                    container.innerHTML = '';
                    
                    widgetId = (window as any).turnstile.render('#cf-turnstile-container', {
                        sitekey: turnstileSiteKey,
                        callback: (token: string) => {
                            setTurnstileResponse(token);
                        },
                        'expired-callback': () => {
                            setTurnstileResponse('');
                        },
                        'error-callback': () => {
                            setTurnstileResponse('');
                        }
                    });
                    setTurnstileWidgetId(widgetId);
                } catch (e) {
                    console.error("Turnstile render error:", e);
                }
            } else {
                setTimeout(checkAndRender, 100);
            }
        };

        checkAndRender();

        return () => {
            active = false;
            setTurnstileResponse('');
            if (widgetId && (window as any).turnstile) {
                try {
                    (window as any).turnstile.remove(widgetId);
                } catch (e) {}
            }
        };
    }, [turnstileSiteKey, isRegistering]);

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
        const feedback: string[] = [];
        let score = 0;
        if (pwd.length >= 12) {
            score = 4;
        } else {
            feedback.push('At least 12 characters');
            if (pwd.length >= 8) {
                score = 2;
            } else if (pwd.length >= 4) {
                score = 1;
            } else {
                score = 0;
            }
        }
        return { score, feedback };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            if (isRegistering) {
                const { score } = calculatePasswordStrength(password);
                if (score < 4) {
                    throw new Error('Password must be at least 12 characters long.');
                }
                await onRegister(username, password, email || undefined, turnstileResponse);
            } else {
                const res = await onLogin(username, password, twoFactorRequired ? twoFactorCode : undefined, turnstileResponse);
                if (res && res.twoFactorRequired) {
                    setTwoFactorRequired(true);
                    setTwoFactorCode('');
                }
            }
        } catch (err: any) {
            setError(err.message);
            if ((window as any).turnstile && turnstileWidgetId) {
                try {
                    (window as any).turnstile.reset(turnstileWidgetId);
                    setTurnstileResponse('');
                } catch (e) {}
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegisterClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        
        if (username && password) {
            const form = (e.currentTarget as HTMLElement).closest('form');
            if (form && form.reportValidity()) {
                setError('');
                setIsRegistering(true);
                setIsLoading(true);
                try {
                    const { score } = calculatePasswordStrength(password);
                    if (score < 4) {
                        throw new Error('Password must be at least 12 characters long.');
                    }
                    await onRegister(username, password, email || undefined, turnstileResponse);
                    return;
                } catch (err: any) {
                    setError(err.message);
                    if ((window as any).turnstile && turnstileWidgetId) {
                        try {
                            (window as any).turnstile.reset(turnstileWidgetId);
                            setTurnstileResponse('');
                        } catch (e) {}
                    }
                    setIsRegistering(false);
                    setIsLoading(false);
                    return;
                }
            }
        }
        
        setError('');
        setIsRegistering(true);
    };

    const handleGuestClick = async () => {
        if (!onGuest) return;
        setError('');
        setIsLoading(true);
        try {
            await onGuest(turnstileResponse);
        } catch (err: any) {
            setError(err.message || 'Failed to enter as guest');
            if ((window as any).turnstile && turnstileWidgetId) {
                try {
                    (window as any).turnstile.reset(turnstileWidgetId);
                    setTurnstileResponse('');
                } catch (e) {}
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasskeyLogin = async () => {
        if (!username) {
            setError('Please enter a username to sign in with Passkey.');
            return;
        }
        setError('');
        setIsLoading(true);
        try {
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            // 1. Get options
            const optsRes = await fetch('/api/auth/passkeys/login/generate-options', {
                method: 'POST',
                headers,
                body: JSON.stringify({ username })
            });
            const optsData = await optsRes.json().catch(() => ({}));
            if (!optsRes.ok) throw new Error(optsData.error || 'Failed to start passkey authentication');
            const opts = optsData;

            // 2. Start authentication
            const { startAuthentication } = await import('@simplewebauthn/browser');
            const authResp = await startAuthentication(opts);

            // 3. Verify
            const verifyRes = await fetch(`${PROXY_URL}/api/auth/passkeys/login/verify`, {
                method: 'POST',
                headers,
                body: JSON.stringify(authResp)
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(verifyData.error || 'Passkey verification failed');

            if (verifyData.token) {
                localStorage.setItem('swazz_token', verifyData.token);
                window.location.reload();
            } else {
                throw new Error('Authentication failed');
            }
        } catch (err: any) {
            setError(err.message);
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
                                    <h2>{isRegistering ? 'Create Account' : 'Welcome to Swazz'}</h2>
                                    {!isRegistering ? (
                                        <p className="login-subtitle">
                                            Enter your credentials to access your workspace. <br />
                                            New user? Click <strong>Create</strong> to sign up.
                                        </p>
                                    ) : (
                                        <p>Register to start fuzzing</p>
                                    )}
                                </div>

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
                                                    placeholder="••••••••••••"
                                                    autoComplete={isRegistering ? "new-password" : "current-password"}
                                                    required
                                                    minLength={12}
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
                                                        <ul className="password-requirements">
                                                            <li className={`password-req-item ${password.length >= 12 ? 'met' : ''}`}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                    {password.length >= 12 ? (
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    ) : (
                                                                        <>
                                                                            <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                            <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                        </>
                                                                    )}
                                                                </svg>
                                                                At least 12 characters
                                                            </li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="login-actions">
                                            <button type="submit" disabled={isLoading} className="login-btn">
                                                {isLoading ? (
                                                    <span className="spinner"></span>
                                                ) : (
                                                    isRegistering ? 'Get Started' : 'Enter'
                                                )}
                                            </button>
                                            {!isRegistering && (
                                                <button type="button" onClick={handleRegisterClick} disabled={isLoading} className="register-btn">
                                                    {isLoading && isRegistering ? (
                                                        <span className="spinner"></span>
                                                    ) : (
                                                        'Create'
                                                    )}
                                                </button>
                                            )}
                                            {isRegistering && (
                                                <button type="button" onClick={() => { setIsRegistering(false); setError(''); }} disabled={isLoading} className="register-btn">
                                                    Back to Login
                                                </button>
                                            )}
                                        </div>

                                        {!isRegistering && (
                                            <div className="passkey-login-container">
                                                <button type="button" onClick={handlePasskeyLogin} disabled={isLoading} className="register-btn passkey-login-btn">
                                                    {isLoading ? <span className="spinner"></span> : (
                                                        <>
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                                                                <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
                                                                <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
                                                                <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
                                                                <path d="M2 12a10 10 0 0 1 18-6" />
                                                                <path d="M2 16h.01" />
                                                                <path d="M21.8 16c.2-2 .131-5.354 0-6" />
                                                                <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
                                                                <path d="M8.65 22c.21-.66.45-1.32.57-2" />
                                                                <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
                                                            </svg>
                                                            Sign in with Passkey
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}

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

                                        {turnstileSiteKey && (
                                            <div style={{ margin: 'var(--space-4) 0', display: 'flex', justifyContent: 'center' }}>
                                                <div id="cf-turnstile-container" className="cf-turnstile"></div>
                                            </div>
                                        )}
                                    </form>
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
