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
                    <label className="form-group-label">Maximum Scan Duration (minutes)</label>
                    <input 
                        type="number" 
                        className="input input-width-md" 
                        min="0"
                        value={config.settings.max_scan_duration_min || 0} 
                        onChange={(e) => updateSettings({ max_scan_duration_min: Math.max(0, parseInt(e.target.value) || 0) })}
                    />
                    <span className="form-group-hint">
                        Automatically abort the fuzzing scan if it runs longer than this duration (set to 0 for unlimited).
                    </span>
                </div>

                <div>
                    <label className="fuzz-setting-intensity-title">Fuzzing Intensity (Iterations per profile)</label>
                    <input 
                        type="number" 
                        className="input fuzz-setting-intensity-input" 
                        min="1"
                        value={config.settings.iterations_per_profile} 
                        onChange={(e) => updateSettings({ iterations_per_profile: Math.max(1, parseInt(e.target.value) || 10) })}
                    />
                    <span className="fuzz-setting-intensity-hint">
                        Controls the volume of payload variations tested on each endpoint. High values provide thorough code path exploration at the expense of scan execution time.
                    </span>
                </div>

                {/* Active Parameter Fuzzing */}
                <div className="fuzz-setting-checkbox-group">
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.active_parameter_fuzzing ?? false}
                            onChange={() => updateSettings({
                                active_parameter_fuzzing: !(config.settings.active_parameter_fuzzing ?? false)
                            })}
                        />
                        <strong style={{ fontSize: '13px' }}>Active Parameter Fuzzing (Field-by-Field)</strong>
                    </label>
                    <span className="fuzz-setting-checkbox-hint">
                        Mutate one request parameter or body field at a time while leaving other fields at baseline values. Extremely useful for avoiding validation errors on non-targeted fields.
                    </span>
                </div>

                {/* Rate Limit Detection */}
                <div className="fuzz-setting-checkbox-group">
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

                {/* WAF Evasion & Proxies */}
                <div className="fuzz-setting-section">
                    <h3 className="fuzz-setting-section-title">WAF Evasion & Proxies</h3>
                    
                    <div>
                        <label htmlFor="proxy_list" className="fuzz-setting-input-label">Proxy List (one per line, HTTP/SOCKS5)</label>
                        <textarea
                            id="proxy_list"
                            className="input fuzz-setting-textarea-monospace"
                            value={(config.settings.proxy_list || []).join('\n')}
                            onChange={(e) => {
                                const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean);
                                updateSettings({ proxy_list: lines });
                            }}
                            placeholder="http://1.2.3.4:8080"
                        />
                    </div>

                    <div className="fuzz-setting-checkbox-group no-border">
                        <label className="premium-checkbox-label">
                            <input
                                type="checkbox"
                                className="premium-checkbox"
                                aria-label="Randomize User-Agent"
                                checked={config.settings.randomize_user_agent ?? false}
                                onChange={(e) => updateSettings({ randomize_user_agent: e.target.checked })}
                            />
                            <strong className="fuzz-setting-label-bold">Randomize User-Agent per request</strong>
                        </label>
                        <span className="fuzz-setting-checkbox-hint">
                            Default: Swazz/1.0 (+https://github.com/SecH0us3/swazz)
                        </span>
                    </div>

                    <div className="fuzz-setting-checkbox-group no-border">
                        <label className="premium-checkbox-label">
                            <input
                                type="checkbox"
                                className="premium-checkbox"
                                aria-label="Enable Adaptive Rate Limiting"
                                checked={config.settings.enable_adaptive_rate_limit ?? false}
                                onChange={(e) => updateSettings({ enable_adaptive_rate_limit: e.target.checked })}
                            />
                            <strong className="fuzz-setting-label-bold">Enable Adaptive Rate Limiting</strong>
                        </label>
                        <span className="fuzz-setting-checkbox-hint">
                            Automatically pauses requests when a 429 Too Many Requests response is detected, backing off based on the Retry-After header.
                        </span>
                    </div>
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

                {/* Semantic & AI Mutation Options */}
                <div className="fuzz-setting-section" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <h3 className="fuzz-setting-section-title">Semantic &amp; AI Mutation Options</h3>
                    
                    <div className="fuzz-setting-checkbox-group no-border">
                        <label className="premium-checkbox-label">
                            <input
                                type="checkbox"
                                className="premium-checkbox"
                                checked={config.settings.enable_semantic_mutation !== false}
                                onChange={(e) => updateSettings({ enable_semantic_mutation: e.target.checked })}
                            />
                            <strong className="fuzz-setting-label-bold">Semantic Format Wrappers</strong>
                        </label>
                        <span className="fuzz-setting-checkbox-hint">
                            Wrap payloads into valid email, UUID, date, phone &amp; URL RFC formats.
                        </span>
                    </div>

                    <div className="fuzz-setting-checkbox-group no-border">
                        <label className="premium-checkbox-label">
                            <input
                                type="checkbox"
                                className="premium-checkbox"
                                checked={config.settings.use_llm_prepass ?? false}
                                onChange={(e) => updateSettings({ use_llm_prepass: e.target.checked })}
                            />
                            <strong className="fuzz-setting-label-bold">Pre-Scan LLM Batching</strong>
                        </label>
                        <span className="fuzz-setting-checkbox-hint">
                            Pre-scan OpenAPI schema with LLM to generate custom payload templates.
                        </span>
                    </div>

                    {(config.settings.use_llm_prepass ?? false) && (
                        <div style={{ marginLeft: '24px', paddingLeft: '16px', borderLeft: '2px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label htmlFor="ai_gateway_url" className="fuzz-setting-input-label">AI Gateway / OpenAI Proxy URL</label>
                                <input
                                    id="ai_gateway_url"
                                    type="text"
                                    className="input"
                                    style={{ width: '100%' }}
                                    placeholder="https://gateway.ai.cloudflare.com/v1/ACCOUNT_ID/GATEWAY/openai"
                                    value={config.settings.ai_gateway_url || ''}
                                    onChange={(e) => updateSettings({ ai_gateway_url: e.target.value })}
                                />
                            </div>
                            <div>
                                <label htmlFor="cf_aig_token" className="fuzz-setting-input-label">Cloudflare AI Gateway Token (cf-aig-authorization)</label>
                                <input
                                    id="cf_aig_token"
                                    type="password"
                                    className="input"
                                    style={{ width: '100%' }}
                                    placeholder="Bearer token for Cloudflare AI Gateway"
                                    value={config.settings.cf_aig_token || ''}
                                    onChange={(e) => updateSettings({ cf_aig_token: e.target.value })}
                                />
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                    Bearer token sent in cf-aig-authorization header to Cloudflare AI Gateway.
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
