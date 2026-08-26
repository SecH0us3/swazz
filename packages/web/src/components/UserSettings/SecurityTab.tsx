// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useAppStore } from '../../store/appStore.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function SecurityTab() {
    const userProfile = useAppStore(state => state.userProfile);
    const apiKey = userProfile?.apiKey || '';

    const [twoFactorEnabled, setTwoFactorEnabled] = useState(userProfile?.twoFactorEnabled || false);
    const [setup2faData, setSetup2faData] = useState<{ secret: string; otpauth_url: string } | null>(null);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [setupError, setSetupError] = useState('');
    const [setupSuccess, setSetupSuccess] = useState('');
    const [is2faLoading, setIs2faLoading] = useState(false);

    const [passkeys, setPasskeys] = useState<any[]>([]);
    const [passkeysLoading, setPasskeysLoading] = useState(false);
    const [passkeysError, setPasskeysError] = useState('');

    useEffect(() => {
        if (userProfile) {
            setTwoFactorEnabled(!!userProfile.twoFactorEnabled);
        }
    }, [userProfile]);

    useEffect(() => {
        if (userProfile && !userProfile.isGuest) {
            fetchPasskeys();
        }
    }, [userProfile]);

    const fetchPasskeys = async () => {
        setPasskeysLoading(true);
        try {
            const token = localStorage.getItem('swazz_token');
            const res = await fetch(`${PROXY_URL}/api/auth/passkeys`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setPasskeys(Array.isArray(data?.credentials) ? data.credentials : (Array.isArray(data) ? data : []));
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

    if (!apiKey || userProfile?.isGuest) {
        return (
            <div className="settings-card">
                <h2 className="settings-card-title">Security Settings</h2>
                <p className="settings-danger-text">Two-factor authentication is only available for registered users. Guests cannot enable 2FA.</p>
            </div>
        );
    }

    return (
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
    );
}
