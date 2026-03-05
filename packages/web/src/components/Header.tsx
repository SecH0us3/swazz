import React from 'react';

interface Props {
    baseUrl: string;
    isRunning: boolean;
    isPaused: boolean;
    onStart: () => void;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
}

export function Header({ baseUrl, isRunning, isPaused, onStart, onStop, onPause, onResume }: Props) {
    return (
        <header className="header">
            <div className="header-logo">
                <span>⚡</span>
                <span>swazz</span>
            </div>

            {baseUrl && <div className="header-target">{baseUrl}</div>}

            {isRunning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="running-dot" />
                    <span className="running-text">{isPaused ? 'Paused' : 'Running...'}</span>
                </div>
            )}

            <div className="header-actions">
                {!isRunning ? (
                    <button className="btn btn-primary" onClick={onStart} disabled={!baseUrl}>
                        ▶ Start
                    </button>
                ) : (
                    <>
                        {isPaused ? (
                            <button className="btn btn-primary" onClick={onResume}>▶ Resume</button>
                        ) : (
                            <button className="btn btn-ghost" onClick={onPause}>⏸ Pause</button>
                        )}
                        <button className="btn btn-danger" onClick={onStop}>■ Stop</button>
                    </>
                )}
            </div>
        </header>
    );
}
