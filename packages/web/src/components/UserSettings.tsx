import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useTheme } from '../hooks/useTheme.js';
import QRCode from 'qrcode';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function UserSettings() {
    const userProfile = useAppStore(state => state.userProfile);
    const { theme, toggleTheme } = useTheme();
    const [copiedApiKey, setCopiedApiKey] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);

    const [deleteState, setDeleteState] = useState<'idle' | 'warning' | 'deleting'>('idle');
    const [deleteError, setDeleteError] = useState('');

    const [passkeys, setPasskeys] = useState<any[]>([]);
    const [passkeysLoading, setPasskeysLoading] = useState(false);
    const [passkeysError, setPasskeysError] = useState('');

    const [twoFactorEnabled, setTwoFactorEnabled] = useState(userProfile?.twoFactorEnabled || false);
    const [setup2faData, setSetup2faData] = useState<{ secret: string; otpauth_url: string } | null>(null);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [setupError, setSetupError] = useState('');
    const [setupSuccess, setSetupSuccess] = useState('');
    const [is2faLoading, setIs2faLoading] = useState(false);

    const [activeSubTab, setActiveSubTab] = useState<'account' | 'security' | 'danger'>('account');

    useEffect(() => {
        if (userProfile) {
            setTwoFactorEnabled(!!userProfile.twoFactorEnabled);
        }
    }, [userProfile]);

    useEffect(() => {
        if (activeSubTab === 'security' && userProfile && !userProfile.isGuest) {
            fetchPasskeys();
        }
    }, [activeSubTab, userProfile]);

    const fetchPasskeys = async () => {
        setPasskeysLoading(true);
        try {
            const token = localStorage.getItem('swazz_token');
            const res = await fetch(`${PROXY_URL}/api/auth/passkeys`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setPasskeys(data.credentials || data || []);
            }
        } catch (e) {
            console.error('Failed to fetch passkeys', e);
        } finally {
            setPasskeysLoading(false);
        }
    };

    const handleRegisterPasskey = async () => {
        setPasskeysError('');
        try {
            const token = localStorage.getItem('swazz_token');
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            const optsRes = await fetch(`${PROXY_URL}/api/auth/passkeys/register/generate-options`, {
                method: 'POST',
                headers
            });
            if (!optsRes.ok) throw new Error('Failed to get registration options');
            const opts = await optsRes.json();

            const { startRegistration } = await import('@simplewebauthn/browser');
            const authResp = await startRegistration(opts);

            const verifyRes = await fetch(`${PROXY_URL}/api/auth/passkeys/register/verify`, {
                method: 'POST',
                headers,
                body: JSON.stringify(authResp)
            });
            if (!verifyRes.ok) {
                const errData = await verifyRes.json();
                throw new Error(errData.error || 'Failed to verify passkey');
            }

            await fetchPasskeys();
        } catch (err: any) {
            setPasskeysError(err.message);
        }
    };

    const handleDeletePasskey = async (id: string) => {
        try {
            const token = localStorage.getItem('swazz_token');
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            await fetch(`${PROXY_URL}/api/auth/passkeys/${id}`, {
                method: 'DELETE',
                headers
            });
            await fetchPasskeys();
        } catch (err) {
            console.error('Failed to delete passkey', err);
        }
    };

    const [confirmPassword, setConfirmPassword] = useState('');

    const handleStart2faSetup = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setSetupError('');
        setSetupSuccess('');
        setIs2faLoading(true);
        const token = localStorage.getItem('swazz_token');
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        try {
            const res = await fetch(`${PROXY_URL}/api/auth/2fa/setup`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ password: confirmPassword })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start 2FA setup');
            setSetup2faData({
                secret: data.secret,
                otpauth_url: data.otpauth_url
            });
            const qrDataUrl = await QRCode.toDataURL(data.otpauth_url);
            setQrCodeDataUrl(qrDataUrl);
        } catch (err: any) {
            setSetupError(err.message);
        } finally {
            setIs2faLoading(false);
        }
    };

    const handleVerify2fa = async (e: React.FormEvent) => {
        e.preventDefault();
        setSetupError('');
        setSetupSuccess('');
        setIs2faLoading(true);
        const token = localStorage.getItem('swazz_token');
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        try {
            const res = await fetch(`${PROXY_URL}/api/auth/2fa/verify`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ code: totpCode, password: confirmPassword })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to verify 2FA code');
            
            const profile = useAppStore.getState().userProfile;
            if (profile) {
                useAppStore.setState({
                    userProfile: {
                        ...profile,
                        twoFactorEnabled: true
                    }
                });
            }
            setTwoFactorEnabled(true);
            setSetup2faData(null);
            setTotpCode('');
            setConfirmPassword('');
            setSetupSuccess('Two-factor authentication enabled successfully!');
        } catch (err: any) {
            setSetupError(err.message);
        } finally {
            setIs2faLoading(false);
        }
    };


    const handleDisable2fa = async (e: React.FormEvent) => {
        e.preventDefault();
        setSetupError('');
        setSetupSuccess('');
        setIs2faLoading(true);
        const token = localStorage.getItem('swazz_token');
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        try {
            const res = await fetch(`${PROXY_URL}/api/auth/2fa/disable`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ code: totpCode, password: confirmPassword })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to disable 2FA');

            const profile = useAppStore.getState().userProfile;
            if (profile) {
                useAppStore.setState({
                    userProfile: {
                        ...profile,
                        twoFactorEnabled: false
                    }
                });
            }
            setTwoFactorEnabled(false);
            setTotpCode('');
            setConfirmPassword('');
            setSetupSuccess('Two-factor authentication disabled.');
        } catch (err: any) {
            setSetupError(err.message);
        } finally {
            setIs2faLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (deleteState === 'idle') {
            setDeleteState('warning');
            return;
        }
        if (deleteState === 'warning') {
            setDeleteState('deleting');
            setDeleteError('');
            const token = localStorage.getItem('swazz_token');
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
            try {
                const res = await fetch(`${PROXY_URL}/api/users/me`, {
                    method: 'DELETE',
                    headers
                });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Failed to delete account');
                }
                
                useAppStore.setState(state => ({
                    userProfile: state.userProfile ? {
                        ...state.userProfile,
                        deleteRequestedAt: new Date().toISOString()
                    } : null
                }));
                
                setDeleteState('idle');
            } catch (err: any) {
                console.error(err);
                setDeleteError(err.message || 'An error occurred during account deletion');
                setDeleteState('idle');
            }
        }
    };

    const username = userProfile?.username || 'Guest';
    const apiKey = userProfile?.apiKey || '';

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="settings-page">
            {/* Header */}
            <div className="settings-header">
                <div className="settings-header-info">
                    <h1 className="settings-header-title">Settings</h1>
                    <p className="settings-header-desc">
                        Manage your account details, security settings, and personal options.
                    </p>
                </div>
                <button 
                    className="btn btn-secondary settings-back-btn" 
                    onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                    Back to Dashboard
                </button>
            </div>

            {/* Layout with Sub-Tabs */}
            <div className="settings-body">
                {/* Left Sub-Tab Navigation */}
                <div className="settings-nav">
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'account' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('account')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        Account Details
                    </button>
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'security' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('security')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Security (2FA)
                    </button>
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'danger' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('danger')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Danger Zone
                    </button>
                </div>

                {/* Tab Content Cards */}
                <div className="settings-content">
                    {activeSubTab === 'account' && (
                        <div className="settings-card">
                            <h2 className="settings-card-title">
                                Account Details
                            </h2>
                            <div className="settings-form-group">
                                <label className="settings-form-label">Username</label>
                                <input 
                                    type="text" 
                                    className="input settings-input-w-full settings-input-disabled" 
                                    value={username} 
                                    disabled 
                                />
                            </div>
                            <div className="settings-form-group">
                                <label className="settings-form-label">Account Level</label>
                                <div className="settings-account-status">
                                    <span className={`account-status-dot ${(apiKey && !userProfile?.isGuest) ? 'active' : 'inactive'}`} />
                                    {(apiKey && !userProfile?.isGuest) ? 'Registered User (Unlimited scans)' : 'Guest Mode (Temporary account - deletes in 24 hours)'}
                                </div>
                            </div>
                            <div className="settings-form-group">
                                <label className="settings-form-label">Theme Preference</label>
                                <button 
                                    className="btn btn-secondary btn-sm settings-btn-w-full"
                                    onClick={toggleTheme}
                                    type="button"
                                    id="btn-toggle-theme-settings"
                                >
                                    Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
                                </button>
                            </div>
                            {apiKey && (
                                <div className="settings-form-group">
                                    <label className="settings-form-label">API Key</label>
                                    <div className="settings-input-row">
                                        <input 
                                            type={showApiKey ? 'text' : 'password'} 
                                            className="input settings-input-monospace" 
                                            value={apiKey} 
                                            readOnly 
                                            data-1p-ignore
                                        />
                                        <button 
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setShowApiKey(!showApiKey)}
                                        >
                                            {showApiKey ? 'Hide' : 'Show'}
                                        </button>
                                        <button 
                                            className="btn btn-secondary btn-sm settings-btn-min-w"
                                            onClick={() => copyToClipboard(apiKey, setCopiedApiKey)}
                                        >
                                            {copiedApiKey ? '✓ Copied' : 'Copy'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeSubTab === 'security' && (
                        apiKey && !userProfile?.isGuest ? (
                            <div className="two-factor-card">
                                <h2 className="two-factor-header-title">
                                    Two-Factor Authentication (2FA)
                                </h2>
                                
                                <div className="two-factor-status-container">
                                    Status: 
                                    <span className={`two-factor-status-badge ${twoFactorEnabled ? 'enabled' : 'disabled'}`}>
                                        {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                </div>

                                {setupSuccess && (
                                    <div className="two-factor-success-alert">
                                        {setupSuccess}
                                    </div>
                                )}

                                {setupError && (
                                    <div className="two-factor-error-alert">
                                        {setupError}
                                    </div>
                                )}

                                {!twoFactorEnabled && !setup2faData && (
                                    <form onSubmit={handleStart2faSetup} className="two-factor-input-group">
                                        <p className="two-factor-instructions">
                                            Add an extra layer of security to your account by enabling Time-based One-Time Passwords (TOTP).
                                        </p>
                                        <label htmlFor="totp-setup-password" className="settings-form-label">
                                            Enter your password to verify your identity
                                        </label>
                                        <input
                                            type="password"
                                            id="totp-setup-password"
                                            className="input"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="••••••••"
                                            required
                                            data-1p-ignore
                                        />
                                        <button
                                            type="submit"
                                            className="btn btn-secondary btn-sm two-factor-w-full two-factor-mt-8"
                                            disabled={is2faLoading}
                                        >
                                            {is2faLoading ? 'Loading...' : 'Set Up 2FA'}
                                        </button>
                                    </form>
                                )}

                                {!twoFactorEnabled && setup2faData && (
                                    <div className="two-factor-setup-container">
                                        <p className="two-factor-instructions">
                                            1. Scan the QR code below with your authenticator app (Google Authenticator, Authy, etc.), or enter the secret key manually.
                                        </p>
                                        
                                        <div className="two-factor-setup-flow">
                                            <div className="two-factor-qr-wrapper">
                                                <img 
                                                    src={qrCodeDataUrl} 
                                                    alt="2FA QR Code" 
                                                    className="two-factor-qr-image"
                                                />
                                            </div>
                                            <div className="two-factor-setup-details">
                                                <span className="two-factor-secret-key-label">Secret Key</span>
                                                <div className="two-factor-secret-key-display">
                                                    {setup2faData.secret}
                                                </div>
                                            </div>
                                        </div>

                                        <form onSubmit={handleVerify2fa} className="two-factor-input-group">
                                            <label htmlFor="totp-setup-code" className="settings-form-label">
                                                2. Enter the 6-digit code from your app to verify setup
                                            </label>
                                            <input
                                                type="text"
                                                id="totp-setup-code"
                                                className="input two-factor-text-center-spaced"
                                                value={totpCode}
                                                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                                                placeholder="000000"
                                                pattern="^\d{6}$"
                                                required
                                            />
                                            <div className="two-factor-actions two-factor-mt-8">
                                                <button
                                                    type="submit"
                                                    className="btn btn-primary btn-sm two-factor-flex-1"
                                                    disabled={is2faLoading}
                                                >
                                                    {is2faLoading ? 'Verifying...' : 'Verify & Enable'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => {
                                                        setSetup2faData(null);
                                                        setTotpCode('');
                                                        setSetupError('');
                                                        setQrCodeDataUrl('');
                                                        setConfirmPassword('');
                                                    }}
                                                    disabled={is2faLoading}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                )}

                                {twoFactorEnabled && (
                                    <div className="two-factor-setup-container">
                                        <form onSubmit={handleDisable2fa} className="two-factor-input-group">
                                            <label htmlFor="totp-disable-password" className="settings-form-label">
                                                Enter your account password to confirm
                                            </label>
                                            <input
                                                type="password"
                                                id="totp-disable-password"
                                                className="input"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="••••••••"
                                                required
                                                data-1p-ignore
                                            />
                                            <label htmlFor="totp-disable-code" className="settings-form-label">
                                                Enter 6-digit code from your app
                                            </label>
                                            <input
                                                type="text"
                                                id="totp-disable-code"
                                                className="input two-factor-text-center-spaced"
                                                value={totpCode}
                                                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                                                placeholder="000000"
                                                pattern="^\d{6}$"
                                                required
                                            />
                                            <button
                                                type="submit"
                                                className="btn btn-danger btn-sm two-factor-w-full two-factor-mt-8"
                                                disabled={is2faLoading}
                                            >
                                                {is2faLoading ? 'Disabling...' : 'Disable 2FA'}
                                            </button>
                                        </form>
                                    </div>
                                )}

                                <div className="settings-card passkeys-section">
                                    <h2 className="two-factor-header-title">Passkeys</h2>
                                    <p className="two-factor-instructions">Sign in quickly and securely using your device's passkey (Face ID, Touch ID, or Windows Hello).</p>
                                    
                                    {passkeysError && <div className="two-factor-error-alert">{passkeysError}</div>}
                                    
                                    <div className="passkeys-list-container">
                                        {passkeysLoading ? (
                                            <p>Loading passkeys...</p>
                                        ) : passkeys.length === 0 ? (
                                            <p className="passkeys-empty">No passkeys registered yet.</p>
                                        ) : (
                                            <ul className="passkeys-list">
                                                {passkeys.map((pk: any) => (
                                                    <li key={pk.id} className="passkey-item">
                                                        <span>{pk.name || 'Passkey'} {pk.created_at && <small className="passkey-date">({new Date(pk.created_at).toLocaleDateString()})</small>}</span>
                                                        <button 
                                                            className="btn btn-danger btn-sm"
                                                            onClick={() => handleDeletePasskey(pk.id)}
                                                        >
                                                            Delete
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <button 
                                        type="button" 
                                        className="btn btn-secondary btn-sm"
                                        onClick={handleRegisterPasskey}
                                    >
                                        Register New Passkey
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="settings-card">
                                <h2 className="settings-card-title">Security Settings</h2>
                                <p className="settings-danger-text">Two-factor authentication is only available for registered users. Guests cannot enable 2FA.</p>
                            </div>
                        )
                    )}

                    {activeSubTab === 'danger' && (
                        <div className="settings-card settings-danger-card">
                            <h2 className="settings-danger-title">
                                Danger Zone
                            </h2>
                            
                            {deleteState === 'idle' ? (
                                <div className="settings-delete-container">
                                    <p className="settings-danger-text">
                                        Permanently delete your account and all associated resources. This action is irreversible.
                                    </p>
                                    <button 
                                        className="btn btn-danger btn-sm settings-btn-w-full"
                                        onClick={handleDeleteAccount}
                                        type="button"
                                    >
                                        Delete My Account & Data
                                    </button>
                                </div>
                            ) : deleteState === 'warning' ? (
                                <div className="settings-delete-container">
                                    <h3 className="settings-delete-title">⚠️ Irreversible Action!</h3>
                                    <p className="settings-delete-desc">
                                        This will immediately delete all your scan histories, projects, configurations, and private runners from the platform. There is no backup and this cannot be undone.
                                    </p>
                                    <div className="settings-delete-actions">
                                        <button 
                                            className="btn btn-danger btn-sm"
                                            onClick={handleDeleteAccount}
                                            type="button"
                                        >
                                            Yes, delete permanently
                                        </button>
                                        <button 
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => { setDeleteState('idle'); setDeleteError(''); }}
                                            type="button"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="settings-delete-container">
                                    <p className="settings-danger-text">
                                        Executing data purge. Please wait...
                                    </p>
                                    <button 
                                        className="btn btn-danger btn-sm settings-btn-w-full"
                                        disabled
                                        type="button"
                                    >
                                        Deleting account...
                                    </button>
                                </div>
                            )}
                            
                            {deleteError && (
                                <p className="settings-delete-error">
                                    Error: {deleteError}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
