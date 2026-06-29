import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useAuth } from '../../hooks/useAuth.js';
import { LandingShowcase } from '../LandingShowcase.js';
import './LoginScreen.css';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

interface LoginScreenProps {
    onLogin: (username: string, password: string, twoFactorCode?: string, turnstileToken?: string) => Promise<{ twoFactorRequired?: boolean } | void>;
    onRegister: (username: string, password: string, email?: string, turnstileToken?: string) => Promise<void>;
    onGuest?: (turnstileToken?: string) => Promise<void>;
}

export function LoginScreen({ onLogin, onRegister, onGuest }: LoginScreenProps) {
    const { authEnabled } = useAuth();
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
                    <button type="button" onClick={() => authEnabled ? openAuthModal(false) : onGuest?.()} className="btn-nav-accent">
                        {authEnabled ? "Let's go" : "Launch App"}
                    </button>
                </div>
            </header>

            <LandingShowcase 
                actionText={authEnabled ? "Register Free" : "Launch App"} 
                onActionClick={() => authEnabled ? openAuthModal(true) : onGuest?.()} 
                showPricing={true} 
            />



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
