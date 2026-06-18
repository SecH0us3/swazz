import React, { useState } from 'react';
import { useConfig } from '../../hooks/useConfig.js';

export function AnomaliesTab() {
    const { config, updateConfig, updateSettings } = useConfig();
    const [newIgnoreCode, setNewIgnoreCode] = useState('');

    const ignoredCodes = config.rules?.ignore || [];

    const handleAddIgnoreCode = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newIgnoreCode.trim();
        if (!/^\d{3}$/.test(trimmed)) {
            alert('Please enter a valid 3-digit HTTP status code (100-599).');
            return;
        }
        const codeNum = parseInt(trimmed, 10);
        if (!/^\d+$/.test(trimmed) || isNaN(codeNum) || codeNum < 100 || codeNum > 599) {
            alert('Please enter a valid HTTP status code (100-599).');
            return;
        }
        if (ignoredCodes.includes(codeNum)) {
            setNewIgnoreCode('');
            return;
        }

        const nextIgnore = [...ignoredCodes, codeNum].sort();
        updateConfig({
            rules: {
                ...config.rules,
                ignore: nextIgnore
            }
        });
        setNewIgnoreCode('');
    };

    const handleRemoveIgnoreCode = (codeToRemove: number) => {
        const nextIgnore = ignoredCodes.filter(c => c !== codeToRemove);
        updateConfig({
            rules: {
                ...config.rules,
                ignore: nextIgnore
            }
        });
    };

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
                Vulnerability & Anomaly Analysis
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Analyze response body */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.analyze_response_body ?? true}
                            onChange={() => updateSettings({
                                analyze_response_body: !(config.settings.analyze_response_body ?? true)
                            })}
                        />
                        <strong style={{ fontSize: '13px' }}>Enable Response Body Structural Analysis</strong>
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                        Inspect responses dynamically to detect schema changes, reflection vectors, or internal stack trace leakage. Required for findings triage.
                    </span>
                </div>

                {config.settings.analyze_response_body !== false && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginLeft: '24px', paddingLeft: '16px', borderLeft: '2px solid var(--border-default)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Size Anomaly Deviation Multiplier</label>
                            <input 
                                type="number" 
                                className="input" 
                                step="0.1"
                                min="1"
                                value={config.settings.response_size_anomaly_multiplier ?? 5.0} 
                                onChange={(e) => updateSettings({ response_size_anomaly_multiplier: parseFloat(e.target.value) || 5.0 })}
                                style={{ width: '120px' }} 
                            />
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                Classify size changes larger than this multiplier of standard deviations as structural body size anomalies.
                            </span>
                        </div>
                    </div>
                )}

                {/* Timeout anomalies */}
                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Time-delay Anomaly Threshold (ms)</label>
                    <input 
                        type="number" 
                        className="input" 
                        value={config.settings.time_anomaly_threshold_ms ?? 4000} 
                        onChange={(e) => updateSettings({ time_anomaly_threshold_ms: parseInt(e.target.value) || 4000 })}
                        style={{ width: '120px' }} 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        Flag response latencies higher than this threshold as a delay anomaly (essential for identifying SQL injection / Command injection time-delay checks).
                    </span>
                </div>

                {/* Security SSRF */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.security?.allow_private_ips ?? false}
                            onChange={() => updateConfig({
                                security: {
                                    ...config.security,
                                    allow_private_ips: !(config.security?.allow_private_ips ?? false)
                                }
                            })}
                        />
                        <strong style={{ fontSize: '13px' }}>Allow Scanner Private IP Scopes (Skip SSRF protection)</strong>
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                        By default, Swazz agents block scanning targets resolved as private IPv4/IPv6 address blocks (e.g. 127.0.0.1, 10.x.x.x) to prevent internal-network loops. Toggle this if you are running tests against internal/local developers.
                    </span>
                </div>

                {/* BOLA access testing */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.bola_testing ?? false}
                            onChange={() => updateSettings({
                                bola_testing: !(config.settings.bola_testing ?? false)
                            })}
                        />
                        <strong style={{ fontSize: '13px' }}>Enable Broken Object Level Authorization (BOLA) checking</strong>
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                        Compare primary user endpoints against credentials for a secondary user profile (User B) to detect improper access control settings.
                    </span>
                </div>

                {/* Ignored status codes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>Ignored HTTP Status Codes</label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                        Configure status codes that are treated as expected behavior and will be ignored in anomaly reports.
                    </span>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' }}>
                        {ignoredCodes.length === 0 ? (
                            <span style={{ fontSize: '12px', color: 'var(--text-disabled)', fontStyle: 'italic' }}>No custom ignored status codes. Standard success codes (1xx, 2xx, 3xx) are ignored by default.</span>
                        ) : (
                            ignoredCodes.map(code => (
                                <span 
                                    key={code} 
                                    className="tag-btn active"
                                    style={{ 
                                        display: 'inline-flex', 
                                        alignItems: 'center', 
                                        gap: '6px',
                                        padding: '4px 10px',
                                        backgroundColor: 'rgba(124, 58, 237, 0.15)',
                                        border: '1px solid rgba(124, 58, 237, 0.3)',
                                        borderRadius: 'var(--radius-full)',
                                        fontSize: '12px',
                                        color: 'var(--accent-light)'
                                    }}
                                >
                                    {code}
                                    <button 
                                        type="button" 
                                        onClick={() => handleRemoveIgnoreCode(code)}
                                        style={{ 
                                            border: 'none', 
                                            background: 'transparent', 
                                            color: 'var(--text-secondary)', 
                                            cursor: 'pointer',
                                            fontSize: '10px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            padding: '2px'
                                        }}
                                    >
                                        ✕
                                    </button>
                                </span>
                            ))
                        )}
                    </div>

                    <form onSubmit={handleAddIgnoreCode} style={{ display: 'flex', gap: '8px', maxWidth: '240px' }}>
                        <input 
                            type="text" 
                            className="input" 
                            placeholder="e.g. 404"
                            value={newIgnoreCode}
                            onChange={(e) => setNewIgnoreCode(e.target.value)}
                            style={{ width: '100px', textAlign: 'center' }}
                        />
                        <button type="submit" className="btn btn-secondary btn-sm">Add Code</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
