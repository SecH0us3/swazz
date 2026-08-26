// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useTips } from '../../hooks/useTips.js';
import { useToast } from '../../hooks/useToast.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function AccountTab() {
    const userProfile = useAppStore(state => state.userProfile);
    const { mode, setMode } = useTheme();
    const { enabled: tipsEnabled, resetDismissed, setEnabled: setTipsEnabled } = useTips();
    const { showToast } = useToast();

    const [copiedApiKey, setCopiedApiKey] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [newApiKeyToShow, setNewApiKeyToShow] = useState<string | null>(null);
    const [isRegeneratingKey, setIsRegeneratingKey] = useState(false);

    const username = userProfile?.username || 'Guest';
    const apiKey = userProfile?.apiKey || '';

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleRegenerateApiKey = async () => {
        if (!confirm('Are you sure you want to regenerate your API key? This will invalidate your old API key.')) {
            return;
        }
        setIsRegeneratingKey(true);
        try {
            const token = localStorage.getItem('swazz_token');
            const res = await fetch(`${PROXY_URL}/api/auth/regenerate-key`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP error ${res.status}`);
            }
            const data = await res.json();
            setNewApiKeyToShow(data.api_key);
            const profile = useAppStore.getState().userProfile;
            if (profile) {
                useAppStore.setState({
                    userProfile: {
                        ...profile,
                        apiKey: 'swazz_live_' + '•'.repeat(24)
                    }
                });
            }
        } catch (err: any) {
            console.error('Failed to regenerate API key', err);
            alert(err.message || 'Failed to regenerate API key');
        } finally {
            setIsRegeneratingKey(false);
        }
    };

    return (
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
            {apiKey && !userProfile?.isGuest && (
                <div className="settings-form-group">
                    <label className="settings-form-label">Connected Accounts</label>
                    <div className="settings-oauth-link-status">
                        {userProfile?.githubId ? (
                            <div className="oauth-connected-badge">
                                <svg className="github-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3a0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                </svg>
                                <span>Linked with GitHub (ID: {userProfile.githubId})</span>
                            </div>
                        ) : (
                            <button 
                                type="button" 
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    window.location.href = '/api/auth/login/github';
                                }}
                            >
                                <svg className="github-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                                </svg>
                                Link GitHub Account
                            </button>
                        )}

                        {userProfile?.gitlabId ? (
                            <div className="oauth-connected-badge">
                                <svg className="gitlab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3a0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                </svg>
                                <span>Linked with GitLab (ID: {userProfile.gitlabId})</span>
                            </div>
                        ) : (
                            <button 
                                type="button" 
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    window.location.href = '/api/auth/login/gitlab';
                                }}
                            >
                                <svg className="gitlab-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 5.5 2a.43.43 0 0 1 .39.27L8.2 9.49h7.6l2.31-7.22a.43.43 0 0 1 .39-.27.42.42 0 0 1 .39.21l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.94z"/>
                                </svg>
                                Link GitLab Account
                            </button>
                        )}
                    </div>
                </div>
            )}
            <div className="settings-form-group">
                <label className="settings-form-label">Theme Preference</label>
                <div className="theme-selector-group" role="radiogroup" aria-label="Theme Preference">
                    <button
                        type="button"
                        className={`theme-selector-btn ${mode === 'system' ? 'active' : ''}`}
                        onClick={() => setMode('system')}
                        id="btn-theme-system"
                    >
                        System
                    </button>
                    <button
                        type="button"
                        className={`theme-selector-btn ${mode === 'dark' ? 'active' : ''}`}
                        onClick={() => setMode('dark')}
                        id="btn-theme-dark"
                    >
                        Dark
                    </button>
                    <button
                        type="button"
                        className={`theme-selector-btn ${mode === 'light' ? 'active' : ''}`}
                        onClick={() => setMode('light')}
                        id="btn-theme-light"
                    >
                        Light
                    </button>
                </div>
            </div>
            <div className="settings-form-group">
                <label className="settings-form-label">Tip Notifications</label>
                <div className="settings-action-row-left">
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={tipsEnabled}
                            onChange={(e) => setTipsEnabled(e.target.checked)}
                        />
                        <strong className="tips-toggle-label">Show "Did you know" tips</strong>
                    </label>
                </div>
                <div className="settings-action-row-left">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                            resetDismissed();
                            showToast('Dismissed tips reset', 'success');
                        }}
                    >
                        Reset dismissed tips
                    </button>
                </div>
            </div>
            {apiKey && (
                <div className="settings-form-group">
                    <label className="settings-form-label">API Key</label>
                    {newApiKeyToShow ? (
                        <div className="api-key-new-alert">
                            <p className="api-key-new-warning">
                                <strong>Please copy your new API key now.</strong> You won't be able to see it again!
                            </p>
                            <div className="settings-input-row">
                                <input 
                                    type="text" 
                                    className="input settings-input-monospace api-key-highlight" 
                                    value={newApiKeyToShow} 
                                    readOnly 
                                    data-1p-ignore
                                />
                                <button 
                                    className="btn btn-secondary btn-sm settings-btn-min-w"
                                    onClick={() => copyToClipboard(newApiKeyToShow, setCopiedApiKey)}
                                >
                                    {copiedApiKey ? '✓ Copied' : 'Copy'}
                                </button>
                                <button 
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setNewApiKeyToShow(null)}
                                    type="button"
                                    id="btn-dismiss-api-key"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="settings-input-row">
                            <input 
                                type={showApiKey ? 'text' : 'password'} 
                                className="input settings-input-monospace" 
                                value={apiKey} 
                                readOnly 
                                data-1p-ignore
                            />
                            {!apiKey.includes('•') && (
                                <>
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
                                </>
                            )}
                        </div>
                    )}
                    {!userProfile?.isGuest && (
                        <div className="settings-action-row">
                            <button 
                                className="btn btn-danger btn-sm"
                                onClick={handleRegenerateApiKey}
                                disabled={isRegeneratingKey}
                                type="button"
                                id="btn-rotate-api-key"
                            >
                                {isRegeneratingKey ? 'Regenerating...' : 'Regenerate API Key'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
