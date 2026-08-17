// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store/appStore.js';
import type { LicenseStatus } from '../../utils/license.js';
import { getFeatureLabel } from '@swazz/shared';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function LicenseTab() {
    const userProfile = useAppStore(state => state.userProfile);
    const [status, setStatus] = useState<LicenseStatus | null>(null);
    const [trialStatus, setTrialStatus] = useState<{ claimed: boolean; claimed_at: string | null } | null>(null);
    const [licenseKey, setLicenseKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isActivating, setIsActivating] = useState(false);
    const [isClaimingTrial, setIsClaimingTrial] = useState(false);
    const [claimedToken, setClaimedToken] = useState<string | null>(null);
    const [copiedToken, setCopiedToken] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const fetchStatus = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const token = localStorage.getItem('swazz_token');
            const [licRes, trialRes] = await Promise.all([
                fetch(`${PROXY_URL}/api/user/license`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    credentials: 'include',
                }),
                fetch(`${PROXY_URL}/api/user/trial-status`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    credentials: 'include',
                })
            ]);

            if (!licRes.ok) {
                const errData = await licRes.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP error ${licRes.status}`);
            }
            const licData = await licRes.json();
            setStatus(licData);
            useAppStore.setState({ licenseStatus: licData });

            if (trialRes.ok) {
                const trialData = await trialRes.json();
                setTrialStatus(trialData);
            }
        } catch (err: any) {
            console.error('Failed to fetch license status', err);
            setError(err.message || 'Failed to fetch license status');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (userProfile && !userProfile.isGuest) {
            fetchStatus();
        }
    }, [userProfile, fetchStatus]);

    const handleActivate = async (e: React.FormEvent) => {
        e.preventDefault();
        let cleanKey = licenseKey.trim();
        if (cleanKey.includes('SWAZZ_LICENSE_KEY:')) {
            cleanKey = cleanKey.split('SWAZZ_LICENSE_KEY:')[1].trim();
        }
        const lines = cleanKey.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (line.startsWith('eyJ') && line.split('.').length === 3) {
                cleanKey = line;
                break;
            }
        }
        if (!cleanKey) return;
        setIsActivating(true);
        setError('');
        setSuccess('');
        try {
            const token = localStorage.getItem('swazz_token');
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            const res = await fetch(`${PROXY_URL}/api/user/license`, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify({ license_key: cleanKey })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to activate license');
            setStatus({ status: 'active', license: data.license });
            useAppStore.setState({ licenseStatus: { status: 'active', license: data.license } });
            setLicenseKey('');
            setSuccess(`License activated for ${data.license.company}!`);
        } catch (err: any) {
            setError(err.message || 'Failed to activate license');
        } finally {
            setIsActivating(false);
        }
    };

    const handleClaimTrial = async () => {
        setIsClaimingTrial(true);
        setError('');
        setSuccess('');
        try {
            const token = localStorage.getItem('swazz_token');
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            const res = await fetch(`${PROXY_URL}/api/user/trial-license`, {
                method: 'POST',
                headers,
                credentials: 'include',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to claim trial license');
            setStatus({ status: 'active', license: data.license });
            setTrialStatus({ claimed: true, claimed_at: new Date().toISOString() });
            if (data.token) {
                setClaimedToken(data.token);
            }
            useAppStore.setState({ licenseStatus: { status: 'active', license: data.license } });
            setSuccess('14-day free trial license activated successfully!');
        } catch (err: any) {
            setError(err.message || 'Failed to claim trial license');
        } finally {
            setIsClaimingTrial(false);
        }
    };

    const handleCopyToken = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedToken(true);
        setTimeout(() => setCopiedToken(false), 2000);
    };

    const handleDeactivate = async () => {
        if (!confirm('Deactivate this license key? Paid features will be locked.')) return;
        setIsActivating(true);
        setError('');
        setSuccess('');
        try {
            const token = localStorage.getItem('swazz_token');
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            const res = await fetch(`${PROXY_URL}/api/user/license`, {
                method: 'DELETE',
                headers,
                credentials: 'include',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to deactivate license');
            setStatus({ status: 'community', license: null });
            setClaimedToken(null);
            useAppStore.setState({ licenseStatus: { status: 'community', license: null } });
            setSuccess('License deactivated.');
        } catch (err: any) {
            setError(err.message || 'Failed to deactivate license');
        } finally {
            setIsActivating(false);
        }
    };

    if (userProfile?.isGuest) {
        return (
            <div className="settings-card">
                <h2 className="settings-card-title">License & Subscription</h2>
                <p className="settings-danger-text">License management is only available for registered users.</p>
            </div>
        );
    }

    const isActive = status?.status === 'active' && status.license;
    const remainingDays = status?.license?.expires_at
        ? Math.max(0, Math.ceil((new Date(status.license.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : null;
    const isTrialLicense = (trialStatus?.claimed && isActive) ||
        (Boolean(status?.license?.company) && (
            status!.license!.company.endsWith('(14-Day Trial)') ||
            status!.license!.company === 'Swazz Trial User'
        ));

    return (
        <div className="settings-card">
            <h2 className="settings-card-title">License & Subscription</h2>
            <p className="settings-card-desc">
                Activate a Swazz license key to unlock paid features: high concurrency, scheduled runs,
                report exports, AI remediation, cloud history, and enterprise tools.
            </p>

            {isLoading && <p className="logs-no-data">Loading license status...</p>}

            {!isLoading && !isActive && !trialStatus?.claimed && (
                <div className="trial-claim-card">
                    <div className="trial-claim-header">
                        <div className="trial-claim-title-group">
                            <span className="trial-claim-icon">🚀</span>
                            <div>
                                <h3 className="trial-claim-title">14-Day Free Trial</h3>
                                <p className="trial-claim-subtitle">
                                    Evaluate full enterprise capabilities: high concurrency, scheduled runs, report exports, and AI remediation.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleClaimTrial}
                            disabled={isClaimingTrial}
                        >
                            {isClaimingTrial ? 'Activating Trial...' : 'Claim 14-Day Free Trial'}
                        </button>
                    </div>
                </div>
            )}

            {!isLoading && !isActive && trialStatus?.claimed && (
                <div className="trial-used-notice">
                    ✓ 14-Day Free Trial has already been claimed for this account.
                </div>
            )}

            {!isLoading && status && (
                <div className="license-status-container">
                    {isActive ? (
                        <>
                            <div className="settings-flex-row settings-flex-between">
                                <div className="license-status-badge active">
                                    <span className="account-status-dot active" />
                                    {isTrialLicense ? 'Trial License Active' : 'Enterprise License Active'}
                                </div>
                                {remainingDays !== null && (
                                    <span className="trial-days-badge">
                                        {remainingDays} day{remainingDays === 1 ? '' : 's'} remaining
                                    </span>
                                )}
                            </div>
                            <div className="license-info-grid">
                                <div className="license-info-item">
                                    <span className="license-info-label">Company / Account</span>
                                    <span className="license-info-value">{status.license!.company}</span>
                                </div>
                                <div className="license-info-item">
                                    <span className="license-info-label">Expires</span>
                                    <span className="license-info-value">
                                        {new Date(status.license!.expires_at).toLocaleDateString()}
                                    </span>
                                </div>
                                {status.license!.max_concurrency ? (
                                    <div className="license-info-item">
                                        <span className="license-info-label">Max Concurrency</span>
                                        <span className="license-info-value">{status.license!.max_concurrency}</span>
                                    </div>
                                ) : null}
                            </div>
                            <div className="license-features-list">
                                {status.license!.features.map((f) => (
                                    <span key={f} className="license-feature-badge">
                                        {getFeatureLabel(f)}
                                    </span>
                                ))}
                            </div>

                            {claimedToken && (
                                <div className="trial-token-box">
                                    <div className="trial-token-header">
                                        <span className="trial-token-label">License Key (Runner CLI)</span>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleCopyToken(claimedToken)}
                                        >
                                            {copiedToken ? '✓ Copied' : 'Copy Key'}
                                        </button>
                                    </div>
                                    <div className="trial-token-content">{claimedToken}</div>
                                    <p className="trial-instructions">
                                        Pass to CLI runner: <code>export SWAZZ_LICENSE_KEY=&quot;{claimedToken.slice(0, 24)}...&quot;</code>
                                    </p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="license-status-badge inactive">
                            <span className="account-status-dot inactive" />
                            {status.status === 'invalid' ? 'License Invalid' : 'Community (Free) Mode'}
                        </div>
                    )}
                </div>
            )}

            {error && <div className="two-factor-error-alert">{error}</div>}
            {success && <div className="two-factor-success-alert">{success}</div>}

            {isActive && (
                <div className="settings-action-row">
                    <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={handleDeactivate}
                        disabled={isActivating}
                    >
                        {isActivating ? 'Deactivating...' : 'Deactivate License'}
                    </button>
                </div>
            )}

            <form onSubmit={handleActivate} className="settings-form-group">
                <label className="settings-form-label">Commercial License Key</label>
                <div className="settings-input-row">
                    <input
                        type="text"
                        className="input settings-input-monospace"
                        value={licenseKey}
                        onChange={(e) => setLicenseKey(e.target.value)}
                        placeholder="Paste your SWAZZ_LICENSE_KEY here"
                        data-1p-ignore
                    />
                    <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={isActivating || !licenseKey.trim()}
                    >
                        {isActivating ? 'Activating...' : 'Activate'}
                    </button>
                </div>
            </form>
        </div>
    );
}
