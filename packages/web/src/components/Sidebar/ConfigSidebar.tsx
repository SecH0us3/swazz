import React, { useRef, useState } from 'react';
import type { SwazzConfig, FuzzingProfile, Dictionary } from '@swazz/core';
import { Section, KVEditor } from './Shared.js';

interface Props {
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

    const activeProfiles = config.settings.profiles || [];
    const toggleProfile = (p: FuzzingProfile) => {
        const isActive = activeProfiles.includes(p);
        const next = isActive ? activeProfiles.filter((x) => x !== p) : [...activeProfiles, p];
        if (next.length > 0) onUpdateProfiles(next);
    };

    const handleDictBlur = () => {
        try {
            const parsed = JSON.parse(dictText);
            onUpdateDictionaries(parsed);
            setDictError('');
        } catch {
            setDictError('Invalid JSON');
        }
    };

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        { label: 'Iterations / profile', key: 'iterations_per_profile', value: config.settings.iterations_per_profile },
        { label: 'Concurrency', key: 'concurrency', value: config.settings.concurrency },
        { label: 'Timeout (ms)', key: 'timeout_ms', value: config.settings.timeout_ms },
        { label: 'Delay (ms)', key: 'delay_between_requests_ms', value: config.settings.delay_between_requests_ms },
    ];

    return (
        <aside className={`config-sidebar ${className || ''}`} style={{ gridArea:'unset', borderLeft:'1px solid var(--border-subtle)', borderRight:'none' }}>

            {/* Profiles */}
            <Section title="Profiles">
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
        </aside>
    );
}
