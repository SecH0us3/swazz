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
    onLoadEndpoints: (urls: string[]) => Promise<any>;
}

export function Sidebar({
    config,
    runs,
    loadedRunId,
    onLoadRun,
    onDeleteRun,
    onUpdateConfig,
    onToast,
    onLoadEndpoints,
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
        const newUrls = [...swaggerUrls, trimmed];
        setSwaggerUrls(newUrls);
        setUrlInput('');
        onLoadEndpoints(newUrls);
    };

    const removeUrl = (url: string) => {
        setSwaggerUrls(swaggerUrls.filter((u) => u !== url));
    };

    return (
        <aside className="sidebar">
            {/* History */}
            <Section title="History" count={runs.length} defaultOpen={runs.length > 0}>
                {runs.length === 0 ? (
                    <div style={{ color:'var(--text-disabled)', fontSize:'var(--font-size-xs)', padding:'4px 0', fontStyle:'italic' }}>
                        No past scans yet
                    </div>
                ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {runs.map((r) => {
                            const errors5xx = r.stats?.statusCounts
                                ? Object.entries(r.stats.statusCounts)
                                    .filter(([s]) => s.startsWith('5'))
                                    .reduce((acc: number, [, c]) => acc + (c as number), 0)
                                : 0;
                            const isLoaded = loadedRunId === r.id;
                            return (
                                <div
                                    key={r.id}
                                    className="history-item"
                                    style={{
                                        border: `1px solid ${isLoaded ? 'rgba(124,58,237,0.5)' : 'var(--border-default)'}`,
                                        background: isLoaded ? 'rgba(124,58,237,0.06)' : 'var(--bg-elevated)',
                                    }}
                                >
                                    {/* Row 1: date + crash badge */}
                                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                                        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color:'var(--text-disabled)', flexShrink:0 }}>
                                                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                                            </svg>
                                            <span style={{ fontSize:10, color:'var(--text-muted)' }}>
                                                {new Date(r.startedAt).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}
                                            </span>
                                        </div>
                                        {errors5xx > 0 && (
                                            <span className="badge badge-error" style={{ fontSize:9, padding:'1px 6px' }}>
                                                {errors5xx} crash{errors5xx > 1 ? 'es' : ''}
                                            </span>
                                        )}
                                    </div>

                                    {/* Row 2: URL */}
                                    <div style={{ fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:6 }}>
                                        {r.baseUrl || '(no url)'}
                                    </div>

                                    {/* Row 3: stats + buttons */}
                                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                        <span style={{ fontSize:10, color:'var(--text-disabled)', fontFamily:'var(--font-mono)' }}>
                                            {r.stats?.totalRequests?.toLocaleString() || 0} requests
                                        </span>
                                        <div style={{ display:'flex', gap:4 }}>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                style={{ fontSize:10, padding:'3px 8px' }}
                                                onClick={() => isLoaded ? onToast('Already loaded') : onLoadRun(r.id)}
                                            >
                                                {isLoaded ? '✓ Loaded' : 'Load'}
                                            </button>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                style={{ fontSize:10, padding:'3px 7px', color:'var(--color-error)' }}
                                                onClick={() => { if (confirm('Delete this scan history?')) onDeleteRun(r.id); }}
                                                title="Delete"
                                            >
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/>
                                                </svg>
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
            <Section title="Swagger / OpenAPI" defaultOpen count={swaggerUrls.length}>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {swaggerUrls.length === 0 && (
                        <div style={{ color:'var(--text-disabled)', fontSize:'var(--font-size-xs)', padding:'2px 0', fontStyle:'italic' }}>
                            No URLs added yet
                        </div>
                    )}
                    {swaggerUrls.map((url) => (
                        <div key={url} className="swagger-url-row">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink:0 }}>
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span className="swagger-url-text" title={url}>{url}</span>
                            <button
                                className="kv-delete"
                                onClick={() => removeUrl(url)}
                                title="Remove"
                            >✕</button>
                        </div>
                    ))}
                    <div style={{ display:'flex', gap:4 }}>
                        <input
                            className="input"
                            style={{ flex:1, minWidth:0 }}
                            value={urlInput}
                            placeholder="https://api.example.com/swagger.json"
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                        />
                        <button
                            className="btn btn-primary btn-sm"
                            style={{ flexShrink:0 }}
                            onClick={addUrl}
                            disabled={!urlInput.trim()}
                        >
                            Add
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
