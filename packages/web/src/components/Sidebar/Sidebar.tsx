import React, { useState, useRef } from 'react';
import type { SwazzConfig, FuzzingProfile, Dictionary, EndpointConfig, SchemaProperty } from '@swazz/core';
import { parseSwaggerSpec } from '@swazz/core';
import type { ScanRun } from '../../hooks/useDb.js';

import { Section } from './Shared.js';
import { EndpointTree } from './EndpointTree.js';

interface Props {
    config: SwazzConfig;
    runs: ScanRun[];
    loadedRunId: string | null;
    onLoadRun: (runId: string) => void;
    onDeleteRun: (runId: string) => void;
    onUpdateConfig: (partial: Partial<SwazzConfig>) => void;
    onToast: (message: string, type?: 'info' | 'success' | 'error') => void;
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
                            <span className="swagger-url-text" title={url} style={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{url}</span>
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
                <EndpointTree
                    endpoints={config.endpoints}
                    disabledEndpoints={config.disabled_endpoints || []}
                    onUpdateDisabled={(disabled_endpoints) => onUpdateConfig({ disabled_endpoints })}
                />
            </Section>
        </aside>
    );
}
