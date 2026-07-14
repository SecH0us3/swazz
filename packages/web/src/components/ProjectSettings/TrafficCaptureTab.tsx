import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useConfig } from '../../hooks/useConfig.js';

export function TrafficCaptureTab() {
    const activeProject = useAppStore(state => state.activeProject);
    const userProfile = useAppStore(state => state.userProfile);
    const { config } = useConfig();
    const [copiedToken, setCopiedToken] = useState(false);
    const [copiedId, setCopiedId] = useState(false);
    const [syncSuccess, setSyncSuccess] = useState(false);

    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('swazz_token') : null;
    const projectId = activeProject?.id || '';
    const targetUrl = config?.base_url || 'http://localhost:8080';

    const handleCopyToken = () => {
        if (token) {
            navigator.clipboard.writeText(token);
            setCopiedToken(true);
            setTimeout(() => setCopiedToken(false), 2000);
        }
    };

    const handleCopyProjectId = () => {
        if (projectId) {
            navigator.clipboard.writeText(projectId);
            setCopiedId(true);
            setTimeout(() => setCopiedId(false), 2000);
        }
    };

    const handleAutoSync = () => {
        if (token) {
            let parsedProfile = null;
            try {
                const profileStr = localStorage.getItem('swazz:user_profile');
                parsedProfile = profileStr ? JSON.parse(profileStr) : null;
            } catch {}

            window.dispatchEvent(new CustomEvent('swazz-handshake', {
                detail: {
                    token,
                    userProfile: parsedProfile
                }
            }));
            setSyncSuccess(true);
            setTimeout(() => setSyncSuccess(false), 3000);
        }
    };

    return (
        <div className="traffic-capture-container">
            <div className="traffic-capture-grid">
                
                {/* Credentials & Sync Card */}
                <div className="traffic-capture-card">
                    <h2 className="traffic-capture-card-title">
                        Browser Extension Sync
                    </h2>
                    <p className="traffic-capture-desc">
                        Connect the Swazz Traffic Capturer extension with your dashboard session to dynamically record target API calls.
                    </p>

                    <div className="traffic-capture-credentials-list">
                        <div className="traffic-capture-credential-item">
                            <span className="traffic-capture-credential-label">Target Base URL</span>
                            <div className="traffic-capture-credential-value-row">
                                <span className="traffic-capture-credential-value">{targetUrl}</span>
                            </div>
                        </div>

                        <div className="traffic-capture-credential-item">
                            <span className="traffic-capture-credential-label">Active Project ID</span>
                            <div className="traffic-capture-credential-value-row">
                                <span className="traffic-capture-credential-value">{projectId}</span>
                                <button 
                                    className="btn btn-ghost traffic-capture-copy-btn" 
                                    onClick={handleCopyProjectId}
                                >
                                    {copiedId ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                        </div>

                        <div className="traffic-capture-credential-item">
                            <span className="traffic-capture-credential-label">API Session Token</span>
                            <div className="traffic-capture-credential-value-row">
                                <span className="traffic-capture-credential-value">
                                    {token ? '••••••••••••••••••••••••••••••••' : 'No active session'}
                                </span>
                                <button 
                                    className="btn btn-ghost traffic-capture-copy-btn" 
                                    onClick={handleCopyToken}
                                    disabled={!token}
                                >
                                    {copiedToken ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <button 
                        className="btn btn-primary" 
                        onClick={handleAutoSync}
                        disabled={!token}
                    >
                        ⚡ {syncSuccess ? 'Credentials Synced to Extension!' : 'Auto-Sync with Extension'}
                    </button>
                </div>

                {/* Installation & Guide Card */}
                <div className="traffic-capture-card">
                    <h2 className="traffic-capture-card-title">
                        Setup & Installation
                    </h2>
                    
                    <div className="traffic-capture-steps">
                        <div className="traffic-capture-step">
                            <div className="traffic-capture-step-number">1</div>
                            <div className="traffic-capture-step-content">
                                <span className="traffic-capture-step-title">Load unpacked extension</span>
                                <span className="traffic-capture-step-desc">
                                    Open Chrome/Edge settings, go to <strong>chrome://extensions/</strong>, enable <strong>Developer Mode</strong>, and click <strong>Load Unpacked</strong>.
                                </span>
                            </div>
                        </div>

                        <div className="traffic-capture-step">
                            <div className="traffic-capture-step-number">2</div>
                            <div className="traffic-capture-step-content">
                                <span className="traffic-capture-step-title">Select packages/extension folder</span>
                                <span className="traffic-capture-step-desc">
                                    Select the extension directory located at:
                                    <div className="traffic-capture-code-block">
                                        packages/extension
                                    </div>
                                </span>
                            </div>
                        </div>

                        <div className="traffic-capture-step">
                            <div className="traffic-capture-step-number">3</div>
                            <div className="traffic-capture-step-content">
                                <span className="traffic-capture-step-title">Add target domain to scope</span>
                                <span className="traffic-capture-step-desc">
                                    Open the extension popup, turn on recording, and browse your target website.
                                </span>
                            </div>
                        </div>

                        <div className="traffic-capture-step">
                            <div className="traffic-capture-step-number">4</div>
                            <div className="traffic-capture-step-content">
                                <span className="traffic-capture-step-title">Fuzzing Recommendations</span>
                                <span className="traffic-capture-step-desc">
                                    The extension warns you if you send identical payloads, recommending you submit different inputs to help Swazz learn validation rules.
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
