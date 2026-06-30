import React from 'react';
import { useConfig } from '../../hooks/useConfig.js';

export function PerformanceTab() {
    const { config, updateConfig, updateSettings } = useConfig();

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
                        min="1"
                        value={config.settings.timeout_ms} 
                        onChange={(e) => updateSettings({ timeout_ms: Math.max(1, parseInt(e.target.value) || 2000) })}
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
                        min="0"
                        value={config.settings.delay_between_requests_ms} 
                        onChange={(e) => updateSettings({ delay_between_requests_ms: Math.max(0, parseInt(e.target.value) || 0) })}
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
                        min="1"
                        value={config.settings.iterations_per_profile} 
                        onChange={(e) => updateSettings({ iterations_per_profile: Math.max(1, parseInt(e.target.value) || 10) })}
                        style={{ width: '120px' }} 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        Controls the volume of payload variations tested on each endpoint. High values provide thorough code path exploration at the expense of scan execution time.
                    </span>
                </div>

                {/* Rate Limit Detection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.rate_limit_check ?? false}
                            onChange={() => updateSettings({
                                rate_limit_check: !(config.settings.rate_limit_check ?? false)
                            })}
                        />
                        <strong style={{ fontSize: '13px' }}>Enable Rate Limit Detection</strong>
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                        Send a rapid burst of concurrent requests to each API endpoint to detect active rate limit controls or application security blocks.
                    </span>

                    {(config.settings.rate_limit_check ?? false) && (
                        <div style={{ marginLeft: '24px', paddingLeft: '16px', borderLeft: '2px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Burst Size</label>
                                <input
                                    className="input"
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={config.settings.rate_limit_burst_size ?? 50}
                                    onChange={(e) => updateSettings({ rate_limit_burst_size: Math.min(1000, Math.max(1, parseInt(e.target.value) || 50)) })}
                                    style={{ width: '120px' }}
                                />
                            </div>
                            <div className="sidebar-rate-limit-warning">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}>
                                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <span style={{ fontSize: '11px', color: 'var(--color-warning)' }}>
                                    Warning: Enabling rate-limit testing sends a rapid burst of concurrent requests. This might trigger active rate-limiting bans or WAF blocks.
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* HAR Domain Filter */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>HAR Domain Filter</label>
                    <input
                        className="input"
                        type="text"
                        placeholder="e.g. api.example.com"
                        value={config.settings.har_domain_filter || ''}
                        onChange={(e) => updateSettings({ har_domain_filter: e.target.value })}
                        style={{ width: '100%' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Only import endpoints matching this domain when importing HAR files.
                    </span>
                </div>
            </div>
        </div>
    );
}
