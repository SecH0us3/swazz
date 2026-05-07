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
    onImportRun: (data: any) => Promise<{ runId: string, run: any } | undefined>;
    className?: string;
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
    onImportRun,
    className,
}: Props) {
    const swaggerUrls: string[] = (config as any)._swagger_urls || [];
    const [urlInput, setUrlInput] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const setSwaggerUrls = (urls: string[]) => {
        onUpdateConfig({ _swagger_urls: urls } as any);
    };

    const normalizeUrl = (url: string) => {
        let cleanUrl = url.trim();
        if (!cleanUrl) return '';
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://') && !cleanUrl.includes('localhost')) {
            cleanUrl = `https://${cleanUrl}`;
        }
        return cleanUrl;
    };

    const addUrl = () => {
        const trimmed = normalizeUrl(urlInput);
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

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const json = JSON.parse(evt.target?.result as string);
                const result = await onImportRun(json);
                if (result) {
                    const { runId, run } = result;
                    onToast('CLI Report imported successfully', 'success');
                    (onLoadRun as any)(runId, run);
                }
            } catch (err) {
                onToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <aside className={`sidebar ${className || ''}`}>
            {/* History */}
            <Section 
                title="History" 
                count={runs.length} 
                defaultOpen={runs.length > 0}
                action={
                    <button 
                        className="btn btn-ghost btn-sm" 
                        style={{ padding: '2px 6px', height: 'auto', fontSize: 12 }}
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                        title="Import CLI Report (JSON)"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginRight: 4 }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        Import
                    </button>
                }
            >
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    accept=".json" 
                    onChange={handleFileChange} 
                />
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
                                            <span style={{ fontSize:12, color:'var(--text-muted)' }}>
                                                {new Date(r.startedAt).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}
                                            </span>
                                        </div>
                                        {errors5xx > 0 && (
                                            <span className="badge badge-error" style={{ fontSize:12, fontWeight: 600, padding:'2px 8px' }}>
                                                {errors5xx} crash{errors5xx > 1 ? 'es' : ''}
                                            </span>
                                        )}
                                    </div>

                                    {/* Row 2: URL */}
                                    <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:6 }}>
                                        {r.baseUrl || '(no url)'}
                                    </div>

                                    {/* Row 3: stats + buttons */}
                                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                        <span style={{ fontSize:12, color:'var(--text-disabled)', fontFamily:'var(--font-mono)' }}>
                                            {r.stats?.totalRequests?.toLocaleString() || 0} requests
                                        </span>
                                        <div style={{ display:'flex', gap:4 }}>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                style={{ fontSize:12, padding:'3px 8px' }}
                                                onClick={() => isLoaded ? onToast('Already loaded') : onLoadRun(r.id)}
                                            >
                                                {isLoaded ? '✓ Loaded' : 'Load'}
                                            </button>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                style={{ fontSize:12, padding:'3px 7px', color:'var(--color-error)' }}
                                                onClick={() => { if (confirm('Delete this scan history?')) onDeleteRun(r.id); }}
                                                title="Delete"
                                                aria-label="Delete scan history"
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
                                aria-label="Remove URL"
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
