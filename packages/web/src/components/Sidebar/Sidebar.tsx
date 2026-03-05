import React, { useState, useRef } from 'react';
import type { SwazzConfig, FuzzingProfile, Dictionary, EndpointConfig, SchemaProperty } from '@swazz/core';
import { parseSwaggerSpec } from '@swazz/core';

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

// ─── Collapsible Section ────────────────────────────────

function Section({ title, defaultOpen = true, count, children }: { title: string; defaultOpen?: boolean; count?: number; children: React.ReactNode }) {
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
                    {count !== undefined && count > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-disabled)', fontWeight: 400 }}>({count})</span>
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

// ─── Key-Value Editor ───────────────────────────────────

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
        const key = `new-${Date.now()}`;
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
                    <button className="kv-delete" onClick={() => remove(key)} title="Delete">
                        ✕
                    </button>
                </div>
            ))}
            <button className="kv-add" onClick={add}>+ Add {keyPlaceholder}</button>
        </div>
    );
}

// ─── Endpoint Editor Row ────────────────────────────────

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function EndpointRow({
    endpoint,
    onUpdate,
    onDelete,
}: {
    endpoint: EndpointConfig;
    onUpdate: (ep: EndpointConfig) => void;
    onDelete: () => void;
}) {
    const fieldCount = endpoint.schema?.properties ? Object.keys(endpoint.schema.properties).length : 0;

    return (
        <div style={{
            display: 'flex',
            gap: 4,
            alignItems: 'center',
            padding: '4px 0',
        }}>
            <select
                className="input"
                style={{ width: 72, flex: 'none', cursor: 'pointer' }}
                value={endpoint.method}
                onChange={(e) => onUpdate({ ...endpoint, method: e.target.value as any })}
            >
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
                className="input"
                style={{ flex: 1 }}
                value={endpoint.path}
                placeholder="/api/resource"
                onChange={(e) => onUpdate({ ...endpoint, path: e.target.value })}
            />
            <span style={{ fontSize: 10, color: 'var(--text-disabled)', width: 24, textAlign: 'center', flexShrink: 0 }}>
                {fieldCount > 0 ? `${fieldCount}f` : ''}
            </span>
            <button className="kv-delete" onClick={onDelete} title="Delete endpoint">✕</button>
        </div>
    );
}

// ─── Schema Editor (simple) ─────────────────────────────

function SchemaFieldRow({
    name,
    schema,
    onUpdate,
    onDelete,
}: {
    name: string;
    schema: SchemaProperty;
    onUpdate: (name: string, schema: SchemaProperty) => void;
    onDelete: () => void;
}) {
    return (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', paddingLeft: 8 }}>
            <input
                className="input"
                style={{ flex: 1 }}
                value={name}
                placeholder="field_name"
                onChange={(e) => onUpdate(e.target.value, schema)}
            />
            <select
                className="input"
                style={{ width: 80, cursor: 'pointer' }}
                value={schema.type || 'string'}
                onChange={(e) => onUpdate(name, { ...schema, type: e.target.value as any })}
            >
                <option value="string">string</option>
                <option value="integer">integer</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
            </select>
            <select
                className="input"
                style={{ width: 76, cursor: 'pointer' }}
                value={schema.format || ''}
                onChange={(e) => onUpdate(name, { ...schema, format: e.target.value || undefined })}
            >
                <option value="">—</option>
                <option value="email">email</option>
                <option value="uuid">uuid</option>
                <option value="date-time">datetime</option>
                <option value="uri">uri</option>
                <option value="ipv4">ipv4</option>
            </select>
            <button className="kv-delete" onClick={onDelete}>✕</button>
        </div>
    );
}

// ─── Main Sidebar ───────────────────────────────────────

