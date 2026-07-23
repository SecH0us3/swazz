import React, { useState } from 'react';
import { useConfig } from '../../hooks/useConfig.js';

type SubTabId = 'concurrency' | 'fuzzing_options' | 'timeout_rules' | 'evasion_ai';

interface TabConfig {
    id: SubTabId;
    label: string;
    icon: React.ReactNode;
}

const TABS: TabConfig[] = [
    {
        id: 'concurrency',
        label: 'Concurrency & Rate Limits',
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="6" x2="12" y2="12"></line>
                <line x1="12" y1="12" x2="16" y2="14"></line>
            </svg>
        )
    },
    {
        id: 'fuzzing_options',
        label: 'Fuzzing & Intensity',
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
        )
    },
    {
        id: 'timeout_rules',
        label: 'Timeout & Duration',
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
        )
    },
    {
        id: 'evasion_ai',
        label: 'WAF Evasion & AI',
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
        )
    }
];

export function PerformanceTab() {
    const { config, updateSettings } = useConfig();
    const [subTab, setSubTab] = useState<SubTabId>('concurrency');

    return (
        <div className="performance-card">
            <h2 className="performance-card-title">
                Fuzzing Settings &amp; Rate Limits
            </h2>

            {/* Horizontal Sub-Tabs Bar */}
            <div className="performance-subtabs-nav" role="tablist" aria-label="Performance settings navigation">
                {TABS.map((tab) => {
                    const isActive = subTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            id={`subtab-${tab.id}`}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-controls={`subtabpanel-${tab.id}`}
                            className={`performance-subtab-btn ${isActive ? 'active' : ''}`}
                            onClick={() => setSubTab(tab.id)}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Sub-Tab 1: Concurrency & Rate Limits */}
            {subTab === 'concurrency' && (
                <div 
                    id="subtabpanel-concurrency"
                    className="performance-tab-content" 
                    role="tabpanel" 
                    aria-labelledby="subtab-concurrency"
                >
                    {/* Concurrency Workers */}
                    <div className="performance-input-group">
                        <div className="performance-input-row" style={{ justifyContent: 'space-between' }}>
                            <label className="performance-label" htmlFor="concurrency-range">Request Concurrency</label>
                            <span style={{ fontWeight: 600, color: 'var(--accent-light)' }}>{config.settings.concurrency} workers</span>
                        </div>
                        <div className="performance-input-row">
                            <input 
                                id="concurrency-range"
                                type="range" 
                                min="1" 
                                max="10" 
                                value={config.settings.concurrency} 
                                onChange={(e) => updateSettings({ concurrency: parseInt(e.target.value) || 1 })}
                                className="performance-input-range"
                            />
                            <input 
                                id="concurrency-number"
                                aria-label="Request Concurrency Worker Count"
                                type="number"
                                className="input performance-input-number-center"
                                value={config.settings.concurrency}
                                onChange={(e) => updateSettings({ concurrency: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })}
                            />
                        </div>
                        <span className="performance-hint">
                            The number of requests dispatched simultaneously by the agent runner. Higher concurrency speeds up scans but increases target server load.
                        </span>
                    </div>

                    {/* Delay Between Requests */}
                    <div className="performance-input-group">
                        <label htmlFor="request-delay-ms" className="performance-label">Delay Between Requests (ms)</label>
                        <input 
                            id="request-delay-ms"
                            type="number" 
                            className="input performance-input-number-sm" 
                            min="0"
                            value={config.settings.delay_between_requests_ms} 
                            onChange={(e) => updateSettings({ delay_between_requests_ms: Math.max(0, parseInt(e.target.value) || 0) })}
                        />
                        <span className="performance-hint">
                            Introduces an artificial sleep duration between outgoing requests (ideal for target rate limit bypass or sensitive local tests).
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
                        <span className="performance-hint" style={{ marginLeft: '24px', lineHeight: '1.4' }}>
                            Send a rapid burst of concurrent requests to each API endpoint to detect active rate limit controls or application security blocks.
                        </span>

                        {(config.settings.rate_limit_check ?? false) && (
                            <div className="performance-rate-limit-nested">
                                <div>
                                    <label htmlFor="rate-limit-burst-size" className="performance-label">Burst Size</label>
                                    <input
                                        id="rate-limit-burst-size"
                                        className="input performance-input-number-sm"
                                        type="number"
                                        min={1}
                                        max={1000}
                                        value={config.settings.rate_limit_burst_size ?? 50}
                                        onChange={(e) => updateSettings({ rate_limit_burst_size: Math.min(1000, Math.max(1, parseInt(e.target.value) || 50)) })}
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

                    {/* Adaptive Rate Limiting */}
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
            )}

            {/* Sub-Tab 2: Fuzzing & Intensity */}
            {subTab === 'fuzzing_options' && (
                <div 
                    id="subtabpanel-fuzzing_options"
                    className="performance-tab-content" 
                    role="tabpanel" 
                    aria-labelledby="subtab-fuzzing_options"
                >
                    {/* Fuzzing Intensity */}
                    <div className="performance-input-group">
                        <label htmlFor="fuzz-iterations-per-profile" className="fuzz-setting-intensity-title">Fuzzing Intensity (Iterations per profile)</label>
                        <input 
                            id="fuzz-iterations-per-profile"
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

                    {/* HAR Domain Filter */}
                    <div className="performance-input-group performance-divider-top">
                        <label htmlFor="har-domain-filter" className="performance-label">HAR Domain Filter</label>
                        <input
                            id="har-domain-filter"
                            className="input performance-input-full"
                            type="text"
                            placeholder="e.g. api.example.com"
                            value={config.settings.har_domain_filter || ''}
                            onChange={(e) => updateSettings({ har_domain_filter: e.target.value })}
                        />
                        <span className="performance-hint">
                            Only import endpoints matching this domain when importing HAR files.
                        </span>
                    </div>
                </div>
            )}

            {/* Sub-Tab 3: Timeout & Duration */}
            {subTab === 'timeout_rules' && (
                <div 
                    id="subtabpanel-timeout_rules"
                    className="performance-tab-content" 
                    role="tabpanel" 
                    aria-labelledby="subtab-timeout_rules"
                >
                    {/* Individual Request Timeout */}
                    <div className="performance-input-group">
                        <label htmlFor="request-timeout-ms" className="performance-label">Individual Request Timeout (ms)</label>
                        <input 
                            id="request-timeout-ms"
                            type="number" 
                            className="input performance-input-number-sm" 
                            min="1"
                            value={config.settings.timeout_ms} 
                            onChange={(e) => updateSettings({ timeout_ms: Math.max(1, parseInt(e.target.value) || 2000) })}
                        />
                        <span className="performance-hint">
                            Maximum milliseconds to wait for each HTTP response before triggering a timeout anomaly.
                        </span>
                    </div>

                    {/* Maximum Scan Duration */}
                    <div className="performance-input-group">
                        <label htmlFor="max-scan-duration-min" className="form-group-label">Maximum Scan Duration (minutes)</label>
                        <input 
                            id="max-scan-duration-min"
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
                </div>
            )}

            {/* Sub-Tab 4: WAF Evasion & AI */}
            {subTab === 'evasion_ai' && (
                <div 
                    id="subtabpanel-evasion_ai"
                    className="performance-tab-content" 
                    role="tabpanel" 
                    aria-labelledby="subtab-evasion_ai"
                >
                    {/* WAF Evasion & Proxies */}
                    <div className="fuzz-setting-section">
                        <h3 className="fuzz-setting-section-title">WAF Evasion &amp; Proxies</h3>
                        
                        <div className="performance-input-group">
                            <label htmlFor="proxy_list" className="fuzz-setting-input-label">Proxy List (one per line, HTTP/SOCKS5)</label>
                            <textarea
                                id="proxy_list"
                                className="input fuzz-setting-textarea-monospace"
                                value={(config.settings.proxy_list || []).join('\n')}
                                onChange={(e) => {
                                    const lines = e.target.value.split('\n');
                                    updateSettings({ proxy_list: lines });
                                }}
                                onBlur={(e) => {
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
                    </div>

                    {/* Semantic & AI Mutation Options */}
                    <div className="fuzz-setting-section semantic-settings-section">
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
                            <div className="llm-nested-settings">
                                <div>
                                    <label htmlFor="ai_gateway_url" className="fuzz-setting-input-label">AI Gateway / OpenAI Proxy URL</label>
                                    <input
                                        id="ai_gateway_url"
                                        type="text"
                                        className="input semantic-input-field"
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
                                        className="input semantic-input-field"
                                        placeholder="Bearer token for Cloudflare AI Gateway"
                                        value={config.settings.cf_aig_token || ''}
                                        onChange={(e) => updateSettings({ cf_aig_token: e.target.value })}
                                    />
                                    <span className="fuzz-setting-checkbox-hint">
                                        Bearer token sent in cf-aig-authorization header to Cloudflare AI Gateway.
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
