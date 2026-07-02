import React, { useState, useEffect, useCallback } from 'react';
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

    const [activeSubTab, setActiveSubTab] = useState<'account' | 'security' | 'danger' | 'admin'>('account');

    const [adminSecret, setAdminSecret] = useState(() => localStorage.getItem('admin_secret') || '');
    const [inputSecret, setInputSecret] = useState(() => localStorage.getItem('admin_secret') || '');
    const [logs, setLogs] = useState<any[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error' | 'debug'>('all');
    const [moduleFilter, setModuleFilter] = useState('');
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    const fetchLogs = useCallback(async (secretToUse?: string) => {
        const secret = secretToUse !== undefined ? secretToUse : adminSecret;
        if (!secret) {
            setLogs([]);
            return;
        }
        setLogsLoading(true);
        setLogsError('');
        try {
            const res = await fetch(`${PROXY_URL}/api/admin/logs`, {
                headers: {
                    'Authorization': `Bearer ${secret}`
                }
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP error ${res.status}`);
            }
            const data = await res.json();
            setLogs(data || []);
        } catch (err: any) {
            console.error('Failed to fetch admin logs', err);
            setLogsError(err.message || 'Failed to fetch logs');
        } finally {
            setLogsLoading(false);
        }
    }, [adminSecret]);

    useEffect(() => {
        if (activeSubTab === 'admin') {
            fetchLogs();
        }
    }, [activeSubTab, fetchLogs]);

    const handleSaveSecret = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('admin_secret', inputSecret);
        setAdminSecret(inputSecret);
    };

    const handleClearSecret = () => {
        localStorage.removeItem('admin_secret');
        setInputSecret('');
        setAdminSecret('');
        setLogs([]);
        setLogsError('');
    };

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

            const optsRes = await fetch('/api/auth/passkeys/register/generate-options', {
                method: 'POST',
                headers
            });
            const optsData = await optsRes.json().catch(() => ({}));
            if (!optsRes.ok) throw new Error(optsData.error || 'Failed to get registration options');
            const opts = optsData;

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

            const res = await fetch(`/api/auth/passkeys/${id}`, {
                method: 'DELETE',
                headers
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to delete passkey');
            }
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
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'admin' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('admin')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="logs-nav-icon">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        Admin Logs
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
                                                        <span>{pk.name || 'Passkey'} {pk.created_at && <small className="passkey-date">({(() => {
                                                            const isoStr = pk.created_at.replace(' ', 'T') + 'Z';
                                                            const d = new Date(isoStr);
                                                            return isNaN(d.getTime()) ? 'Unknown Date' : d.toLocaleDateString();
                                                        })()})</small>}</span>
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

                    {activeSubTab === 'admin' && (
                        <div className="settings-card">
                            <div className="logs-header-container">
                                <h2 className="settings-card-title">
                                    Admin Edge Worker Logs
                                </h2>
                                {adminSecret && (
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => fetchLogs()}
                                        disabled={logsLoading}
                                    >
                                        {logsLoading ? 'Refreshing...' : 'Refresh'}
                                    </button>
                                )}
                            </div>

                            {!adminSecret ? (
                                <form onSubmit={handleSaveSecret} className="logs-secret-section">
                                    <p className="settings-danger-text">
                                        Enter your Admin Secret key to authenticate and view real-time system logs.
                                    </p>
                                    <div className="logs-secret-row">
                                        <input
                                            type="password"
                                            className="input logs-secret-input"
                                            placeholder="Enter Admin Secret"
                                            value={inputSecret}
                                            onChange={(e) => setInputSecret(e.target.value)}
                                            required
                                            data-1p-ignore
                                        />
                                        <button type="submit" className="btn btn-primary btn-sm">
                                            Save & Authenticate
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <div className="logs-tab-container">
                                    <div className="logs-secret-row">
                                        <input
                                            type="password"
                                            className="input logs-secret-input"
                                            value="••••••••••••••••"
                                            disabled
                                            data-1p-ignore
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={handleClearSecret}
                                        >
                                            Clear Secret
                                        </button>
                                    </div>

                                    {logsError && (
                                        <div className="two-factor-error-alert">
                                            {logsError}
                                        </div>
                                    )}

                                    <div className="logs-filter-row">
                                        <input
                                            type="text"
                                            className="input logs-filter-input"
                                            placeholder="Search messages..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        <input
                                            type="text"
                                            className="input logs-filter-input"
                                            placeholder="Filter by module..."
                                            value={moduleFilter}
                                            onChange={(e) => setModuleFilter(e.target.value)}
                                        />
                                        <select
                                            className="input logs-filter-select"
                                            value={levelFilter}
                                            onChange={(e) => setLevelFilter(e.target.value as any)}
                                        >
                                            <option value="all">All Levels</option>
                                            <option value="info">Info</option>
                                            <option value="warn">Warn</option>
                                            <option value="error">Error</option>
                                            <option value="debug">Debug</option>
                                        </select>
                                    </div>

                                    {logsLoading && logs.length === 0 ? (
                                        <p className="logs-no-data">Loading logs...</p>
                                    ) : (() => {
                                        const filtered = (Array.isArray(logs) ? logs : []).filter(log => {
                                            if (!log) return false;
                                            if (levelFilter !== 'all' && log.level !== levelFilter) return false;
                                            if (moduleFilter && !log.module?.toLowerCase().includes(moduleFilter.toLowerCase())) return false;
                                            if (searchQuery && !log.msg?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                                            return true;
                                        });

                                        if (filtered.length === 0) {
                                            return <p className="logs-no-data">No logs found matching filters.</p>;
                                        }

                                        return (
                                            <div className="logs-table-wrapper">
                                                <table className="logs-table">
                                                    <thead className="logs-table-header">
                                                        <tr>
                                                            <th className="logs-th">Timestamp</th>
                                                            <th className="logs-th">Level</th>
                                                            <th className="logs-th">Module</th>
                                                            <th className="logs-th">Message</th>
                                                            <th className="logs-th">Actions</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {filtered.map((log, idx) => {
                                                            const logId = `${log.timestamp}-${idx}`;
                                                            const isExpanded = expandedLogId === logId;
                                                            const hasPayload = log.payload && Object.keys(log.payload).length > 0;
                                                            const hasError = !!log.error;
                                                            const canInspect = hasPayload || hasError;
                                                            
                                                            let levelClass = '';
                                                            if (log.level === 'info') levelClass = 'log-row-info';
                                                            else if (log.level === 'warn') levelClass = 'log-row-warn';
                                                            else if (log.level === 'error') levelClass = 'log-row-error';

                                                            return (
                                                                <React.Fragment key={logId}>
                                                                    <tr className="logs-tr">
                                                                        <td className="logs-td">
                                                                            {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                                                                        </td>
                                                                        <td className="logs-td">
                                                                            <span className={`logs-level-badge ${levelClass}`}>
                                                                                {log.level}
                                                                            </span>
                                                                        </td>
                                                                        <td className="logs-td">{log.module}</td>
                                                                        <td className="logs-td-msg">{log.msg}</td>
                                                                        <td className="logs-td">
                                                                            {canInspect ? (
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn btn-secondary logs-inspect-btn"
                                                                                    onClick={() => setExpandedLogId(isExpanded ? null : logId)}
                                                                                >
                                                                                    {isExpanded ? 'Hide' : 'Inspect'}
                                                                                </button>
                                                                            ) : (
                                                                                <span className="text-muted">-</span>
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                    {isExpanded && canInspect && (
                                                                        <tr className="logs-tr">
                                                                            <td colSpan={5} className="logs-payload-row-td">
                                                                                <div className="logs-payload-container">
                                                                                    <pre className="log-payload-preview">
                                                                                        {JSON.stringify(
                                                                                            hasError ? { error: log.error, payload: log.payload } : log.payload,
                                                                                            null,
                                                                                            2
                                                                                        )}
                                                                                    </pre>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
