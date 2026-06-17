import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export function UserSettings() {
    const userProfile = useAppStore(state => state.userProfile);
    const [copiedCmd, setCopiedCmd] = useState(false);
    const [copiedRunCmd, setCopiedRunCmd] = useState(false);

    const [pubKeyInput, setPubKeyInput] = useState(userProfile?.publicKey || '');
    const [isSavingPubKey, setIsSavingPubKey] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState('');

    useEffect(() => {
        if (userProfile?.publicKey) {
            setPubKeyInput(userProfile.publicKey);
        }
    }, [userProfile?.publicKey]);

    const username = userProfile?.username || 'Guest';
    const apiKey = userProfile?.apiKey || '';

    const handleSavePublicKey = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = localStorage.getItem('swazz_token');
        if (!token) return;

        setIsSavingPubKey(true);
        setSaveSuccess(false);
        setSaveError('');

        try {
            const cleanKey = pubKeyInput.trim();
            if (cleanKey !== '') {
                const hexRegex = /^[0-9a-fA-F]{64}$/;
                if (!hexRegex.test(cleanKey)) {
                    throw new Error('Invalid public key format. Must be a 64-character hex-encoded string.');
                }
            }

            const res = await fetch(`${PROXY_URL}/api/auth/public-key`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ public_key: cleanKey || null })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to update public key');
            }

            const data = await res.json();
            useAppStore.setState(state => ({
                userProfile: state.userProfile ? { ...state.userProfile, publicKey: data.public_key } : null
            }));

            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            console.error(err);
            setSaveError(err.message || 'Failed to save public key');
        } finally {
            setIsSavingPubKey(false);
        }
    };

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const [version, setVersion] = useState<string>('<TAG>');

    useEffect(() => {
        fetch('/api/version')
            .then(res => res.json())
            .then(data => {
                if (data.version && data.version !== 'dev') {
                    setVersion(data.version);
                }
            })
            .catch(() => {});
    }, []);

    const getOrigin = (url: string) => {
        if (!url) return window.location.origin;
        try {
            return url.startsWith('http') ? new URL(url).origin : window.location.origin;
        } catch (e) {
            return window.location.origin;
        }
    };
    const apiBase = getOrigin(PROXY_URL);
    const coordinatorHost = apiBase.replace(/^http/, 'ws');
    const runnerImage = `ghcr.io/sech0us3/swazz-cli:${version}`;
    const genKeysCmd = `docker run --rm -it -v $(pwd):/app ${runnerImage} generate-keys`;
    const runCommand = `docker run --rm -it -v $(pwd)/swazz_runner.key:/swazz_runner.key ${runnerImage} run-agent --coordinator ${coordinatorHost}/api/runners/connect --key /swazz_runner.key`;

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
                        Manage your account details, asymmetric signing keys, and distributed runner integrations.
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
                
                {/* Account Details & Auth Key Configuration */}
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

                    {/* Asymmetric Key Card */}
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px' }}>
                                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                                    Asymmetric Runner Authentication
                                </h2>
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    color: 'var(--accent-light)',
                                    backgroundColor: 'rgba(124, 58, 237, 0.15)',
                                    padding: '2px 8px',
                                    borderRadius: '12px'
                                }}>Recommended</span>
                            </div>
                            
                            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                For maximum security, register the runner's Ed25519 public key. The runner signs a cryptographic challenge to prove its identity without exposing secrets.
                            </p>

                            <form onSubmit={handleSavePublicKey} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>
                                        Runner Public Key (64-char hex)
                                    </label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input 
                                            type="text" 
                                            className="input" 
                                            placeholder="Enter hex-encoded public key (e.g. 9f8a7b...)" 
                                            value={pubKeyInput}
                                            onChange={(e) => setPubKeyInput(e.target.value)}
                                            style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }} 
                                        />
                                        <button 
                                            type="submit" 
                                            className="btn btn-primary" 
                                            disabled={isSavingPubKey}
                                            style={{ minWidth: '80px' }}
                                        >
                                            {isSavingPubKey ? 'Saving...' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                                {saveSuccess && (
                                    <p style={{ margin: 0, fontSize: '12px', color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        ✓ Public key saved successfully!
                                    </p>
                                )}
                                {saveError && (
                                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
                                        Error: {saveError}
                                    </p>
                                )}
                            </form>
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
                                <div style={{ fontSize: '13px', width: '100%', minWidth: 0 }}>
                                    <strong>Generate Cryptographic Keys</strong>
                                    <p style={{ margin: '2px 0 8px 0', fontSize: '12px', color: 'var(--text-muted)' }}>Generate your Ed25519 signature keypair inside your project directory:</p>
                                    
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
                                        <span style={{ color: '#a3a3a3', lineHeight: '1.4' }}>{genKeysCmd}</span>
                                        <button 
                                            className="btn btn-secondary btn-sm" 
                                            onClick={() => copyToClipboard(genKeysCmd, setCopiedCmd)}
                                            style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: '11px' }}
                                        >
                                            {copiedCmd ? '✓ Copied Command!' : 'Copy Command'}
                                        </button>
                                    </div>
                                    <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                        This generates `swazz_runner.key` and `swazz_runner.pub` files. Keep the `.key` private!
                                    </p>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{
                                    width: '20px', height: '20px', borderRadius: '50%',
                                    backgroundColor: 'rgba(124,58,237,0.15)', color: 'var(--accent-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '11px', fontWeight: 600, flexShrink: 0
                                }}>2</div>
                                <div style={{ fontSize: '13px' }}>
                                    <strong>Register Public Key</strong>
                                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                        Copy the hex string from `swazz_runner.pub` and paste it into the **Asymmetric Runner Authentication** form on the left, then click Save.
                                    </p>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{
                                    width: '20px', height: '20px', borderRadius: '50%',
                                    backgroundColor: 'rgba(124,58,237,0.15)', color: 'var(--accent-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '11px', fontWeight: 600, flexShrink: 0
                                }}>3</div>
                                <div style={{ fontSize: '13px', width: '100%', minWidth: 0 }}>
                                    <strong>Run Agent Command</strong>
                                    <p style={{ margin: '2px 0 8px 0', fontSize: '12px', color: 'var(--text-muted)' }}>Start the runner, mounting the generated private key file:</p>
                                    
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
                                            onClick={() => copyToClipboard(runCommand, setCopiedRunCmd)}
                                            style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: '11px' }}
                                        >
                                            {copiedRunCmd ? '✓ Copied Command!' : 'Copy Command'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
