import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useToast } from '../../hooks/useToast.js';
import './LoginScreen.css';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

function calculatePasswordStrength(pass: string): { score: number; label: string } {
    let score = 0;
    if (!pass) return { score: 0, label: 'Weak' };
    if (pass.length >= 12) score += 1;
    if (pass.length >= 16) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    
    if (score <= 1) return { score: 0, label: 'Weak' };
    if (score === 2) return { score: 1, label: 'Fair' };
    if (score === 3) return { score: 2, label: 'Good' };
    if (score === 4) return { score: 3, label: 'Strong' };
    return { score: 4, label: 'Excellent' };
}

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialIsRegistering?: boolean;
    onLogin: (username: string, password: string, twoFactorCode?: string, turnstileToken?: string) => Promise<{ twoFactorRequired?: boolean } | void>;
    onRegister: (username: string, password: string, email?: string, turnstileToken?: string, inviteCode?: string) => Promise<void>;
    onGuest?: (turnstileToken?: string) => Promise<void>;
}

export function AuthModal({
    isOpen,
    onClose,
    initialIsRegistering = false,
    onLogin,
    onRegister,
    onGuest,
}: AuthModalProps) {
    const { githubAuthEnabled } = useAuth();
    const { showToast } = useToast();
    const turnstileSiteKey = useAppStore(state => state.turnstileSiteKey);
    const [turnstileResponse, setTurnstileResponse] = useState('');
    const [, setTurnstileWidgetId] = useState<string | null>(null);

    const [isRegistering, setIsRegistering] = useState(initialIsRegistering);
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

    useEffect(() => {
        setIsRegistering(initialIsRegistering);
    }, [initialIsRegistering, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Initialize Turnstile script dynamically
    useEffect(() => {
        if (!isOpen || !turnstileSiteKey) return;
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
    }, [isOpen, turnstileSiteKey]);

    // Render Turnstile when container is available
    useEffect(() => {
        if (!isOpen || !turnstileSiteKey) return;
        let active = true;
        let widgetId: string | null = null;

        const checkAndRender = () => {
            if (!active) return;
            const container = document.getElementById('cf-turnstile-container-modal');
            if (container && (window as any).turnstile) {
                try {
                    container.innerHTML = '';
                    widgetId = (window as any).turnstile.render('#cf-turnstile-container-modal', {
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
                    console.warn('Turnstile render error:', e);
                }
            } else {
                setTimeout(checkAndRender, 100);
            }
        };

        checkAndRender();
        return () => {
            active = false;
        };
    }, [isOpen, turnstileSiteKey, isRegistering]);

    if (!isOpen) return null;

    const handleGithubLogin = () => {
        window.location.href = '/api/auth/login/github';
    };

    const handlePasskeyLogin = async () => {
        setError('');
        setIsLoading(true);
        try {
            const optRes = await fetch(`${PROXY_URL}/api/auth/passkeys/login/options`, { method: 'POST' });
            if (!optRes.ok) {
                const errData = await optRes.json();
                throw new Error(errData.error || 'Failed to get passkey options');
            }
            const options = await optRes.json();
            options.challenge = Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer;
            if (options.allowCredentials) {
                options.allowCredentials = options.allowCredentials.map((c: any) => ({
                    ...c,
                    id: Uint8Array.from(atob(c.id.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)).buffer
                }));
            }

            const credential = await navigator.credentials.get({ publicKey: options }) as PublicKeyCredential;
            if (!credential) throw new Error('Passkey authentication cancelled');

            const response = credential.response as AuthenticatorAssertionResponse;
            const body = {
                id: credential.id,
                rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
                type: credential.type,
                response: {
                    clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
                    authenticatorData: btoa(String.fromCharCode(...new Uint8Array(response.authenticatorData))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
                    signature: btoa(String.fromCharCode(...new Uint8Array(response.signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
                    userHandle: response.userHandle ? btoa(String.fromCharCode(...new Uint8Array(response.userHandle))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '') : null
                }
            };

            const verifyRes = await fetch(`${PROXY_URL}/api/auth/passkeys/login/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(data.error || 'Passkey login failed');

            localStorage.setItem('swazz_token', data.token);
            window.location.reload();
        } catch (err: any) {
            setError(err.message || 'Passkey authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (isRegistering) {
                if (username.length < 3 || username.length > 20) {
                    throw new Error('Username must be between 3 and 20 characters');
                }
                if (password.length < 12) {
                    throw new Error('Password must be at least 12 characters');
                }
                await onRegister(username, password, email, turnstileResponse, inviteCode);
                showToast('Account created successfully!', 'success');
                onClose();
            } else {
                const res = await onLogin(username, password, twoFactorRequired ? twoFactorCode : undefined, turnstileResponse);
                if (res && res.twoFactorRequired) {
                    setTwoFactorRequired(true);
                    setIsLoading(false);
                    return;
                }
                showToast('Welcome back!', 'success');
                onClose();
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGuestClick = async () => {
        if (!onGuest) return;
        setError('');
        setIsLoading(true);
        try {
            await onGuest(turnstileResponse);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Guest login failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-modal-backdrop" onClick={onClose}>
            <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Close modal">
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
                                <button type="submit" disabled={isLoading} className="login-btn primary-submit-btn">
                                    {isLoading ? <span className="spinner"></span> : 'Verify'}
                                </button>
                                <button 
                                    type="button" 
                                    onClick={() => {
                                        setTwoFactorRequired(false);
                                        setError('');
                                    }} 
                                    className="guest-btn ghost-btn"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </>
                ) : (
                    <>
                        <div className="login-header">
                            {isRegistering ? (
                                <>
                                    {betaModeEnabled && (
                                        <div className="beta-eyebrow">
                                            <span className="beta-badge">Closed Beta</span>
                                        </div>
                                    )}
                                    <h2>Join the Beta</h2>
                                    <p className="login-subtitle">Claim your spot. Start fuzzing APIs</p>
                                </>
                            ) : (
                                <>
                                    <h2>Welcome back</h2>
                                    <p className="login-subtitle">Your findings are waiting</p>
                                </>
                            )}
                        </div>

                        {isRegistering && betaModeEnabled && (
                            <div className={`beta-status-banner ${betaLimitReached ? 'filled' : 'normal'}`}>
                                {betaLimitReached
                                    ? 'Closed Beta · Invite code required'
                                    : 'Closed Beta · Limited availability'
                                }
                            </div>
                        )}

                        {(githubAuthEnabled || !isRegistering) && (
                            <div className="social-auth-container">
                                {githubAuthEnabled && (
                                    <button 
                                        type="button" 
                                        onClick={handleGithubLogin} 
                                        disabled={isLoading} 
                                        className="primary-social-btn github-social-btn"
                                    >
                                        <svg className="github-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                                        </svg>
                                        Continue with GitHub
                                    </button>
                                )}

                                {!isRegistering && (
                                    <button 
                                        type="button" 
                                        onClick={handlePasskeyLogin} 
                                        disabled={isLoading} 
                                        className="primary-social-btn passkey-social-btn"
                                    >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
                                    </button>
                                )}
                            </div>
                        )}

                        {(githubAuthEnabled || !isRegistering) && (
                            <div className="oauth-divider">
                                <span className="oauth-divider-text">or continue with credentials</span>
                            </div>
                        )}

                        {error && (
                            <div className="login-error">
                                <div className="error-content">
                                    <span className="error-text">{error}</span>
                                </div>
                            </div>
                        )}

                        <form className="login-form" onSubmit={handleSubmit}>
                            {isRegistering && betaModeEnabled && (
                                <>
                                    {betaLimitReached ? (
                                        <div className="form-group">
                                            <label htmlFor="inviteCode">Invite Code <span className="required-star">*</span></label>
                                            <input
                                                type="text"
                                                id="inviteCode"
                                                name="inviteCode"
                                                value={inviteCode}
                                                onChange={(e) => setInviteCode(e.target.value)}
                                                placeholder="XXXX-XXXX-XXXX"
                                                data-1p-ignore
                                                required
                                            />
                                        </div>
                                    ) : (
                                        <div className="form-group invite-code-group">
                                            {!hasInviteCode ? (
                                                <button
                                                    type="button"
                                                    className="text-btn invite-code-toggle-btn"
                                                    onClick={() => setHasInviteCode(true)}
                                                >
                                                    Have an invite code?
                                                </button>
                                            ) : (
                                                <>
                                                    <label htmlFor="inviteCode">Invite Code (Optional)</label>
                                                    <input
                                                        type="text"
                                                        id="inviteCode"
                                                        name="inviteCode"
                                                        value={inviteCode}
                                                        onChange={(e) => setInviteCode(e.target.value)}
                                                        placeholder="XXXX-XXXX-XXXX"
                                                        data-1p-ignore
                                                    />
                                                </>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            <div className="form-group">
                                <label htmlFor="username">Username{isRegistering && <span className="required-star"> *</span>}</label>
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
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="password">Password{isRegistering && <span className="required-star"> *</span>}</label>
                                <div className="password-input-wrapper">
                                    <input
                                        key={isRegistering ? "signup-password" : "signin-password"}
                                        type={showPassword ? "text" : "password"}
                                        id="password"
                                        name="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder={isRegistering ? "Min 12 characters" : "••••••••••••"}
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
                                {isRegistering && password.length > 0 && (
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

                            {isRegistering && (
                                <div className="form-group">
                                    <label htmlFor="email">Email (Optional)</label>
                                    <input
                                        type="email"
                                        id="email"
                                        name="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="name@example.com"
                                    />
                                </div>
                            )}

                            <div className="login-actions">
                                <button type="submit" disabled={isLoading} className="login-btn primary-submit-btn">
                                    {isLoading ? (
                                        <span className="spinner"></span>
                                    ) : (
                                        isRegistering ? 'Create Account' : 'Sign In'
                                    )}
                                </button>
                            </div>

                            <div className="auth-toggle-link">
                                {isRegistering ? (
                                    <p>Already have an account? <button type="button" onClick={() => {setIsRegistering(false); setError('');}} className="text-btn">Log in</button></p>
                                ) : (
                                    <p>New user? <button type="button" onClick={() => {setIsRegistering(true); setError('');}} className="text-btn">Create an account</button></p>
                                )}
                            </div>

                            {turnstileSiteKey && (
                                <div className="turnstile-wrapper">
                                    <div id="cf-turnstile-container-modal" className="cf-turnstile"></div>
                                </div>
                            )}

                            {onGuest && (
                                <div className="guest-action-wrapper">
                                    <button type="button" onClick={handleGuestClick} className="guest-btn" disabled={isLoading}>
                                        Try as guest →
                                    </button>
                                </div>
                            )}
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
