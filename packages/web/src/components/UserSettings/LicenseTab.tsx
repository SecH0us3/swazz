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
    const [licenseKey, setLicenseKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isActivating, setIsActivating] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const fetchStatus = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const token = localStorage.getItem('swazz_token');
            const res = await fetch(`${PROXY_URL}/api/user/license`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP error ${res.status}`);
            }
            const data = await res.json();
            setStatus(data);
            useAppStore.setState({ licenseStatus: data });
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
                headers
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to deactivate license');
            setStatus({ status: 'community', license: null });
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

    return (
        <div className="settings-card">
            <h2 className="settings-card-title">License & Subscription</h2>
            <p className="settings-card-desc">
                Activate a Swazz license key to unlock paid features: high concurrency, scheduled runs,
                report exports, AI remediation, cloud history, and enterprise tools.
            </p>

            {isLoading && <p className="logs-no-data">Loading license status...</p>}

            {!isLoading && status && (
                <div className="license-status-container">
                    {isActive ? (
                        <>
                            <div className="license-status-badge active">
                                <span className="account-status-dot active" />
                                Enterprise License Active
                            </div>
                            <div className="license-info-grid">
                                <div className="license-info-item">
                                    <span className="license-info-label">Company</span>
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
                <label className="settings-form-label">License Key</label>
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
