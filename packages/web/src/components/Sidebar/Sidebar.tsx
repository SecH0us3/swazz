import { ChangeEvent, useState, useRef } from 'react';
import type { SwazzConfig, FuzzingProfile, Dictionary, EndpointConfig } from '../../types.js';
import { detectMcpServer, parseRawSpec } from '../../services/swaggerService.js';

import type { ScanRun } from '../../hooks/useDb.js';

import { Section } from './Shared.js';
import { EndpointTree } from './EndpointTree.js';
import { useAppStore } from '../../store/appStore.js';
import { ProjectSelector } from '../ProjectSelector.js';

interface Props {
    style?: React.CSSProperties;
    config: SwazzConfig;
    runs: ScanRun[];
    onLoadRun: (runId: string, importedRun?: any) => void;
    onDeleteRun: (runId: string) => void;
    onUpdateConfig: (partial: Partial<SwazzConfig>) => void;
    onToast: (message: string, type?: 'info' | 'success' | 'error') => void;
    onLoadEndpoints: (urls: string[], forceRebuild?: boolean) => Promise<any>;
    onImportRun: (data: any) => Promise<{ runId: string, run: any } | undefined>;
    className?: string;
    authEnabled?: boolean;
    token?: string | null;
}

export function Sidebar({
    style,
    config,
    runs,
    onLoadRun,
    onDeleteRun,
    onUpdateConfig,
    onToast,
    onLoadEndpoints,
    onImportRun,
    className,
    authEnabled = false,
    token = null,
}: Props) {
    const loadedRunId = useAppStore(state => state.loadedRunId);
    const isLoadingSpecs = useAppStore(state => state.isLoadingSpecs);
    
    const swaggerUrls: string[] = config._swagger_urls || [];
    const [urlInput, setUrlInput] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        const reader = new FileReader();
        reader.onload = async (event) => {
            const content = event.target?.result as string;
            if (!content) return;
            try {
                onToast(`Parsing uploaded file ${file.name}...`, 'info');
                const { basePath, endpointCount, endpoints } = await parseRawSpec(content);
                const combinedEndpoints = [...(config.endpoints || []), ...endpoints];
                const seen = new Set();
                const uniqueEndpoints = combinedEndpoints.filter(ep => {
                    const key = `${ep.method.toUpperCase()} ${ep.path}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });

                onUpdateConfig({
                    base_url: basePath || config.base_url,
                    endpoints: uniqueEndpoints
                });
                onToast(`✓ Loaded ${endpointCount} endpoints from ${file.name}`, 'success');
            } catch (err: any) {
                onToast(`✗ Failed to parse ${file.name}: ${err.message || String(err)}`, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const setSwaggerUrls = (urls: string[]) => {
        onUpdateConfig({ _swagger_urls: urls });
    };

    const normalizeUrl = (url: string) => {
        let cleanUrl = url.trim();
        if (!cleanUrl) return '';
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://') && !cleanUrl.includes('localhost')) {
            cleanUrl = `https://${cleanUrl}`;
        }
        return cleanUrl;
    };

    const addUrl = async () => {
        const trimmed = normalizeUrl(urlInput);
        if (!trimmed) return;

        try {
            onToast(`Checking target type for ${trimmed}...`, 'info');
            const mcpType = await detectMcpServer(trimmed);
            if (mcpType) {
                onUpdateConfig({
                    mcp_server: {
                        type: mcpType,
                        url: trimmed
                    }
                });
                onToast(`✓ Detected MCP Server (${mcpType.toUpperCase()}) at ${trimmed}. Enabled MCP Fuzzing! Fetching tools...`, 'success');
                // We do not return here! We want it to be added to swaggerUrls so it gets parsed
            }
        } catch {}

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

    const activeTab = useAppStore(state => state.activeTab);

    return (
        <aside className={`sidebar ${className || ''}`} style={style}>
            {authEnabled && token && (
                <div className="sidebar-project-selector" style={{
                    padding: '8px 12px 14px 12px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    marginBottom: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                }}>
                    <ProjectSelector />
                </div>
            )}


            {/* Swagger/OpenAPI/GraphQL Loader */}
            <Section title="API Specs (OpenAPI / GraphQL)" defaultOpen count={swaggerUrls.length}>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {swaggerUrls.length === 0 && (
                        <div style={{ color:'var(--text-disabled)', fontSize:'var(--font-size-xs)', padding:'2px 0', fontStyle:'italic' }}>
                            No URLs added yet
                        </div>
                    )}
                    {swaggerUrls.map((url) => {
                        const specCacheDates = useAppStore.getState().specCacheDates;
                        const cachedAt = specCacheDates[url];
                        return (
                            <div key={url} style={{ display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--bg-elevated)', borderRadius: 4, padding: '4px 8px', border: '1px solid var(--border-default)' }}>
                                <div className="swagger-url-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', flex: 1 }}>
                                        {isLoadingSpecs ? (
                                            <span className="swagger-url-loading-badge" title={`Loading specs for ${url}`}>
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="header-spin-icon">
                                                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                                                </svg>
                                                Loading specs…
                                            </span>
                                        ) : (
                                            <>
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink:0 }}>
                                                    <polyline points="20 6 9 17 4 12"/>
                                                </svg>
                                                <span className="swagger-url-text" title={url} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{url}</span>
                                            </>
                                        )}
                                    </div>
                                    <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink: 0 }}>
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            style={{ padding: '2px 4px', height: 'auto', display: 'flex', alignItems: 'center' }}
                                            onClick={() => onLoadEndpoints([url], true)}
                                            title="Refresh / Rebuild Cache"
                                            aria-label="Refresh Cache"
                                        >
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                                            </svg>
                                        </button>
                                        <button
                                            className="kv-delete"
                                            onClick={() => removeUrl(url)}
                                            title="Remove"
                                            aria-label="Remove URL"
                                            style={{ margin: 0, padding: '2px 4px', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                                        >✕</button>
                                    </div>
                                </div>
                                {cachedAt && (
                                    <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginLeft: 15, fontFamily: 'var(--font-mono)' }}>
                                        Cached: {new Date(cachedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <div className="sidebar-add-url-row">
                        <input
                            className="input sidebar-add-url-input"
                            value={urlInput}
                            placeholder="https://api.com/swagger.json or /graphql"
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                        />
                        <button
                            className="btn btn-primary btn-sm sidebar-add-url-btn"
                            onClick={addUrl}
                            disabled={!urlInput.trim()}
                        >
                            Add
                        </button>
                        <input
                            type="file"
                            accept=".json,.yaml,.yml,.har"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            className="sidebar-file-input-hidden"
                        />
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm sidebar-upload-btn"
                            title="Upload Spec / HAR File"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            📁
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
