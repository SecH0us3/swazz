import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useToast } from '../../hooks/useToast.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

interface Runner {
    connectionId: string | null;
    name: string;
    publicKey: string | null;
    status: 'authenticating' | 'connected';
    isMine: boolean;
    isShared: boolean;
    version?: string;
}

interface RunnersTabProps {
    runners: Runner[];
    isLoadingRunners: boolean;
    runnerError: string;
}

export function RunnersTab({ runners, isLoadingRunners, runnerError }: RunnersTabProps) {
    const userProfile = useAppStore(state => state.userProfile);
    const { showToast } = useToast();
    const apiKey = userProfile?.apiKey || '';
    const [restartingId, setRestartingId] = useState<string | null>(null);

    // Registration controls & Guide states
    const [pubKeyInput, setPubKeyInput] = useState(userProfile?.publicKey || '');
    const [isSavingPubKey, setIsSavingPubKey] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [activeRunnerMode, setActiveRunnerMode] = useState<'shared' | 'private'>('private');
    
    const [copiedCmd, setCopiedCmd] = useState(false);
    const [copiedRunCmd, setCopiedRunCmd] = useState(false);
    const [copiedSharedRunCmd, setCopiedSharedRunCmd] = useState(false);
    const [version, setVersion] = useState<string>('<TAG>');

    useEffect(() => {
        if (userProfile?.publicKey) {
            setPubKeyInput(userProfile.publicKey);
        }
    }, [userProfile?.publicKey]);

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

            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            };
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }

            const res = await fetch(`${PROXY_URL}/api/auth/public-key`, {
                method: 'POST',
                headers,
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

    const handleRestartRunner = async (connectionId: string | null) => {
        if (!connectionId) return;
        const token = localStorage.getItem('swazz_token');
        if (!token) return;

        setRestartingId(connectionId);
        try {
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }

            const res = await fetch(`${PROXY_URL}/api/runners/${connectionId}/restart`, {
                method: 'POST',
                headers
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to restart runner');
            }

            showToast('Restart command sent successfully', 'success');
        } catch (err: any) {
            console.error(err);
            showToast(err.message || 'Failed to restart runner', 'error');
        } finally {
            setRestartingId(null);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 1024 * 10) { // Limit to 10KB
            setSaveError('File is too large. Public key files should be under 10KB.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (content) {
                setPubKeyInput(content.trim());
            }
        };
        reader.onerror = () => {
            setSaveError('Failed to read the file.');
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

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
    const runnerImage = `ghcr.io/sech0us3/swazz-cli:latest`;
    const genKeysCmd = `docker run --rm -it -v $(pwd):/app ${runnerImage} generate-keys`;
    const runCommand = `docker run --rm -it -v $(pwd)/swazz_runner.key:/swazz_runner.key ${runnerImage} run-agent --coordinator ${coordinatorHost}/api/runners/connect --key /swazz_runner.key`;
    const sharedRunCommand = `docker run --rm -it ${runnerImage} run-agent --coordinator ${coordinatorHost}/api/runners/connect --token ${apiKey || '<YOUR_API_KEY>'}`;

    return (
        <div className="runners-layout">
            <div className="runners-main-card">
                <div className="runners-header-row">
                    <h2 className="runners-title">
                        Distributed Fuzzing Agents (Runners)
                    </h2>
                    <div className="runners-status-container">
                        <span className="runners-status-badge">
                            <span className="runners-status-dot pulse" />
                            Live Coordinator Status
                        </span>
                    </div>
                </div>

                <p className="runners-desc">
                    View all available agent runner nodes currently connected to the central coordinator. 
                    When you start a scan, the coordinator dispatches fuzz instructions to available agents, prioritizing your own matching signing keys first.
                </p>

                {isLoadingRunners && runners.length === 0 ? (
                    <div className="runners-loading">
                        Loading active runner registry...
                    </div>
                ) : runnerError ? (
                    <div className="runners-error-alert">
                        Error: {runnerError}
                    </div>
                ) : runners.length === 0 ? (
                    <div className="runners-empty-state">
                        <div className="runners-empty-icon">🔌</div>
                        <div className="runners-empty-title">No runners connected</div>
                        <div className="runners-empty-text">
                            Scan coordinator has zero active web socket runners. Register and run a local agent on your machine.
                        </div>
                    </div>
                ) : (
                    <div className="runners-table-container">
                        <table className="runners-table">
                            <thead>
                                <tr className="runners-table-header">
                                    <th className="runners-th">Agent Name</th>
                                    <th className="runners-th">Public Key Hash</th>
                                    <th className="runners-th">Mode</th>
                                    <th className="runners-th">Owner</th>
                                    <th className="runners-th">Status</th>
                                    <th className="runners-th">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {runners.map((r, i) => (
                                    <tr key={r.publicKey || r.name} className={r.isMine ? 'runners-tr-mine' : 'runners-tr-default'}>
                                        <td className="runners-td-bold">
                                            <div className="runners-name-row">
                                                <span className="runner-name">{r.name}</span>
                                                {r.version && (
                                                    <span className="runners-version-badge runner-version-badge">
                                                        {r.version}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="runners-td-mono">
                                            {r.publicKey ? `${r.publicKey.substring(0, 16)}...` : 'Anonymous'}
                                        </td>
                                        <td className="runners-td">
                                            {(r.isShared ?? !r.publicKey) ? (
                                                <span className="runners-mode-badge-shared">Shared</span>
                                            ) : (
                                                <span className="runners-mode-badge-private">Private</span>
                                            )}
                                        </td>
                                        <td className="runners-td">
                                            {r.isMine ? (
                                                <span className="runners-owner-badge-mine">You</span>
                                            ) : (
                                                <span className="runners-owner-badge-shared">Shared Pool</span>
                                            )}
                                        </td>
                                        <td className="runners-td">
                                            <div className="runners-status-cell">
                                                <span className={`runners-status-dot-cell ${r.status === 'connected' ? 'pulse' : ''} ${r.status === 'connected' ? 'runners-status-dot-connected' : 'runners-status-dot-other'}`} />
                                                <span className={`runners-status-text ${r.status === 'connected' ? 'runners-status-text-connected' : 'runners-status-text-other'}`}>{r.status}</span>
                                            </div>
                                        </td>
                                        <td className="runners-td">
                                            {r.isMine && !r.isShared && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => handleRestartRunner(r.connectionId)}
                                                    disabled={restartingId === r.connectionId}
                                                >
                                                    {restartingId === r.connectionId ? 'Restarting...' : 'Restart'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Runner Registration & Integration Controls */}
            {apiKey && (
                <div className="runner-setup-grid">
                    {/* Asymmetric Key Card */}
                    <div className="runner-setup-card">
                        <div className="runner-setup-header">
                            <h2 className="runner-setup-title">
                                Asymmetric Runner Authentication
                            </h2>
                            <span className="runner-setup-badge-rec">Recommended</span>
                        </div>
                        
                        <p className="runner-setup-text-small">
                            For maximum security, register the runner's Ed25519 public key. The runner signs a cryptographic challenge to prove its identity without exposing secrets.
                        </p>

                        <form onSubmit={handleSavePublicKey} className="runner-setup-form">
                            <div>
                                <label className="settings-form-label">
                                    Runner Public Key (64-char hex)
                                </label>
                                <div className="runner-setup-input-container">
                                    <input 
                                        type="text" 
                                        className="input runner-setup-input-mono" 
                                        placeholder="Enter hex-encoded public key (e.g. 9f8a7b...)" 
                                        value={pubKeyInput}
                                        onChange={(e) => setPubKeyInput(e.target.value)}
                                    />
                                    <button 
                                        type="submit" 
                                        className="btn btn-primary runner-setup-btn-min-w" 
                                        disabled={isSavingPubKey}
                                    >
                                        {isSavingPubKey ? 'Saving...' : 'Save'}
                                    </button>
                                </div>
                                <div className="runner-setup-upload-row">
                                    <span className="runner-setup-text-small">Or load:</span>
                                    <input 
                                        type="file" 
                                        id="pubkey-file" 
                                        accept=".pub,text/plain" 
                                        onChange={handleFileUpload} 
                                        style={{ display: 'none' }} 
                                    />
                                    <label 
                                        htmlFor="pubkey-file" 
                                        className="btn btn-secondary btn-sm runner-setup-upload-label"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="17 8 12 3 7 8"></polyline>
                                            <line x1="12" y1="3" x2="12" y2="15"></line>
                                        </svg>
                                        Upload swazz_runner.pub
                                    </label>
                                </div>
                            </div>
                            {saveSuccess && (
                                <p className="runner-setup-success-msg">
                                    ✓ Public key saved successfully!
                                </p>
                            )}
                            {saveError && (
                                <p className="runner-setup-error-msg">
                                    Error: {saveError}
                                </p>
                            )}
                        </form>
                    </div>

                    {/* Runner Guide Card */}
                    <div className="runner-setup-guide-card">
                        <h2 className="runner-setup-guide-title">
                            Runner Integration
                        </h2>
                        <p className="runner-setup-guide-desc">
                            Swazz uses distributed agent runners to execute headless fuzz tests. Connect a private runner on your local workstation or server infrastructure, or contribute compute to the shared community pool.
                        </p>

                        {/* Tab Switcher */}
                        <div className="runner-setup-tab-switcher">
                            <button
                                type="button"
                                className={`runner-setup-tab-btn ${activeRunnerMode === 'private' ? 'active' : ''}`}
                                onClick={() => setActiveRunnerMode('private')}
                            >
                                🔒 Private Runner
                            </button>
                            <button
                                type="button"
                                className={`runner-setup-tab-btn ${activeRunnerMode === 'shared' ? 'active' : ''}`}
                                onClick={() => setActiveRunnerMode('shared')}
                            >
                                🌐 Shared Runner
                            </button>
                        </div>

                        {/* Private Runner Mode Content */}
                        {activeRunnerMode === 'private' && (
                            <>
                                <div className="runner-setup-mode-info-private">
                                    <span style={{ fontSize: '14px' }}>🔒</span>
                                    <span><strong>Private Mode:</strong> Only your own scans will be dispatched to this runner. Requires key-pair registration.</span>
                                </div>

                                <div className="runner-setup-form">
                                    <div className="runner-setup-step-row">
                                        <div className="runner-setup-step-num">1</div>
                                        <div className="runner-setup-step-content">
                                            <strong className="runner-setup-step-title">Generate Cryptographic Keys</strong>
                                            <p className="runner-setup-step-desc">Generate your Ed25519 signature keypair inside your project directory:</p>
                                            
                                            <div className="runner-setup-code-box">
                                                <span className="runner-setup-code-text">{genKeysCmd}</span>
                                                <button 
                                                    className="btn btn-secondary btn-sm runner-setup-code-btn" 
                                                    onClick={() => copyToClipboard(genKeysCmd, setCopiedCmd)}
                                                >
                                                    {copiedCmd ? '✓ Copied Command!' : 'Copy Command'}
                                                </button>
                                            </div>
                                            <p className="runner-setup-step-footer">
                                                This generates `swazz_runner.key` and `swazz_runner.pub` files. Keep the `.key` private!
                                            </p>
                                        </div>
                                    </div>

                                    <div className="runner-setup-step-row">
                                        <div className="runner-setup-step-num">2</div>
                                        <div className="runner-setup-step-content">
                                            <strong className="runner-setup-step-title">Register Public Key</strong>
                                            <p className="runner-setup-step-desc">
                                                Copy the hex string from `swazz_runner.pub` and paste it into the **Asymmetric Runner Authentication** form on the left, or use the "Upload" button to load it from file.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="runner-setup-step-row">
                                        <div className="runner-setup-step-num">3</div>
                                        <div className="runner-setup-step-content">
                                            <strong className="runner-setup-step-title">Run Agent Command</strong>
                                            <p className="runner-setup-step-desc">Start the runner, mounting the generated private key file:</p>
                                            
                                            <div className="runner-setup-code-box">
                                                <span className="runner-setup-code-text">{runCommand}</span>
                                                <button 
                                                    className="btn btn-secondary btn-sm runner-setup-code-btn" 
                                                    onClick={() => copyToClipboard(runCommand, setCopiedRunCmd)}
                                                >
                                                    {copiedRunCmd ? '✓ Copied Command!' : 'Copy Command'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Shared Runner Mode Content */}
                        {activeRunnerMode === 'shared' && (
                            <>
                                <div className="runner-setup-mode-info-shared">
                                    <span style={{ fontSize: '14px' }}>🌐</span>
                                    <span><strong>Shared Mode:</strong> Jobs from all users on this coordinator may run on this machine.</span>
                                </div>

                                <div className="runner-setup-security-warning">
                                    <div className="runner-setup-warning-title">
                                        ⚠️ Critical Security Warning
                                    </div>
                                    <div>By registering a shared runner, you agree to execute fuzzing jobs on behalf of other platform users. Only run this on an isolated, containerised environment. Do NOT run shared agents on your personal development workstation.</div>
                                </div>

                                <div className="runner-setup-form">
                                    <div className="runner-setup-step-row">
                                        <div className="runner-setup-step-content">
                                            <strong className="runner-setup-step-title">Run Agent Command</strong>
                                            <p className="runner-setup-step-desc">Start the runner in shared pool mode using your API Key:</p>
                                            
                                            <div className="runner-setup-code-box">
                                                <span className="runner-setup-code-text">{sharedRunCommand}</span>
                                                <button 
                                                    className="btn btn-secondary btn-sm runner-setup-code-btn" 
                                                    onClick={() => copyToClipboard(sharedRunCommand, setCopiedSharedRunCmd)}
                                                >
                                                    {copiedSharedRunCmd ? '✓ Copied Command!' : 'Copy Command'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
