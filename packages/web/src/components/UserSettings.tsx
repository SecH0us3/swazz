import React, { useState } from 'react';
import { useAppStore } from '../store/appStore.js';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export function UserSettings() {
    const userProfile = useAppStore(state => state.userProfile);
    const [showKey, setShowKey] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);
    const [copiedCmd, setCopiedCmd] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    const username = userProfile?.username || 'Guest';
    const apiKey = userProfile?.apiKey || '';

    const handleRegenerate = async () => {
        const token = localStorage.getItem('swazz_token');
        if (!token) return;
        if (!confirm('Are you sure you want to regenerate your API key? Any currently running agent runners using the old key will be disconnected.')) {
            return;
        }

        setIsRegenerating(true);
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
        } finally {
            setIsRegenerating(false);
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
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            padding: '24px',
            height: '100%',
            overflowY: 'auto',
            minWidth: 0
        }}>
            {/* Header */}
            <div style={{
                borderBottom: '1px solid var(--border-default)',
                paddingBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: 'var(--text-default)' }}>Settings</h1>
                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>
                        Manage your account details, access tokens, and distributed runner integrations.
                    </p>
                </div>
                <button 
                    className="btn btn-secondary" 
                    onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                    style={{ gap: '6px', display: 'flex', alignItems: 'center' }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                    Back to Dashboard
                </button>
            </div>

            {/* Layout Columns */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '24px',
                alignItems: 'start'
            }}>
                
                {/* Account Details & API Key */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px'
                }}>
                    {/* Profile Card */}
                    <div className="card" style={{
                        backgroundColor: 'var(--bg-elevated)',
                        padding: '20px',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-default)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                    }}>
                        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
                            Account Details
                        </h2>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Username</label>
                            <input 
                                type="text" 
                                className="input" 
                                value={username} 
                                disabled 
                                style={{ width: '100%', opacity: 0.8 }} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Account Level</label>
                            <div style={{
                                padding: '8px 12px',
                                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                border: '1px solid var(--border-default)',
                                borderRadius: 'var(--radius-md)',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: apiKey ? 'var(--accent-light)' : 'var(--text-muted)' }} />
                                {apiKey ? 'Registered User (Unlimited scans)' : 'Guest Mode (Scanning limits active)'}
                            </div>
                        </div>
                    </div>

                    {/* API Token Card */}
                    {apiKey && (
                        <div className="card" style={{
                            backgroundColor: 'var(--bg-elevated)',
                            padding: '20px',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-default)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px'
                        }}>
                            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
                                Access Credentials
                            </h2>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>
                                    API Key / Runner Token
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input 
                                        type={showKey ? 'text' : 'password'} 
                                        className="input" 
                                        value={apiKey} 
                                        disabled 
                                        style={{ flex: 1, opacity: 0.8, fontFamily: 'monospace', fontSize: '13px' }} 
                                    />
                                    <button 
                                        className="btn btn-secondary" 
                                        onClick={() => setShowKey(!showKey)}
                                        style={{ padding: '0 12px' }}
                                    >
                                        {showKey ? 'Hide' : 'Show'}
                                    </button>
                                    <button 
                                        className="btn btn-secondary" 
                                        onClick={() => copyToClipboard(apiKey, setCopiedKey)}
                                        style={{ padding: '0 12px', minWidth: '70px' }}
                                    >
                                        {copiedKey ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                    Use this token to connect your custom runner agent or execute CLI scans.
                                </p>
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'flex-start', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                                <button 
                                    className="btn btn-ghost" 
                                    onClick={handleRegenerate}
                                    disabled={isRegenerating}
                                    style={{ color: 'var(--color-error)' }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                                    </svg>
                                    Regenerate API Key
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Runner Guide Column */}
                {apiKey && (
                    <div className="card" style={{
                        backgroundColor: 'var(--bg-elevated)',
                        padding: '20px',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-default)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px',
                        height: '100%'
                    }}>
                        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
                            Runner Integration
                        </h2>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                            Swazz uses distributed agent runners to execute headless fuzz tests. Connect a private runner on your local workstation or server infrastructure to route scans through secure environments.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{
                                    width: '20px', height: '20px', borderRadius: '50%',
                                    backgroundColor: 'rgba(124,58,237,0.15)', color: 'var(--accent-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '11px', fontWeight: 600, flexShrink: 0
                                }}>1</div>
                                <div style={{ fontSize: '13px' }}>
                                    <strong>Initialize Docker</strong>
                                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Ensure Docker, Containerd, or a Kubernetes node is running locally.</p>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{
                                    width: '20px', height: '20px', borderRadius: '50%',
                                    backgroundColor: 'rgba(124,58,237,0.15)', color: 'var(--accent-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '11px', fontWeight: 600, flexShrink: 0
                                }}>2</div>
                                <div style={{ fontSize: '13px', width: '100%', minWidth: 0 }}>
                                    <strong>Run Agent Command</strong>
                                    <p style={{ margin: '2px 0 8px 0', fontSize: '12px', color: 'var(--text-muted)' }}>Execute this command in your terminal to spin up the official runner image:</p>
                                    
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-default)',
                                        fontFamily: 'monospace',
                                        fontSize: '11px',
                                        color: 'var(--text-default)',
                                        wordBreak: 'break-all',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px'
                                    }}>
                                        <span style={{ color: '#a3a3a3', lineHeight: '1.4' }}>{runCommand}</span>
                                        <button 
                                            className="btn btn-secondary btn-sm" 
                                            onClick={() => copyToClipboard(runCommand, setCopiedCmd)}
                                            style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: '11px' }}
                                        >
                                            {copiedCmd ? '✓ Copied Command!' : 'Copy Command'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{
                                    width: '20px', height: '20px', borderRadius: '50%',
                                    backgroundColor: 'rgba(124,58,237,0.15)', color: 'var(--accent-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '11px', fontWeight: 600, flexShrink: 0
                                }}>3</div>
                                <div style={{ fontSize: '13px' }}>
                                    <strong>Fuzz with Confidence</strong>
                                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                        Once connected, the runner will register under your account and automatically receive scan dispatches.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
