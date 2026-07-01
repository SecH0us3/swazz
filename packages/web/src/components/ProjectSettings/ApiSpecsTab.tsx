import React, { useState } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { useToast } from '../../hooks/useToast.js';
import { loadSwaggerUrl, parseRawSpec } from '../../services/swaggerService.js';

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

            updateConfig({
                _swagger_urls: newUrls,
                base_url: basePath || config.base_url,
                endpoints: uniqueEndpoints
            });
            setUrlInput('');
            showToast(`✓ Loaded ${endpointCount} endpoints from ${trimmed}`, 'success');
        } catch (err: any) {
            showToast(`✗ Failed to load: ${err.message || String(err)}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const removeUrl = (url: string) => {
        const newUrls = swaggerUrls.filter((u) => u !== url);
        updateConfig({ _swagger_urls: newUrls });
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
            const otherEndpoints = (config.endpoints || []).filter(ep => {
                return true;
            });
            const combinedEndpoints = [...otherEndpoints, ...endpoints];
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
            showToast(`✓ Refreshed ${endpointCount} endpoints from ${url}`, 'success');
        } catch (err: any) {
            showToast(`✗ Refresh failed: ${err.message || String(err)}`, 'error');
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
                showToast(`✗ Failed to import file: ${err.message || String(err)}`, 'error');
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
                <h3 className="specs-section-title">Spec URLs</h3>
                <div className="specs-url-list">
                    {swaggerUrls.length === 0 ? (
                        <div className="specs-empty-state">No Spec URLs added yet.</div>
                    ) : (
                        swaggerUrls.map((url) => (
                            <div key={url} className="specs-url-item">
                                <span className="specs-url-text" title={url}>{url}</span>
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
                        ))
                    )}
                </div>

                <div className="specs-add-url-wrapper">
                    <input
                        className="input specs-add-url-input"
                        value={urlInput}
                        placeholder="https://petstore.swagger.io/v2/swagger.json"
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
