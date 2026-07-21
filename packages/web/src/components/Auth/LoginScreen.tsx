import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useAuth } from '../../hooks/useAuth.js';
import { LandingShowcase } from '../LandingShowcase.js';
import { AuthModal } from './AuthModal.js';
import './LoginScreen.css';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

interface LoginScreenProps {
    onLogin: (username: string, password: string, twoFactorCode?: string, turnstileToken?: string) => Promise<{ twoFactorRequired?: boolean } | void>;
    onRegister: (username: string, password: string, email?: string, turnstileToken?: string, inviteCode?: string) => Promise<void>;
    onGuest?: (turnstileToken?: string) => Promise<void>;
}

export function LoginScreen({ onLogin, onRegister, onGuest }: LoginScreenProps) {
    const { authEnabled, githubAuthEnabled } = useAuth();
    const turnstileSiteKey = useAppStore(state => state.turnstileSiteKey);
    const [turnstileResponse, setTurnstileResponse] = useState('');
    const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(null);

    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [hasInviteCode, setHasInviteCode] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const betaModeEnabled = useAppStore(state => state.betaModeEnabled);
    const betaLimitReached = useAppStore(state => state.betaLimitReached);
    const [showPassword, setShowPassword] = useState(false);
    const [twoFactorRequired, setTwoFactorRequired] = useState(false);
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [activeTab, setActiveTab] = useState<'cloud' | 'docker' | 'worker'>('cloud');
    const [selectedFeature, setSelectedFeature] = useState<{ title: string; details: string; goal: string; benefit: string; image?: string } | null>(null);
    const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);

    // Automatically pick up project invitation token from URL and open registration
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (token) {
            setInviteCode(token);
            setHasInviteCode(true);
            setIsRegistering(true);
            setShowModal(true);
        }
    }, []);

    const handleGithubLogin = () => {
        window.location.href = '/api/auth/login/github';
    };

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
                        theme: 'dark',
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
                await onRegister(username, password, email || undefined, turnstileResponse, inviteCode || undefined);
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
                    await onRegister(username, password, email || undefined, turnstileResponse, inviteCode || undefined);
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
        setInviteCode('');
        setHasInviteCode(false);
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
                        <a href="#pricing" className="nav-link">Pricing</a>
                        <div className="nav-divider"></div>
                        <a href="https://sech0us3.github.io/swazz/" className="nav-link" target="_blank" rel="noopener noreferrer">Docs</a>
                        <a href="https://yoursec.substack.com/" className="nav-link" target="_blank" rel="noopener noreferrer">Blog</a>
                        <a href="https://github.com/SecH0us3/swazz" className="nav-link" target="_blank" rel="noopener noreferrer">GitHub</a>
                    </nav>
                </div>
                <div className="landing-nav-right">
                    {authEnabled && (
                        <button type="button" onClick={() => openAuthModal(false)} className="btn-nav-ghost">
                            Sign In
                        </button>
                    )}
                    <button type="button" onClick={() => authEnabled ? openAuthModal(true) : onGuest?.()} className="btn-nav-accent">
                        {authEnabled ? "Start for free" : "Launch App"}
                    </button>
                </div>
            </header>

            <LandingShowcase 
                showPricing={true} 
                onActionClick={() => authEnabled ? openAuthModal(false) : onGuest?.()}
            />


            {/* Auth Modal Popup Overlay */}
            <AuthModal
                isOpen={showModal}
                onClose={closeAuthModal}
                initialIsRegistering={isRegistering}
                onLogin={onLogin}
                onRegister={onRegister}
                onGuest={onGuest}
            />

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
