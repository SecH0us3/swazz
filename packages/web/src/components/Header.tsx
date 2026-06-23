import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useShallow } from 'zustand/react/shallow';
import { UserMenu } from './UserMenu.js';

interface Props {
    baseUrl: string;
    onChangeBaseUrl?: (url: string) => void;
    onStart: (cleanUrl?: string) => void;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
    onToggleSidebar?: () => void;
    onToggleConfig?: () => void;
    theme: 'dark' | 'light';
    onToggleTheme: () => void;
    authEnabled?: boolean;
    token?: string | null;
    isGuest?: boolean;
    onLogout?: () => void;
}

export function Header({
    baseUrl,
    onChangeBaseUrl,
    onStart,
    onStop,
    onPause,
    onResume,
    onToggleSidebar,
    onToggleConfig,
    theme,
    onToggleTheme,
    authEnabled = false,
    token = null,
    isGuest = false,
    onLogout,
}: Props) {
    const { isRunning, isPaused, isLoadingSpecs } = useAppStore(useShallow(state => ({
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        isLoadingSpecs: state.isLoadingSpecs,
    })));

    const isBusy = isRunning || isLoadingSpecs;

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
        
        try {
            const u = new URL(cleanUrl);
            cleanUrl = u.origin;
        } catch {
            // Not a full URL, leave as is
        }

        setLocalUrl(cleanUrl);
        if (onChangeBaseUrl && cleanUrl !== baseUrl) {
            onChangeBaseUrl(cleanUrl);
        }
    };

    const handleStartClick = () => {
        let cleanUrl = localUrl.trim();
        if (cleanUrl) {
            try {
                const u = new URL(cleanUrl);
                cleanUrl = u.origin;
            } catch {
                // Not a full URL, leave as is
            }
        }
        if (onChangeBaseUrl) {
            onChangeBaseUrl(cleanUrl);
        }
        onStart(cleanUrl);
    };

    return (
        <header className="header">
            {/* Left Section: Logo, Status, Toggles */}
            <div className="header-left">
                {/* Left Toggle (Mobile) */}
                <button className="header-mobile-toggle" onClick={onToggleSidebar} title="Menu" aria-label="Toggle Menu">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>

                <div 
                    className="header-logo" 
                    onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                    style={{ cursor: 'pointer' }}
                >
                    <div className="header-logo-icon">⚡</div>
                    <span className="header-logo-text">swazz</span>
                </div>

                <a href="https://github.com/SecH0us3/swazz" target="_blank" rel="noopener noreferrer" className="header-github-link" title="GitHub Repository">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                    </svg>
                </a>

                <a href="https://SecH0us3.github.io/swazz/" target="_blank" rel="noopener noreferrer" className="header-docs-link" title="Documentation">
                    <span>docs</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </a>

                <button 
                    className="header-docs-link header-hotkeys-btn" 
                    title="Keyboard Shortcuts (?)" 
                    onClick={() => useAppStore.setState({ isHotkeysHelpOpen: true })}
                >
                    <span>keys</span>
                    <kbd className="header-hotkeys-kbd">?</kbd>
                </button>

                <div className="header-divider" />

                {/* Running status pill */}
                {isBusy && (
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

            {/* Middle Section: URL Bar (Centered if screen width allows) */}
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
                    {isBusy && !isLoadingSpecs && (
                        <span
                            style={{ width:6, height:6, borderRadius:'50%', background:'var(--color-success)', flexShrink:0, boxShadow:'0 0 6px var(--color-success)', animation:'pulse-success 1.5s infinite' }}
                        />
                    )}
                </div>
            )}

            {/* Right Section: Actions, Toggles */}
            <div className="header-right">


                {/* Actions */}
                <div className="header-actions">
                    {!isBusy ? (
                        <button className="btn btn-primary" id="btn-start" onClick={handleStartClick}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5,3 19,12 5,21"/>
                            </svg>
                            <span>Run</span>
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

                {/* Theme Toggle */}
                <button className="btn btn-ghost btn-icon" onClick={onToggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label="Toggle Theme">
                    {theme === 'dark' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.07" x2="5.64" y2="17.66"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                        </svg>
                    )}
                </button>

                {authEnabled && token && (
                    <UserMenu onLogout={onLogout || (() => {})} />
                )}

                {authEnabled && isGuest && (
                    <>
                        <span className="guest-badge" title="Temporary guest account. Data is automatically deleted after 24 hours.">
                            Guest Mode
                        </span>
                        <button 
                            className="btn btn-primary sign-up-btn" 
                            onClick={onLogout} 
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="8.5" cy="7" r="4"></circle>
                                <line x1="20" y1="8" x2="20" y2="14"></line>
                                <line x1="23" y1="11" x2="17" y2="11"></line>
                            </svg>
                            <span className="sign-up-text">Sign Up</span>
                        </button>
                    </>
                )}

                {/* Right Toggle (Mobile) */}
                <button className="header-mobile-toggle" onClick={onToggleConfig} title="Settings" aria-label="Toggle Settings">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                    </svg>
                </button>
            </div>

            {isBusy && !isLoadingSpecs && (
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
