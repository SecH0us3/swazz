import { ChangeEvent, useMemo, useRef, useState } from 'react';
import type { SwazzConfig, FuzzingProfile, Dictionary } from '../../types.js';
import { Section, KVEditor } from './Shared.js';
import { PayloadSettingsModal } from './PayloadSettingsModal.js';

interface Props {
    style?: React.CSSProperties;
    config: SwazzConfig;
    onUpdateHeaders: (h: Record<string, string>) => void;
    onUpdateCookies: (c: Record<string, string>) => void;
    onUpdateDictionaries: (d: Dictionary) => void;
    onUpdateProfiles: (p: FuzzingProfile[]) => void;
    onUpdateConfig: (partial: Partial<SwazzConfig>) => void;
    onImportConfig: (json: string) => void;
    onExportConfig: () => string;
    onToast: (message: string, type?: 'info' | 'success' | 'error') => void;
    className?: string;
}

const ALL_PROFILES: FuzzingProfile[] = ['RANDOM', 'BOUNDARY', 'MALICIOUS'];

const PROFILE_LABELS: Record<string, string> = {
    RANDOM: 'Random values',
    BOUNDARY: 'Boundary values',
    MALICIOUS: 'Injection attacks',
};

export function ConfigSidebar({
    style,
    config,
    onUpdateHeaders,
    onUpdateCookies,
    onUpdateDictionaries,
    onUpdateProfiles,
    onUpdateConfig,
    onImportConfig,
    onExportConfig,
    onToast,
    className,
}: Props) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [dictText, setDictText] = useState(JSON.stringify(config.dictionaries, null, 2));
    const [dictError, setDictError] = useState('');
    const [showPayloadSettings, setShowPayloadSettings] = useState(false);

    const activeProfiles = config.settings.profiles || [];
    const toggleProfile = (p: FuzzingProfile) => {
        const isActive = activeProfiles.includes(p);
        const next = isActive ? activeProfiles.filter((x) => x !== p) : [...activeProfiles, p];
        if (next.length > 0) onUpdateProfiles(next);
    };

    // Compute the minimum payloads needed across active profiles
    const minPayloads = useMemo(() => {
        return activeProfiles.reduce((max, p) => {
            let needed = 0;
            if (p === 'BOUNDARY') needed = 17;
            if (p === 'MALICIOUS') needed = 35;
            return Math.max(max, needed);
        }, 0);
    }, [activeProfiles]);

    const handleDictBlur = () => {
        try {
            const parsed = JSON.parse(dictText);
            onUpdateDictionaries(parsed);
            setDictError('');
        } catch {
            setDictError('Invalid JSON');
        }
    };

    const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                onImportConfig(reader.result as string);
                const parsed = JSON.parse(reader.result as string);
                setDictText(JSON.stringify(parsed.dictionaries || {}, null, 2));
                onToast('Config imported', 'success');
            } catch {
                onToast('Invalid config file', 'error');
            }
        };
        reader.readAsText(file);
    };

    const SETTINGS_FIELDS = [
        { label: 'Concurrency', key: 'concurrency', value: config.settings.concurrency },
        { label: 'Timeout (ms)', key: 'timeout_ms', value: config.settings.timeout_ms },
        { label: 'Delay (ms)', key: 'delay_between_requests_ms', value: config.settings.delay_between_requests_ms },
    ];

    return (
        <aside className={`config-sidebar ${className || ''}`} style={{ gridArea:'unset', borderLeft:'1px solid var(--border-subtle)', borderRight:'none', ...style }}>

            {/* Profiles */}
            <Section 
                title="Profiles" 
                action={
                    <button 
                        className="btn-icon" 
                        title="Payload Settings"
                        onClick={(e) => { e.stopPropagation(); setShowPayloadSettings(true); }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1V11a2 2 0 01-2-2 2 2 0 012-2v-.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2v.09a1.65 1.65 0 00-1.51 1z"/>
                        </svg>
                    </button>
                }
            >
                <div className="profile-toggles">
                    {ALL_PROFILES.map((p) => {
                        const isActive = activeProfiles.includes(p);
                        return (
                            <div
                                key={p}
                                className={`profile-toggle ${p.toLowerCase()} ${isActive ? 'active' : ''}`}
                                onClick={() => toggleProfile(p)}
                            >
                                <span className="dot" />
                                <div style={{ flex:1 }}>
                                    <div style={{ fontWeight:500, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                        {p.charAt(0) + p.slice(1).toLowerCase()}
                                    </div>
                                    <div style={{ fontSize:'var(--font-size-2xs)', color:'var(--text-muted)', marginTop:1 }}>
                                        {PROFILE_LABELS[p]}
                                    </div>
                                </div>
                                {isActive && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" style={{ color:'var(--text-muted)', flexShrink:0 }}>
                                        <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Intensity control */}
                <div style={{ marginTop:10, padding:'8px 0 0', borderTop:'1px solid var(--border-subtle)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:'var(--font-size-xs)', color:'var(--text-secondary)' }}>Intensity</span>
                        <input
                            className="input"
                            type="number"
                            min={1}
                            style={{ width:64, flexShrink:0, textAlign:'center' }}
                            value={config.settings.iterations_per_profile}
                            onChange={(e) => onUpdateConfig({
                                settings: { ...config.settings, iterations_per_profile: parseInt(e.target.value) || 1 } as any,
                            })}
                        />
                    </div>
                    {minPayloads > 0 && (
                        <div style={{ fontSize:'var(--font-size-2xs)', color:'var(--text-disabled)', marginTop:4 }}>
                            {config.settings.iterations_per_profile < minPayloads
                                ? <>Auto-expanded to <strong style={{ color:'var(--text-muted)' }}>{minPayloads}</strong> for full coverage</>
                                : <>Min <strong style={{ color:'var(--text-muted)' }}>{minPayloads}</strong> for full coverage</>
                            }
                        </div>
                    )}
                </div>

                {/* Analyze Response Body */}
                <div className="sidebar-analyze-body-container">
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.analyze_response_body ?? true}
                            onChange={() => onUpdateConfig({
                                settings: { ...config.settings, analyze_response_body: !(config.settings.analyze_response_body ?? true) } as any,
                            })}
                        />
                        <span>Analyze Response Body</span>
                    </label>

                    {(config.settings.analyze_response_body ?? true) && (
                        <div className="sidebar-sub-setting">
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Size Anomaly Multiplier</span>
                            <input
                                className="input sidebar-sub-setting-input"
                                type="number"
                                step="0.1"
                                min={1}
                                value={config.settings.response_size_anomaly_multiplier ?? ''}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '') {
                                        onUpdateConfig({
                                            settings: { ...config.settings, response_size_anomaly_multiplier: undefined } as any,
                                        });
                                    } else {
                                        const parsed = parseFloat(val);
                                        if (!isNaN(parsed)) {
                                            onUpdateConfig({
                                                settings: { ...config.settings, response_size_anomaly_multiplier: parsed } as any,
                                            });
                                        }
                                    }
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Rate Limit Detection */}
                <div className="sidebar-rate-limit-container">
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.rate_limit_check ?? false}
                            onChange={() => onUpdateConfig({
                                settings: { ...config.settings, rate_limit_check: !(config.settings.rate_limit_check ?? false) } as any,
                            })}
                        />
                        <span>Rate Limit Detection</span>
                    </label>

                    {(config.settings.rate_limit_check ?? false) && (
                        <div className="sidebar-rate-limit-fields">
                            <div className="sidebar-sub-setting">
                                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Burst Size</span>
                                <input
                                    className="input sidebar-sub-setting-input"
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={config.settings.rate_limit_burst_size ?? 50}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value) || 1;
                                        onUpdateConfig({
                                            settings: { ...config.settings, rate_limit_burst_size: val } as any,
                                        });
                                    }}
                                />
                            </div>
                            <div className="sidebar-rate-limit-warning">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}>
                                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <span>Warning: Enabling rate-limit testing sends a rapid burst of concurrent requests to each API endpoint. This might trigger security blocks, web application firewalls (WAFs), or active rate-limiting bans.</span>
                            </div>
                        </div>
                    )}
                </div>
            </Section>

            {/* Headers */}
            <Section
                title="Headers"
                count={Object.keys(config.global_headers).length}
                defaultOpen={Object.keys(config.global_headers).length > 0}
            >
                <KVEditor
                    entries={config.global_headers}
                    onChange={onUpdateHeaders}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                />
            </Section>

            {/* Cookies */}
            <Section
                title="Cookies"
                count={Object.keys(config.cookies).length}
                defaultOpen={Object.keys(config.cookies).length > 0}
            >
                <KVEditor
                    entries={config.cookies}
                    onChange={onUpdateCookies}
                    keyPlaceholder="Name"
                    valuePlaceholder="Value"
                />
            </Section>

            {/* Wordlist Files */}
            <Section
                title="Wordlist Files"
                count={Object.keys(config.wordlist_files || {}).length}
                defaultOpen={Object.keys(config.wordlist_files || {}).length > 0}
            >
                <KVEditor
                    entries={config.wordlist_files || {}}
                    onChange={(w) => onUpdateConfig({ wordlist_files: w })}
                    keyPlaceholder="Category (e.g. xss)"
                    valuePlaceholder="Filename (in wordlists/ dir)"
                />
            </Section>

            {/* Dictionaries */}
            <Section title="Dictionaries" defaultOpen={false}>
                <textarea
                    className="textarea"
                    value={dictText}
                    onChange={(e) => setDictText(e.target.value)}
                    onBlur={handleDictBlur}
                    placeholder={`{\n  "email": ["test@test.com"],\n  ...\n}`}
                    spellCheck={false}
                />
                {dictError && (
                    <div style={{ color:'var(--color-error)', fontSize:'var(--font-size-xs)', marginTop:2 }}>
                        {dictError}
                    </div>
                )}
            </Section>

            {/* Settings */}
            <Section title="Settings" defaultOpen={false}>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {SETTINGS_FIELDS.map(({ label, key, value }) => (
                        <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                            <span style={{ fontSize:'var(--font-size-xs)', color:'var(--text-secondary)', flex:1 }}>{label}</span>
                            <input
                                className="input"
                                type="number"
                                style={{ width:80, flexShrink:0 }}
                                value={value}
                                onChange={(e) => onUpdateConfig({
                                    settings: { ...config.settings, [key]: parseInt(e.target.value) || 0 } as any,
                                })}
                            />
                        </div>
                    ))}
                </div>
            </Section>

            {/* Import / Export */}
            <Section title="Config">
                <input ref={fileRef} type="file" accept=".json" style={{ display:'none' }} onChange={handleImport} />
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    <button className="btn btn-ghost" style={{ width:'100%', justifyContent:'center' }} onClick={() => fileRef.current?.click()}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="16"/>
                        </svg>
                        Import Config
                    </button>
                    <button
                        className="btn btn-ghost"
                        style={{ width:'100%', justifyContent:'center' }}
                        onClick={() => {
                            const json = onExportConfig();
                            const blob = new Blob([json], { type:'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'swazz.config.json';
                            a.click();
                            URL.revokeObjectURL(url);
                            onToast('Config exported', 'success');
                        }}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Export Config
                    </button>
                </div>
            </Section>
            {showPayloadSettings && (
                <PayloadSettingsModal onClose={() => setShowPayloadSettings(false)} />
            )}
        </aside>
    );
}
