import React, { useState } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { useToast } from '../../hooks/useToast.js';
import { KVEditor } from '../Sidebar/Shared.js';

export function AnomaliesTab() {
    const { config, updateConfig, updateSettings } = useConfig();
    const { showToast } = useToast();
    const [newIgnoreCode, setNewIgnoreCode] = useState('');

    const ignoredCodes = config.rules?.ignore || [];

    const handleAddIgnoreCode = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newIgnoreCode.trim();
        if (!/^\d{3}$/.test(trimmed)) {
            alert('Please enter a valid 3-digit HTTP status code (100-599).');
            showToast('Please enter a valid 3-digit HTTP status code (100-599).', 'error');
            return;
        }
        const codeNum = parseInt(trimmed, 10);
        if (!/^\d+$/.test(trimmed) || isNaN(codeNum) || codeNum < 100 || codeNum > 599) {
            alert('Please enter a valid HTTP status code (100-599).');
            showToast('Please enter a valid HTTP status code (100-599).', 'error');
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

                    {(config.settings.bola_testing ?? false) && (
                        <div style={{ marginLeft: '24px', paddingLeft: '16px', borderLeft: '2px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Selected Auth Credentials Summary */}
                            <div className="auth-keys-selection">
                                <div className="bola-sub-title">Marked Authentication Credentials:</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 6 }}>
                                    Toggle lock icons in headers/cookies on the right sidebar to mark authentication tokens.
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                                    {/* Headers */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: 55, flexShrink: 0 }}>Headers:</span>
                                        {Object.keys(config.global_headers || {}).length === 0 ? (
                                            <span style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>No headers configured</span>
                                        ) : (
                                            Object.keys(config.global_headers || {}).map(h => {
                                                const isAuth = (config.settings.auth_headers || []).some(x => x.toLowerCase() === h.toLowerCase());
                                                return (
                                                    <button
                                                        key={h}
                                                        className={`tag-btn ${isAuth ? 'active' : ''}`}
                                                        onClick={() => {
                                                            const current = config.settings.auth_headers || [];
                                                            const lower = h.toLowerCase();
                                                            const next = isAuth ? current.filter(x => x.toLowerCase() !== lower) : [...current, h];
                                                            updateSettings({ auth_headers: next });
                                                        }}
                                                        type="button"
                                                    >
                                                        {isAuth ? '🔒 ' : '🔓 '}{h}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                    {/* Cookies */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: 55, flexShrink: 0 }}>Cookies:</span>
                                        {Object.keys(config.cookies || {}).length === 0 ? (
                                            <span style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>No cookies configured</span>
                                        ) : (
                                            Object.keys(config.cookies || {}).map(c => {
                                                const isAuth = (config.settings.auth_cookies || []).some(x => x.toLowerCase() === c.toLowerCase());
                                                return (
                                                    <button
                                                        key={c}
                                                        className={`tag-btn ${isAuth ? 'active' : ''}`}
                                                        onClick={() => {
                                                            const current = config.settings.auth_cookies || [];
                                                            const lower = c.toLowerCase();
                                                            const next = isAuth ? current.filter(x => x.toLowerCase() !== lower) : [...current, c];
                                                            updateSettings({ auth_cookies: next });
                                                        }}
                                                        type="button"
                                                    >
                                                        {isAuth ? '🔒 ' : '🔓 '}{c}
                                                      </button>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>
                            {/* Warning if no credentials selected */}
                            {(!config.settings.auth_headers || config.settings.auth_headers.length === 0) &&
                             (!config.settings.auth_cookies || config.settings.auth_cookies.length === 0) && (
                                <div className="bola-warning-box">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                        <line x1="12" y1="9" x2="12" y2="13"/>
                                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                                    </svg>
                                    <span>Warning: No authentication credentials are marked. Access control check might not know what to drop or switch.</span>
                                </div>
                            )}
                            {/* User B Panel */}
                            <div className="bola-identity-card">
                                <div className="bola-identity-badge">User B (Secondary)</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    Session credentials representing User B:
                                </div>
                                <div className="bola-sub-title">Headers (User B)</div>
                                <KVEditor
                                    entries={config.auth_identities?.userB?.headers || {}}
                                    onChange={(h) => {
                                        const currentIdentities = config.auth_identities || {};
                                        const currentB = currentIdentities.userB || { headers: {}, cookies: {} };
                                        updateConfig({
                                            auth_identities: {
                                                ...currentIdentities,
                                                userB: {
                                                    ...currentB,
                                                    headers: h
                                                }
                                            }
                                        });
                                    }}
                                    keyPlaceholder="Header"
                                    valuePlaceholder="Value"
                                />
                                <div className="bola-sub-title" style={{ marginTop: 8 }}>Cookies (User B)</div>
                                <KVEditor
                                    entries={config.auth_identities?.userB?.cookies || {}}
                                    onChange={(c) => {
                                        const currentIdentities = config.auth_identities || {};
                                        const currentB = currentIdentities.userB || { headers: {}, cookies: {} };
                                        updateConfig({
                                            auth_identities: {
                                                ...currentIdentities,
                                                userB: {
                                                    ...currentB,
                                                    cookies: c
                                                }
                                            }
                                        });
                                    }}
                                    keyPlaceholder="Name"
                                    valuePlaceholder="Value"
                                />
                            </div>
                        </div>
                    )}
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
