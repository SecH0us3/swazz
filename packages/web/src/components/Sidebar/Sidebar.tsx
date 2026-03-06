import React, { useState, useRef } from 'react';
import type { SwazzConfig, FuzzingProfile, Dictionary, EndpointConfig, SchemaProperty } from '@swazz/core';
import { parseSwaggerSpec } from '@swazz/core';
import type { ScanRun } from '../../hooks/useDb.js';

import { Section } from './Shared.js';

interface Props {
    config: SwazzConfig;
    runs: ScanRun[];
    loadedRunId: string | null;
    onLoadRun: (runId: string) => void;
    onDeleteRun: (runId: string) => void;
    onUpdateConfig: (partial: Partial<SwazzConfig>) => void;
    onToast: (message: string, type?: 'info' | 'success' | 'error') => void;
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
    runs,
    loadedRunId,
    onLoadRun,
    onDeleteRun,
    onUpdateConfig,
    onToast,
}: Props) {
    const [editingEndpoint, setEditingEndpoint] = useState<number | null>(null);

    const swaggerUrls: string[] = (config as any)._swagger_urls || [];
    const [urlInput, setUrlInput] = useState('');

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
            {/* History */}
            <Section title="History" count={runs.length} defaultOpen={runs.length > 0}>
                {runs.length === 0 ? (
                    <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)' }}>
                        No past scans yet
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {runs.map((r) => {
                            const errors5xx = r.stats?.statusCounts ? Object.entries(r.stats.statusCounts).filter(([s]) => s.startsWith('5')).reduce((acc: number, [, c]) => acc + (c as number), 0) : 0;
                            const isLoaded = loadedRunId === r.id;
                            return (
                                <div key={r.id} className="history-item" style={{
                                    border: `1px solid ${isLoaded ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '8px',
                                    background: isLoaded ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                            {new Date(r.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                        </span>
                                        {errors5xx > 0 && <span style={{ fontSize: '10px', color: 'var(--color-error)', fontWeight: 600 }}>{errors5xx}×💥</span>}
                                    </div>
                                    <div style={{ fontSize: '12px', wordBreak: 'break-all', marginBottom: 6, color: 'var(--text-primary)' }}>
                                        {r.baseUrl || '(no url)'}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>
                                            {r.stats?.totalRequests || 0} reqs
                                        </span>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button
                                                className="btn btn-ghost"
                                                style={{ padding: '2px 6px', fontSize: '10px' }}
                                                onClick={() => isLoaded ? onToast('Already loaded') : onLoadRun(r.id)}
                                            >
                                                👁 {isLoaded ? 'Loaded' : 'Load'}
                                            </button>
                                            <button
                                                className="btn btn-ghost"
                                                style={{ padding: '2px 6px', fontSize: '10px', color: 'var(--color-error)' }}
                                                onClick={() => {
                                                    if (confirm('Delete this scan history?')) onDeleteRun(r.id);
                                                }}
                                            >
                                                🗑
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>

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
            <Section title="Load from Swagger" defaultOpen count={swaggerUrls.length}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {swaggerUrls.length === 0 && (
                        <div style={{ color: 'var(--text-disabled)', fontSize: 'var(--font-size-xs)', padding: '2px 0' }}>
                            No URLs added yet
                        </div>
                    )}
                    {swaggerUrls.map((url) => (
                        <div key={url} className="swagger-url-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                            <span className="swagger-url-text" title={url} style={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{url}</span>
                            <button className="kv-delete" onClick={() => removeUrl(url)} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer' }}>✕</button>
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <input
                            className="input"
                            style={{ flex: 1, minWidth: 0 }}
                            value={urlInput}
                            placeholder="https://api.example.com/swagger.json"
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                        />
                        <button
                            className="btn btn-primary"
                            style={{ padding: '4px 10px', fontSize: 'var(--font-size-xs)', flexShrink: 0 }}
                            onClick={addUrl}
                            disabled={!urlInput.trim()}
                        >
                            +
                        </button>
                    </div>
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
        </aside>
    );
}
