import React, { useState } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { useToast } from '../../hooks/useToast.js';
import { loadSwaggerUrl, parseRawSpec, ParsingError } from '../../services/swaggerService.js';
import { useAppStore } from '../../store/appStore.js';

export function ApiSpecsTab() {
    const { config, updateConfig } = useConfig();
    const { showToast } = useToast();
    const swaggerUrls: string[] = config._swagger_urls || [];
    const [urlInput, setUrlInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

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
        if (swaggerUrls.includes(trimmed)) {
            showToast('This URL is already in the list', 'error');
            return;
        }
        const newUrls = [...swaggerUrls, trimmed];
        setIsLoading(true);
        try {
            showToast(`Loading endpoints from ${trimmed}...`, 'info');
            const { basePath, endpoints, endpointCount } = await loadSwaggerUrl(
                trimmed,
                config.global_headers,
                config.cookies,
                true
            );
            const combinedEndpoints = [...(config.endpoints || []), ...endpoints];
            // Remove duplicates
            const seen = new Set();
            const uniqueEndpoints = combinedEndpoints.filter(ep => {
                const key = `${ep.method.toUpperCase()} ${ep.path}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const updatedMetadata = {
                ...(config._swagger_metadata || {}),
                [trimmed]: {
                    endpointCount,
                    status: 'success' as const,
                    lastRefreshed: new Date().toISOString()
                }
            };

            updateConfig({
                _swagger_urls: newUrls,
                base_url: basePath || config.base_url,
                endpoints: uniqueEndpoints,
                _swagger_metadata: updatedMetadata
            });
            setUrlInput('');
            showToast(`✓ Loaded ${endpointCount} endpoints from ${trimmed}`, 'success');
        } catch (err: any) {
            const updatedMetadata = {
                ...(config._swagger_metadata || {}),
                [trimmed]: {
                    endpointCount: 0,
                    status: 'error' as const,
                    lastRefreshed: new Date().toISOString()
                }
            };
            updateConfig({
                _swagger_urls: newUrls,
                _swagger_metadata: updatedMetadata
            });
            if (err instanceof ParsingError) {
                useAppStore.setState({ parsingError: err.details });
            } else {
                useAppStore.setState({
                    parsingError: {
                        error: { message: err.message || String(err), stack: err.stack },
                        request: { url: trimmed, method: 'GET', headers: {} }
                    }
                });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const removeUrl = (url: string) => {
        const newUrls = swaggerUrls.filter((u) => u !== url);
        const updatedMetadata = { ...(config._swagger_metadata || {}) };
        delete updatedMetadata[url];
        updateConfig({ 
            _swagger_urls: newUrls,
            _swagger_metadata: updatedMetadata
        });
        showToast('Spec URL removed from project settings', 'success');
    };

    const refreshUrl = async (url: string) => {
        setIsLoading(true);
        try {
            showToast(`Refreshing endpoints from ${url}...`, 'info');
            const { basePath, endpoints, endpointCount } = await loadSwaggerUrl(
                url,
                config.global_headers,
                config.cookies,
                true
            );
            const otherEndpoints = config.endpoints || [];
            const combinedEndpoints = [...otherEndpoints, ...endpoints];
            const seen = new Set();
            const uniqueEndpoints = combinedEndpoints.filter(ep => {
                const key = `${ep.method.toUpperCase()} ${ep.path}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const updatedMetadata = {
                ...(config._swagger_metadata || {}),
                [url]: {
                    endpointCount,
                    status: 'success' as const,
                    lastRefreshed: new Date().toISOString()
                }
            };

            updateConfig({
                base_url: basePath || config.base_url,
                endpoints: uniqueEndpoints,
                _swagger_metadata: updatedMetadata
            });
            showToast(`✓ Refreshed ${endpointCount} endpoints from ${url}`, 'success');
        } catch (err: any) {
            const updatedMetadata = {
                ...(config._swagger_metadata || {}),
                [url]: {
                    endpointCount: 0,
                    status: 'error' as const,
                    lastRefreshed: new Date().toISOString()
                }
            };
            updateConfig({
                _swagger_metadata: updatedMetadata
            });
            if (err instanceof ParsingError) {
                useAppStore.setState({ parsingError: err.details });
            } else {
                useAppStore.setState({
                    parsingError: {
                        error: { message: err.message || String(err), stack: err.stack },
                        request: { url, method: 'GET', headers: {} }
                    }
                });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const refreshAllUrls = async () => {
        setIsLoading(true);
        try {
            showToast(`Refreshing all ${swaggerUrls.length} spec URLs...`, 'info');
            let totalEndpoints = 0;
            const updatedMetadata = { ...(config._swagger_metadata || {}) };
            const allNewEndpoints: any[] = [];

            let firstError: any = null;
            for (const url of swaggerUrls) {
                try {
                    const { endpoints, endpointCount } = await loadSwaggerUrl(
                        url,
                        config.global_headers,
                        config.cookies,
                        true
                    );
                    allNewEndpoints.push(...endpoints);
                    totalEndpoints += endpointCount;
                    updatedMetadata[url] = {
                        endpointCount,
                        status: 'success' as const,
                        lastRefreshed: new Date().toISOString()
                    };
                } catch (err: any) {
                    updatedMetadata[url] = {
                        endpointCount: 0,
                        status: 'error' as const,
                        lastRefreshed: new Date().toISOString()
                    };
                    if (!firstError) {
                        if (err instanceof ParsingError) {
                            firstError = err.details;
                        } else {
                            firstError = {
                                error: { message: err.message || String(err), stack: err.stack },
                                request: { url, method: 'GET', headers: {} }
                            };
                        }
                    }
                }
            }

            if (firstError) {
                useAppStore.setState({ parsingError: firstError });
            }

            const combinedEndpoints = [...(config.endpoints || []), ...allNewEndpoints];
            const seen = new Set();
            const uniqueEndpoints = combinedEndpoints.filter(ep => {
                const key = `${ep.method.toUpperCase()} ${ep.path}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            updateConfig({
                endpoints: uniqueEndpoints,
                _swagger_metadata: updatedMetadata
            });
            showToast(`✓ Refreshed all specs. Total loaded: ${totalEndpoints} endpoints`, 'success');
        } catch (err: any) {
            showToast(`✗ Refresh all failed: ${err.message || String(err)}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        const reader = new FileReader();
        reader.onload = async (event) => {
            const content = event.target?.result as string;
            if (!content) return;
            setIsLoading(true);
            try {
                showToast(`Parsing uploaded spec file ${file.name}...`, 'info');
                const { basePath, endpointCount, endpoints } = await parseRawSpec(content);
                const combinedEndpoints = [...(config.endpoints || []), ...endpoints];
                const seen = new Set();
                const uniqueEndpoints = combinedEndpoints.filter(ep => {
                    const key = `${ep.method.toUpperCase()} ${ep.path}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });

                updateConfig({
                    base_url: basePath || config.base_url,
                    endpoints: uniqueEndpoints
                });
                showToast(`✓ Successfully imported ${endpointCount} endpoints from ${file.name}`, 'success');
            } catch (err: any) {
                if (err instanceof ParsingError) {
                    useAppStore.setState({ parsingError: err.details });
                } else {
                    useAppStore.setState({
                        parsingError: {
                            error: { message: err.message || String(err), stack: err.stack },
                            request: { url: 'File Upload', method: 'POST', headers: {} }
                        }
                    });
                }
            } finally {
                setIsLoading(false);
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="card project-settings-card">
            <h2 className="project-settings-title-tab">API Specifications (OpenAPI, Swagger, HAR, Postman)</h2>
            <p className="project-settings-desc-tab">
                Load target endpoints, parameters, and schemas directly from API spec URLs or local files.
            </p>

            {/* Target URL Info */}
            <div className="settings-field-group">
                <label className="settings-field-label">Target Base URL</label>
                <input 
                    type="text" 
                    className="input settings-field-input" 
                    placeholder="e.g. https://api.production.internal"
                    value={config.base_url || ''} 
                    onChange={(e) => updateConfig({ base_url: e.target.value })}
                />
                <span className="settings-field-help">
                    Base URL prepended to all endpoints discovered from specs.
                </span>
            </div>

            {/* Upload Section */}
            <div className="specs-upload-section">
                <h3 className="specs-section-title">Upload API Spec File</h3>
                <p className="specs-section-desc">Upload a Swagger JSON/YAML, Postman Collection, or HAR file to populate endpoints.</p>
                <div className="specs-file-picker-wrapper">
                    <input
                        type="file"
                        accept=".json,.yaml,.yml,.har"
                        onChange={handleFileUpload}
                        className="specs-file-input"
                        id="specs-upload-input"
                    />
                    <label htmlFor="specs-upload-input" className="btn btn-secondary specs-upload-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        Choose Spec File...
                    </label>
                </div>
            </div>

            {/* Specs URLs Section */}
            <div className="specs-urls-section">
                <div className="specs-header-row">
                    <h3 className="specs-section-title">Spec URLs</h3>
                    {swaggerUrls.length > 2 && (
                        <button 
                            className="btn btn-secondary btn-sm" 
                            onClick={refreshAllUrls}
                            disabled={isLoading}
                        >
                            Refresh All
                        </button>
                    )}
                </div>

                <div className="specs-url-list">
                    {swaggerUrls.length === 0 ? (
                        <div className="specs-empty-state">No Spec URLs added yet.</div>
                    ) : (
                        swaggerUrls.map((url) => {
                            const meta = (config._swagger_metadata || {})[url];
                            const status = meta?.status || 'success';
                            const count = meta?.endpointCount !== undefined ? meta.endpointCount : 0;

                            return (
                                <div key={url} className="specs-url-item">
                                    <div className="specs-url-info">
                                        <span className="specs-url-text" title={url}>{url}</span>
                                        <div className="specs-url-meta-group">
                                            <span className={`specs-status-badge status-${status}`}>
                                                {status === 'success' ? '✓ Active' : '✗ Failed'}
                                            </span>
                                            {count > 0 && (
                                                <span className="specs-stats">{count} methods</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="specs-url-actions">
                                        <button 
                                            className="btn btn-ghost btn-sm" 
                                            onClick={() => refreshUrl(url)}
                                            disabled={isLoading}
                                            title="Refresh"
                                        >
                                            Refresh
                                        </button>
                                        <button 
                                            className="btn btn-danger btn-sm" 
                                            onClick={() => removeUrl(url)}
                                            disabled={isLoading}
                                            title="Remove"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="specs-add-url-wrapper">
                    <input
                        className="input specs-add-url-input"
                        value={urlInput}
                        placeholder="https://bbad.secmy.app/swagger.json"
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !isLoading && urlInput.trim() && addUrl()}
                    />
                    <button
                        className="btn btn-primary specs-add-url-btn"
                        onClick={addUrl}
                        disabled={isLoading || !urlInput.trim()}
                    >
                        Add URL
                    </button>
                </div>
            </div>
        </div>
    );
}
