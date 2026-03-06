import React, { useState, useRef } from 'react';
import type { SwazzConfig, FuzzingProfile, Dictionary } from '@swazz/core';

interface Props {
    config: SwazzConfig;
    isRunning: boolean;
    isPaused: boolean;
    onUpdateConfig: (partial: Partial<SwazzConfig>) => void;
    onUpdateHeaders: (h: Record<string, string>) => void;
    onUpdateCookies: (c: Record<string, string>) => void;
    onUpdateDictionaries: (d: Dictionary) => void;
    onUpdateProfiles: (p: FuzzingProfile[]) => void;
    onImportConfig: (json: string) => void;
    onExportConfig: () => string;
    onToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

// ─── Section ────────────────────────────────────────────────

function Section({
    title,
    defaultOpen = false,
    badge,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    badge?: number;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="sidebar-section">
            <div
                className="sidebar-section-header"
                data-collapsed={!open}
                onClick={() => setOpen(!open)}
            >
                <span>
                    {title}
                    {badge !== undefined && badge > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-disabled)', fontWeight: 400 }}>
                            ({badge})
                        </span>
                    )}
                </span>
                <span className="chevron">▼</span>
            </div>
            <div className="sidebar-section-content" data-collapsed={!open || undefined}>
                {children}
            </div>
        </div>
    );
}

// ─── Key-Value Editor ────────────────────────────────────────

function KVEditor({
    entries,
    onChange,
    keyPlaceholder = 'Key',
    valuePlaceholder = 'Value',
}: {
    entries: Record<string, string>;
    onChange: (entries: Record<string, string>) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
}) {
    const pairs = Object.entries(entries);

    const update = (oldKey: string, newKey: string, value: string) => {
        const next = { ...entries };
        if (oldKey !== newKey) delete next[oldKey];
        next[newKey] = value;
        onChange(next);
    };

    const remove = (key: string) => {
        const next = { ...entries };
        delete next[key];
        onChange(next);
    };

    const add = () => {
        const key = `key-${Date.now()}`;
        onChange({ ...entries, [key]: '' });
    };

    return (
        <div className="kv-editor">
            {pairs.map(([key, value], i) => (
                <div key={i} className="kv-row">
                    <input
                        className="input"
                        value={key}
                        placeholder={keyPlaceholder}
                        onChange={(e) => update(key, e.target.value, value)}
                    />
                    <input
                        className="input"
                        value={value}
                        placeholder={valuePlaceholder}
                        onChange={(e) => update(key, key, e.target.value)}
                    />
                    <button className="kv-delete" onClick={() => remove(key)} title="Remove">✕</button>
                </div>
            ))}
            <button className="kv-add" onClick={add}>+ Add {keyPlaceholder}</button>
        </div>
    );
}

// ─── Main Setup Panel ────────────────────────────────────────

const ALL_PROFILES: FuzzingProfile[] = ['RANDOM', 'BOUNDARY', 'MALICIOUS'];

export function SetupPanel({
    config,
    onUpdateConfig,
    onUpdateHeaders,
    onUpdateCookies,
    onUpdateDictionaries,
    onUpdateProfiles,
    onImportConfig,
    onExportConfig,
    onToast,
}: Props) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [dictText, setDictText] = useState(JSON.stringify(config.dictionaries, null, 2));
    const [dictError, setDictError] = useState('');

    // Swagger URL list (stored locally as comma-separated or array in config)
    const [urlInput, setUrlInput] = useState('');
    const swaggerUrls: string[] = (config as any)._swagger_urls || [];

    const setSwaggerUrls = (urls: string[]) => {
        onUpdateConfig({ _swagger_urls: urls } as any);
    };

    const addUrl = () => {
        const trimmed = urlInput.trim();
        if (!trimmed) return;
        if (swaggerUrls.includes(trimmed)) {
            onToast('This URL is already in the list', 'error');
            return;
        }
        setSwaggerUrls([...swaggerUrls, trimmed]);
        setUrlInput('');
    };

    const removeUrl = (url: string) => {
        setSwaggerUrls(swaggerUrls.filter((u) => u !== url));
    };

    const activeProfiles = config.settings.profiles;
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
        <aside className="sidebar">
            {/* ── Swagger URLs ─────────────────── */}
            <Section title="Swagger URLs" defaultOpen badge={swaggerUrls.length}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {swaggerUrls.length === 0 && (
                        <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)', padding: '2px 0' }}>
                            No URLs added yet
                        </div>
                    )}
                    {swaggerUrls.map((url) => (
                        <div key={url} className="swagger-url-row">
                            <span className="swagger-url-text" title={url}>{url}</span>
                            <button className="kv-delete" onClick={() => removeUrl(url)} title="Remove">✕</button>
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <input
                            className="input"
                            style={{ flex: 1 }}
                            value={urlInput}
                            placeholder="https://api.example.com/swagger.json"
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                        />
                        <button
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 'var(--font-size-xs)', flexShrink: 0 }}
                            onClick={addUrl}
                            disabled={!urlInput.trim()}
                        >
                            Add
                        </button>
                    </div>
                    {swaggerUrls.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                            Specs will be loaded automatically when you start
                        </div>
                    )}
                </div>
            </Section>

            {/* ── Profiles ─────────────────────── */}
            <Section title="Fuzz Profiles" defaultOpen>
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

            {/* ── Auth: Headers ─────────────────── */}
            <Section title="Auth Headers" defaultOpen={Object.keys(config.global_headers).length > 0} badge={Object.keys(config.global_headers).length}>
                <KVEditor
                    entries={config.global_headers}
                    onChange={onUpdateHeaders}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                />
            </Section>

            {/* ── Auth: Cookies ─────────────────── */}
            <Section title="Cookies" badge={Object.keys(config.cookies).length}>
                <KVEditor
                    entries={config.cookies}
                    onChange={onUpdateCookies}
                    keyPlaceholder="Name"
                    valuePlaceholder="Value"
                />
            </Section>

            {/* ── Settings ─────────────────────── */}
            <Section title="Settings">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {([
                        { label: 'Iterations / profile', key: 'iterations_per_profile', value: config.settings.iterations_per_profile },
                        { label: 'Concurrency', key: 'concurrency', value: config.settings.concurrency },
                        { label: 'Timeout (ms)', key: 'timeout_ms', value: config.settings.timeout_ms },
                        { label: 'Delay between reqs (ms)', key: 'delay_between_requests_ms', value: config.settings.delay_between_requests_ms },
                    ] as const).map(({ label, key, value }) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{label}</span>
                            <input
                                className="input"
                                type="number"
                                style={{ width: 80 }}
                                value={value}
                                onChange={(e) =>
                                    onUpdateConfig({
                                        settings: { ...config.settings, [key]: parseInt(e.target.value) || 0 } as any,
                                    })
                                }
                            />
                        </div>
                    ))}
                </div>
            </Section>

            {/* ── Dictionaries ─────────────────── */}
            <Section title="Dictionaries">
                <textarea
                    className="textarea"
                    value={dictText}
                    onChange={(e) => setDictText(e.target.value)}
                    onBlur={handleDictBlur}
                    placeholder='{"email": ["test@test.com"], ...}'
                    spellCheck={false}
                />
                {dictError && (
                    <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' }}>{dictError}</div>
                )}
            </Section>

            {/* ── Import / Export ───────────────── */}
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
                    style={{ width: '100%' }}
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
