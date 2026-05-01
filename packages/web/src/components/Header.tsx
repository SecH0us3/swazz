import React, { useState, useEffect } from 'react';

interface Props {
    baseUrl: string;
    onChangeBaseUrl?: (url: string) => void;
    isRunning: boolean;
    isPaused: boolean;
    isLoadingSpecs?: boolean;
    onStart: () => void;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
    onToggleSidebar?: () => void;
    onToggleConfig?: () => void;
}

export function Header({
    baseUrl,
    onChangeBaseUrl,
    isRunning,
    isPaused,
    isLoadingSpecs,
    onStart,
    onStop,
    onPause,
    onResume,
    onToggleSidebar,
    onToggleConfig,
}: Props) {
    const [localUrl, setLocalUrl] = useState(baseUrl);

    useEffect(() => {
        setLocalUrl(baseUrl);
    }, [baseUrl]);

    const handleUrlCommit = (val: string) => {
        let cleanUrl = val.trim();
        if (!cleanUrl) {
            if (onChangeBaseUrl) onChangeBaseUrl('');
            setLocalUrl('');
            return;
        }
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://') && !cleanUrl.includes('localhost')) {
            cleanUrl = `https://${cleanUrl}`;
        }
        setLocalUrl(cleanUrl);
        if (onChangeBaseUrl && cleanUrl !== baseUrl) {
            onChangeBaseUrl(cleanUrl);
        }
    };

    return (
        <header className="header">
            {/* Top Row: Logo, Status, Actions, Toggles */}
            <div className="header-top-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {/* Left Toggle (Mobile) */}
                    <button className="header-mobile-toggle" onClick={onToggleSidebar} title="Menu" aria-label="Toggle Menu">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
                        </svg>
                    </button>

                    {/* Logo */}
                    <div className="header-logo">
                        <div className="header-logo-icon">⚡</div>
                        <span className="header-logo-text">swazz</span>
                    </div>

                    <a href="https://github.com/SecH0us3/swazz" target="_blank" rel="noopener noreferrer" className="header-github-link" title="GitHub Repository">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.699-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.03-2.682-.103-.253-.447-1.27.098-2.646 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.376.202 2.394.1 2.646.64.699 1.026 1.591 1.026 2.682 0 3.841-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" />
                        </svg>
                    </a>

                    <div className="header-divider" />

                    {/* Running status pill */}
                    {isRunning && (
                        <div className={`header-status${isLoadingSpecs ? ' loading' : isPaused ? ' paused' : ''}`}>
                            {isLoadingSpecs ? (
                                <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation:'spin 1s linear infinite' }}>
                                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                                    </svg>
                                    Loading specs…
                                </>
                            ) : isPaused ? (
                                <>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                                    </svg>
                                    Paused
                                </>
                            ) : (
                                <>
                                    <span className="running-dot" />
                                    Running
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {/* Actions */}
                    <div className="header-actions">
                        {!isRunning ? (
                            <button className="btn btn-primary" id="btn-start" onClick={onStart}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5,3 19,12 5,21"/>
                                </svg>
                                <span>Run Fuzz Test</span>
                            </button>
                        ) : (
                            <>
                                {!isLoadingSpecs && (
                                    isPaused ? (
                                        <button className="btn btn-success" onClick={onResume} title="Resume">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                                <polygon points="5,3 19,12 5,21"/>
                                            </svg>
                                            <span className="desktop-only">Resume</span>
                                        </button>
                                    ) : (
                                        <button className="btn btn-ghost" onClick={onPause} title="Pause">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                                            </svg>
                                            <span className="desktop-only">Pause</span>
                                        </button>
                                    )
                                )}
                                <button className="btn btn-danger" onClick={onStop} title="Stop">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    </svg>
                                    <span className="desktop-only">Stop</span>
                                </button>
                            </>
                        )}
                    </div>

                    {/* Right Toggle (Mobile) */}
                    <button className="header-mobile-toggle" onClick={onToggleConfig} title="Settings" aria-label="Toggle Settings">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                        </svg>
                    </button>
                </div>
            </div>

            {/* Bottom Row: URL Bar (100% Width) */}
            {baseUrl !== undefined && (
                <div className="header-url-bar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                    </svg>
                    <input
                        className="header-target-input"
                        value={localUrl}
                        aria-label="Target API URL"
                        onChange={(e) => setLocalUrl(e.target.value)}
                        onBlur={() => handleUrlCommit(localUrl)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleUrlCommit(localUrl);
                                e.currentTarget.blur();
                            }
                        }}
                        placeholder="https://api.example.com"
                        readOnly={!onChangeBaseUrl}
                    />
                    {isRunning && !isLoadingSpecs && (
                        <span
                            style={{ width:6, height:6, borderRadius:'50%', background:'var(--color-success)', flexShrink:0, boxShadow:'0 0 6px var(--color-success)', animation:'pulse-success 1.5s infinite' }}
                        />
                    )}
                </div>
            )}
            {isRunning && !isLoadingSpecs && (
                <div style={{ height: '2px', width: '100%', background: 'var(--bg-surface)', overflow: 'hidden', position: 'absolute', bottom: 0, left: 0 }}>
                    <div style={{ width: '30%', height: '100%', background: 'var(--color-success)', animation: 'progress-indeterminate 1.5s infinite linear', transformOrigin: '0% 50%' }} />
                </div>
            )}
            <style>
                {`
                @keyframes progress-indeterminate {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(400%); }
                }
                `}
            </style>
        </header>
    );
}
