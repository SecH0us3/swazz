import React from 'react';

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
}: Props) {
    return (
        <header className="header">
            {/* Logo */}
            <div className="header-logo">
                <div className="header-logo-icon">⚡</div>
                <span className="header-logo-text">swazz</span>
            </div>

            <div className="header-divider" />

            {/* URL Bar */}
            {baseUrl !== undefined && (
                <div className="header-url-bar">
                    {/* Globe icon */}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                    </svg>
                    <input
                        className="header-target-input"
                        value={baseUrl}
                        onChange={(e) => onChangeBaseUrl?.(e.target.value)}
                        placeholder="https://api.example.com"
                        readOnly={!onChangeBaseUrl}
                    />
                    {/* Live status dot */}
                    {isRunning && !isLoadingSpecs && (
                        <span
                            style={{ width:6, height:6, borderRadius:'50%', background:'var(--color-success)', flexShrink:0, boxShadow:'0 0 6px var(--color-success)', animation:'pulse-success 1.5s infinite' }}
                        />
                    )}
                </div>
            )}

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

            {/* Actions */}
            <div className="header-actions">
                {!isRunning ? (
                    <button className="btn btn-primary" id="btn-start" onClick={onStart}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5,3 19,12 5,21"/>
                        </svg>
                        Run Fuzz Test
                    </button>
                ) : (
                    <>
                        {!isLoadingSpecs && (
                            isPaused ? (
                                <button className="btn btn-success" onClick={onResume}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                        <polygon points="5,3 19,12 5,21"/>
                                    </svg>
                                    Resume
                                </button>
                            ) : (
                                <button className="btn btn-ghost" onClick={onPause}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                                    </svg>
                                    Pause
                                </button>
                            )
                        )}
                        <button className="btn btn-danger" onClick={onStop}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                            </svg>
                            Stop
                        </button>
                    </>
                )}
            </div>
        </header>
    );
}
