import React from 'react';

interface Props {
    baseUrl: string;
    isRunning: boolean;
    isPaused: boolean;
    isLoadingSpecs?: boolean;
    onStart: () => void;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
}

export function Header({ baseUrl, isRunning, isPaused, isLoadingSpecs, onStart, onStop, onPause, onResume }: Props) {
    return (
        <header className="header">
            <div className="header-logo">
                <span>⚡</span>
                <span>swazz</span>
            </div>

            {baseUrl && <div className="header-target">{baseUrl}</div>}

            {isRunning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isLoadingSpecs ? (
                        <span className="running-text" style={{ color: 'var(--color-warning)' }}>Loading specs...</span>
                    ) : (
                        <>
                            <div className="running-dot" />
                            <span className="running-text">{isPaused ? 'Paused' : 'Running...'}</span>
                        </>
                    )}
                </div>
            )}

            <div className="header-actions">
                {!isRunning ? (
                    <button className="btn btn-primary" id="btn-start" onClick={onStart}>
                        ▶ Run Fuzz Test
                    </button>
                ) : (
                    <>
                        {!isLoadingSpecs && (
                            <>
                                {isPaused ? (
                                    <button className="btn btn-primary" onClick={onResume}>▶ Resume</button>
                                ) : (
                                    <button className="btn btn-ghost" onClick={onPause}>⏸ Pause</button>
                                )}
                            </>
                        )}
                        <button className="btn btn-danger" onClick={onStop}>■ Stop</button>
                    </>
                )}
            </div>
        </header>
    );
}