export function Sidebar({
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
    const [swaggerUrl, setSwaggerUrl] = useState('');
    const [loadingSwagger, setLoadingSwagger] = useState(false);
    const [editingEndpoint, setEditingEndpoint] = useState<number | null>(null);

    const profiles: FuzzingProfile[] = ['RANDOM', 'BOUNDARY', 'MALICIOUS'];
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
                setDictText(JSON.stringify(JSON.parse(reader.result as string).dictionaries || {}, null, 2));
                onToast('Config imported successfully', 'success');
            } catch {
                onToast('Invalid config file', 'error');
            }
        };
        reader.readAsText(file);
    };

    // ─── Swagger/OpenAPI loader ───────────────────────────

    const handleLoadSwagger = async () => {
        if (!swaggerUrl.trim()) return;
        setLoadingSwagger(true);

        try {
            // Try via proxy first (CORS), fallback to direct
            let specText: string;
            try {
                const proxyUrl = import.meta.env.VITE_PROXY_URL || '';
                const res = await fetch(`${proxyUrl}/proxy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: swaggerUrl.trim(),
                        method: 'GET',
                        headers: config.global_headers,
                        cookies: config.cookies,
                    }),
                });
                const proxyResult = await res.json();
                specText = typeof proxyResult.body === 'string' ? proxyResult.body : JSON.stringify(proxyResult.body);
            } catch {
                // Direct fetch fallback
                const res = await fetch(swaggerUrl.trim());
                specText = await res.text();
            }

            const spec = JSON.parse(specText);
            const { basePath, endpoints } = parseSwaggerSpec(spec);

            if (endpoints.length === 0) {
                onToast('No endpoints found in the spec', 'error');
                return;
            }

            // Set base URL from spec if not already set
            if (basePath && !config.base_url) {
                onUpdateConfig({ base_url: basePath });
            }

            // Add endpoints
            onUpdateConfig({ endpoints: [...config.endpoints, ...endpoints] });
            onToast(`Loaded ${endpoints.length} endpoints from spec`, 'success');
        } catch (err) {
            onToast(`Failed to load spec: ${err instanceof Error ? err.message : String(err)}`, 'error');
        } finally {
            setLoadingSwagger(false);
        }
    };

    // ─── Endpoint management ──────────────────────────────

    const addEndpoint = () => {
        const newEp: EndpointConfig = {
            path: '/api/',
            method: 'POST',
            schema: { type: 'object', properties: {} },
        };
        onUpdateConfig({ endpoints: [...config.endpoints, newEp] });
        setEditingEndpoint(config.endpoints.length); // open editing for the new one
    };

    const updateEndpoint = (index: number, ep: EndpointConfig) => {
        const next = [...config.endpoints];
        next[index] = ep;
        onUpdateConfig({ endpoints: next });
    };

    const deleteEndpoint = (index: number) => {
        const next = config.endpoints.filter((_, i) => i !== index);
        onUpdateConfig({ endpoints: next });
        if (editingEndpoint === index) setEditingEndpoint(null);
    };

    const addField = (epIndex: number) => {
        const ep = config.endpoints[epIndex];
        const fields = ep.schema.properties || {};
        const newName = `field_${Object.keys(fields).length + 1}`;
        updateEndpoint(epIndex, {
            ...ep,
            schema: {
                ...ep.schema,
                properties: { ...fields, [newName]: { type: 'string' } },
            },
        });
    };

    const updateField = (epIndex: number, oldName: string, newName: string, schema: SchemaProperty) => {
        const ep = config.endpoints[epIndex];
        const fields = { ...(ep.schema.properties || {}) };
        if (oldName !== newName) delete fields[oldName];
        fields[newName] = schema;
        updateEndpoint(epIndex, {
            ...ep,
            schema: { ...ep.schema, properties: fields },
        });
    };

    const deleteField = (epIndex: number, fieldName: string) => {
        const ep = config.endpoints[epIndex];
        const fields = { ...(ep.schema.properties || {}) };
        delete fields[fieldName];
        updateEndpoint(epIndex, {
            ...ep,
            schema: { ...ep.schema, properties: fields },
        });
    };

    return (
        <aside className="sidebar">
            {/* Target URL */}
            <Section title="Target">
                <input
                    className="input"
                    value={config.base_url}
                    placeholder="https://api.example.com"
                    onChange={(e) => onUpdateConfig({ base_url: e.target.value })}
                />
            </Section>

            {/* Swagger/OpenAPI Loader */}
            <Section title="Load from Swagger" defaultOpen={false}>
                <div style={{ display: 'flex', gap: 4 }}>
                    <input
                        className="input"
                        style={{ flex: 1 }}
                        value={swaggerUrl}
                        placeholder="https://api.example.com/swagger.json"
                        onChange={(e) => setSwaggerUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLoadSwagger()}
                    />
                    <button
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: 'var(--font-size-xs)', flexShrink: 0 }}
                        onClick={handleLoadSwagger}
                        disabled={loadingSwagger || !swaggerUrl.trim()}
                    >
                        {loadingSwagger ? '...' : '↓'}
                    </button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
                    Uses configured Headers & Cookies for auth
                </div>
            </Section>

            {/* Endpoints */}
            <Section title="Endpoints" count={config.endpoints.length}>
                {config.endpoints.length === 0 ? (
                    <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)' }}>
                        Add endpoints manually or load from Swagger
                    </div>
                ) : (
                    config.endpoints.map((ep, i) => (
                        <div key={i}>
                            <EndpointRow
                                endpoint={ep}
                                onUpdate={(updated) => updateEndpoint(i, updated)}
                                onDelete={() => deleteEndpoint(i)}
                            />
                            {/* Toggle schema editor */}
                            <div style={{ paddingLeft: 4, marginBottom: 4 }}>
                                <button
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: editingEndpoint === i ? 'var(--color-action)' : 'var(--text-disabled)',
                                        fontSize: 10,
                                        cursor: 'pointer',
                                        padding: '2px 4px',
                                    }}
                                    onClick={() => setEditingEndpoint(editingEndpoint === i ? null : i)}
                                >
                                    {editingEndpoint === i ? '▼' : '▶'} schema ({Object.keys(ep.schema?.properties || {}).length} fields)
                                </button>
                            </div>

                            {/* Inline schema editor */}
                            {editingEndpoint === i && (
                                <div style={{
                                    paddingLeft: 4,
                                    marginBottom: 8,
                                    borderLeft: '2px solid var(--border-default)',
                                }}>
                                    {Object.entries(ep.schema?.properties || {}).map(([fieldName, fieldSchema]) => (
                                        <SchemaFieldRow
                                            key={fieldName}
                                            name={fieldName}
                                            schema={fieldSchema}
                                            onUpdate={(newName, newSchema) => updateField(i, fieldName, newName, newSchema)}
                                            onDelete={() => deleteField(i, fieldName)}
                                        />
                                    ))}
                                    <button
                                        className="kv-add"
                                        style={{ marginLeft: 8, marginTop: 4, fontSize: 10 }}
                                        onClick={() => addField(i)}
                                    >
                                        + Add Field
                                    </button>
                                </div>
                            )}
                        </div>
                    ))
                )}
                <button className="kv-add" onClick={addEndpoint} style={{ marginTop: 4 }}>
                    + Add Endpoint
                </button>
            </Section>

            {/* Profiles */}
            <Section title="Profiles">
                <div className="profile-toggles">
                    {profiles.map((p) => (
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
            <Section title="Headers" defaultOpen={Object.keys(config.global_headers).length > 0}>
                <KVEditor
                    entries={config.global_headers}
                    onChange={onUpdateHeaders}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                />
            </Section>

            {/* Cookies */}
            <Section title="Cookies" defaultOpen={Object.keys(config.cookies).length > 0}>
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
                    style={{ width: '100%' }}
                    onClick={() => {
                        const json = onExportConfig();
                        const blob = new Blob([json], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'wraggler.config.json';
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
