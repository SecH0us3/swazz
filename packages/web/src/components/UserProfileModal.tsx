import React, { useState } from 'react';
import { useAppStore } from '../store/appStore.js';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export function UserProfileModal() {
    const isUserProfileOpen = useAppStore(state => state.isUserProfileOpen);
    const userProfile = useAppStore(state => state.userProfile);
    const close = () => useAppStore.setState({ isUserProfileOpen: false });

    const [showKey, setShowKey] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);
    const [copiedCmd, setCopiedCmd] = useState(false);

    if (!isUserProfileOpen) return null;

    const username = userProfile?.username || 'Guest';
    const apiKey = userProfile?.apiKey || '';

    const handleRegenerate = async () => {
        const token = localStorage.getItem('swazz_token');
        if (!token) return;
        try {
            const res = await fetch(`${PROXY_URL}/api/auth/regenerate-key`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to regenerate API key');
            const data = await res.json();
            useAppStore.setState(state => ({
                userProfile: state.userProfile ? { ...state.userProfile, apiKey: data.api_key } : null
            }));
        } catch (err) {
            console.error(err);
            alert('Failed to regenerate key');
        }
    };

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const coordinatorHost = window.location.origin.replace('http', 'ws');
    const runCommand = `docker run --rm -it ghcr.io/sech0us3/swazz-runner run-agent --coordinator ${coordinatorHost}/api/runners/connect --token ${apiKey || '<YOUR_API_KEY>'}`;

    return (
        <div className="modal-overlay" onClick={close} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{
                backgroundColor: 'var(--bg-elevated)',
                padding: '24px',
                borderRadius: 'var(--radius-lg)',
                width: '450px',
                maxWidth: '95vw',
                border: '1px solid var(--border-default)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, fontSize: '18px' }}>User Settings</h2>
                    <button className="btn btn-ghost btn-icon" onClick={close}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Username</label>
                    <input type="text" className="input" value={username} disabled style={{ width: '100%', opacity: 0.7 }} />
                </div>

                {apiKey && (
                    <>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>API Key / Runner Token</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input 
                                    type={showKey ? 'text' : 'password'} 
                                    className="input" 
                                    value={apiKey} 
                                    disabled 
                                    style={{ flex: 1, opacity: 0.7, fontFamily: 'monospace' }} 
                                />
                                <button 
                                    className="btn btn-secondary" 
                                    onClick={() => setShowKey(!showKey)}
                                    style={{ padding: '8px 12px' }}
                                >
                                    {showKey ? 'Hide' : 'Show'}
                                </button>
                                <button 
                                    className="btn btn-secondary" 
                                    onClick={() => copyToClipboard(apiKey, setCopiedKey)}
                                    style={{ padding: '8px 12px' }}
                                >
                                    {copiedKey ? 'Copied!' : 'Copy'}
                                </button>
                                <button className="btn btn-secondary" onClick={handleRegenerate}>Regenerate</button>
                            </div>
                            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                Use this key to authenticate your custom fuzzer runner.
                            </p>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Run Your Own Fuzzer Runner</label>
                            <div style={{
                                padding: '12px',
                                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-default)',
                                fontFamily: 'monospace',
                                fontSize: '11px',
                                color: 'var(--text-default)',
                                wordBreak: 'break-all',
                                position: 'relative',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px'
                            }}>
                                <span style={{ color: '#9ca3af' }}>{runCommand}</span>
                                <button 
                                    className="btn btn-secondary" 
                                    onClick={() => copyToClipboard(runCommand, setCopiedCmd)}
                                    style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: '11px' }}
                                >
                                    {copiedCmd ? 'Copied Command!' : 'Copy Command'}
                                </button>
                            </div>
                        </div>
                    </>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                    <button className="btn btn-primary" onClick={close}>Done</button>
                </div>
            </div>
        </div>
    );
}
