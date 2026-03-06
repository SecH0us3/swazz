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
}

const ALL_PROFILES: FuzzingProfile[] = ['RANDOM', 'BOUNDARY', 'MALICIOUS'];

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

    return (
        <aside className="sidebar" style={{ gridArea: 'unset', borderLeft: '1px solid var(--border-subtle)', borderRight: 'none' }}>
            {/* Profiles */}
            <Section title="Profiles">
                <div className="profile-toggles">
                    {ALL_PROFILES.map((p) => (
                        <div
                            key={p}
                            className={`profile-toggle ${p.toLowerCase()} ${activeProfiles.includes(p) ? 'active' : ''}`}
                            onClick={() => toggleProfile(p)}
                        >
                            <span className="dot" />
                            <span>{p}</span>
                        </div>
                    ))}
                </div>
            </Section>

            {/* Headers */}
            <Section title="Headers" count={Object.keys(config.global_headers).length} defaultOpen={Object.keys(config.global_headers).length > 0}>
                <KVEditor
                    entries={config.global_headers}
                    onChange={onUpdateHeaders}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                />
            </Section>

            {/* Cookies */}
            <Section title="Cookies" count={Object.keys(config.cookies).length} defaultOpen={Object.keys(config.cookies).length > 0}>
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
                    placeholder='{"email": ["test@test.com"], ...}'
                    spellCheck={false}
                />
                {dictError && (
                    <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>
                        {dictError}
                    </div>
                )}
            </Section>

            {/* Settings */}
            <Section title="Settings" defaultOpen={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {[
                        { label: 'Iterations', key: 'iterations_per_profile', value: config.settings.iterations_per_profile },
                        { label: 'Concurrency', key: 'concurrency', value: config.settings.concurrency },
                        { label: 'Timeout (ms)', key: 'timeout_ms', value: config.settings.timeout_ms },
                        { label: 'Delay (ms)', key: 'delay_between_requests_ms', value: config.settings.delay_between_requests_ms },
                    ].map(({ label, key, value }) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{label}</span>
                            <input
                                className="input"
                                type="number"
                                style={{ width: 80 }}
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
                <input
                    ref={fileRef}
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={handleImport}
                />
                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => fileRef.current?.click()}>
                    📂 Import Config
                </button>
                <button
                    className="btn btn-ghost"
                    style={{ width: '100%', marginTop: 4 }}
                    onClick={() => {
                        const json = onExportConfig();
                        const blob = new Blob([json], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'swazz.config.json';
                        a.click();
                        URL.revokeObjectURL(url);
                        onToast('Config exported', 'success');
                    }}
                >
                    💾 Export Config
                </button>
            </Section>
        </aside>
    );
}
