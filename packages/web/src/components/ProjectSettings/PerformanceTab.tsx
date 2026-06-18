import React from 'react';
import { useConfig } from '../../hooks/useConfig.js';

export function PerformanceTab() {
    const { config, updateSettings } = useConfig();

    return (
        <div className="card" style={{
            backgroundColor: 'var(--bg-elevated)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
        }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                Fuzzing Settings & Rate Limits
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Request Concurrency</label>
                        <span style={{ fontWeight: 600, color: 'var(--accent-light)' }}>{config.settings.concurrency} workers</span>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <input 
                            type="range" 
                            min="1" 
                            max="10" 
                            value={config.settings.concurrency} 
                            onChange={(e) => updateSettings({ concurrency: parseInt(e.target.value) || 1 })}
                            style={{ flex: 1, accentColor: 'var(--accent)' }}
                        />
                        <input 
                            type="number"
                            className="input"
                            style={{ width: '60px', textAlign: 'center' }}
                            value={config.settings.concurrency}
                            onChange={(e) => updateSettings({ concurrency: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })}
                        />
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        The number of requests dispatched simultaneously by the agent runner. Higher concurrency speeds up scans but increases target server load.
                    </span>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Individual Request Timeout (ms)</label>
                    <input 
                        type="number" 
                        className="input" 
                        value={config.settings.timeout_ms} 
                        onChange={(e) => updateSettings({ timeout_ms: parseInt(e.target.value) || 2000 })}
                        style={{ width: '120px' }} 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        Maximum milliseconds to wait for each HTTP response before triggering a timeout anomaly.
                    </span>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Delay Between Requests (ms)</label>
                    <input 
                        type="number" 
                        className="input" 
                        value={config.settings.delay_between_requests_ms} 
                        onChange={(e) => updateSettings({ delay_between_requests_ms: parseInt(e.target.value) || 0 })}
                        style={{ width: '120px' }} 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        Introduces an artificial sleep duration between outgoing requests (ideal for target rate limit bypass or sensitive local tests).
                    </span>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Fuzzing Intensity (Iterations per profile)</label>
                    <input 
                        type="number" 
                        className="input" 
                        value={config.settings.iterations_per_profile} 
                        onChange={(e) => updateSettings({ iterations_per_profile: parseInt(e.target.value) || 10 })}
                        style={{ width: '120px' }} 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        Controls the volume of payload variations tested on each endpoint. High values provide thorough code path exploration at the expense of scan execution time.
                    </span>
                </div>
            </div>
        </div>
    );
}
