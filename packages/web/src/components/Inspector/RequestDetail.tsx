import { ReactNode, useState, useEffect } from 'react';
import type { FuzzResult, SwazzConfig, AnalysisFinding } from '../../types.js';
import { generateTemplateFromSchema, parseQueryParams, renderJsonDiff } from './diffUtils.js';

function tryParseEmbeddedJson(val: any): any {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                const parsed = JSON.parse(val);
                return tryParseEmbeddedJson(parsed);
            } catch {
                const startArray = trimmed.indexOf('[');
                const startObject = trimmed.indexOf('{');
                let startIdx = -1;
                if (startArray !== -1 && startObject !== -1) {
                    startIdx = Math.min(startArray, startObject);
                } else if (startArray !== -1) {
                    startIdx = startArray;
                } else if (startObject !== -1) {
                    startIdx = startObject;
                }

                if (startIdx !== -1) {
                    const prefix = trimmed.substring(0, startIdx).trim();
                    const jsonPart = trimmed.substring(startIdx);
                    try {
                        const parsed = JSON.parse(jsonPart);
                        return {
                            message: prefix,
                            details: tryParseEmbeddedJson(parsed)
                        };
                    } catch {}
                }
            }
        } else {
            const startArray = trimmed.indexOf('[');
            const startObject = trimmed.indexOf('{');
            let startIdx = -1;
            if (startArray !== -1 && startObject !== -1) {
                startIdx = Math.min(startArray, startObject);
            } else if (startArray !== -1) {
                startIdx = startArray;
            } else if (startObject !== -1) {
                startIdx = startObject;
            }

            if (startIdx !== -1) {
                const prefix = trimmed.substring(0, startIdx).trim();
                const jsonPart = trimmed.substring(startIdx);
                try {
                    const parsed = JSON.parse(jsonPart);
                    return {
                        message: prefix,
                        details: tryParseEmbeddedJson(parsed)
                    };
                } catch {}
            }
        }
        return val;
    }
    if (Array.isArray(val)) {
        return val.map(item => tryParseEmbeddedJson(item));
    }
    if (typeof val === 'object') {
        const res: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
            res[k] = tryParseEmbeddedJson(v);
        }
        return res;
    }
    return val;
}

interface Props {
    result: FuzzResult;
    baseUrl: string;
    onClose: () => void;
    onReplay?: (req: any) => Promise<any>;
    globalHeaders: Record<string, string>;
    globalCookies: Record<string, string>;
    config?: SwazzConfig;
    onTriage?: (id: string, status: 'false_positive' | 'ignored' | 'acknowledged' | 'none') => void;
}

function renderHighlightedJson(json: string): ReactNode {
    if (!json) {
        return <span style={{ color: 'var(--text-disabled)' }}>No response</span>;
    }

    const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
    const nodes: ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(json)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(json.slice(lastIndex, match.index));
        }
        let color = 'var(--color-warning)'; // number
        if (/^"/.test(match[0])) {
            color = /:$/.test(match[0]) ? 'var(--accent-light)' : 'var(--color-success)';
        } else if (/true|false/.test(match[0])) {
            color = 'var(--color-info)';
        } else if (/null/.test(match[0])) {
            color = 'var(--color-error)';
        }

        if (/:$/.test(match[0])) {
            const colonIndex = match[0].lastIndexOf(':');
            nodes.push(<span key={match.index} style={{ color }}>{match[0].slice(0, colonIndex)}</span>);
            nodes.push(match[0].slice(colonIndex));
        } else {
            nodes.push(<span key={match.index} style={{ color }}>{match[0]}</span>);
        }
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < json.length) {
        nodes.push(json.slice(lastIndex));
    }
    return nodes;
}

function joinUrl(base?: string, path?: string): string {
    const b = (base || '').replace(/\/+$/, '');
    const p = (path || '').replace(/^\/+/, '');
    return b && p ? `${b}/${p}` : `${b}${p}`;
}

function formatValue(val: any): string {
    if (val === undefined || val === null) return '';
    let valToFormat = val;
    if (typeof valToFormat === 'string') {
        const trimmed = valToFormat.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            try {
                valToFormat = JSON.parse(trimmed);
            } catch { /* ignore */ }
        }
    }

    if (typeof valToFormat === 'string') {
        try {
            const trimmed = valToFormat.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                const parsed = JSON.parse(trimmed);
                return JSON.stringify(parsed, null, 2);
            }
        } catch {
            // Not valid JSON or failed to parse
        }
        return valToFormat;
    }
    return JSON.stringify(valToFormat, null, 2);
}

function highlightOobPayload(text: string, uuid?: string): ReactNode {
    if (!uuid || !text || !text.includes(uuid)) {
        return text;
    }
    try {
        const escapedUuid = uuid.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(https?:\\/\\/[^\\s"'<>]*?${escapedUuid}|https?%3A%2F%2F[^\\s"'<>]*?${escapedUuid})`, 'i');
        const parts = text.split(regex);
        if (parts.length <= 1) {
            const uuidRegex = new RegExp(`(${escapedUuid})`, 'i');
            const subparts = text.split(uuidRegex);
            return (
                <>
                    {subparts.map((part, i) => 
                        part.toLowerCase() === uuid.toLowerCase() ? (
                            <span key={i} className="diff-mutated-malicious font-bold oob-badge-inline">
                                {part}
                            </span>
                        ) : part
                    )}
                </>
            );
        }
        return (
            <>
                {parts.map((part, i) => 
                    regex.test(part) ? (
                        <span key={i} className="diff-mutated-malicious font-bold oob-badge-dashed">
                            {part}
                        </span>
                    ) : part
                )}
            </>
        );
    } catch {
        return text;
    }
}

export function RequestDetail({
    result,
    baseUrl,
    onClose,
    onReplay,
    globalHeaders,
    globalCookies,
    config,
    onTriage
}: Props) {
    const [copied, setCopied] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'raw' | 'diff'>('diff');
    const [subTab, setSubTab] = useState<'body' | 'query' | 'headers'>('body');

    const isMultiIdentity = config?.settings?.bola_testing || Object.keys(config?.auth_identities || {}).length > 0;



    const isInjectedHeader = (key: string, value?: string) => {
        if (!result.analyzerFindings) return false;
        const lowerKey = key.toLowerCase();
        return result.analyzerFindings.some(finding => {
            if (finding.ruleId === 'swazz/crlf-injection') {
                const evidenceLower = (finding.evidence || '').toLowerCase();
                const messageLower = (finding.message || '').toLowerCase();
                const isKeyMatch = evidenceLower.includes("— " + lowerKey + ":") || 
                                   messageLower.includes("'" + lowerKey + ":") || 
                                   (lowerKey === 'set-cookie' && messageLower.includes('set-cookie'));
                if (!isKeyMatch) return false;
                if (value) {
                    const valLower = value.toLowerCase();
                    if (lowerKey === 'set-cookie') {
                        const cookiePart = valLower.split(';')[0].trim();
                        return evidenceLower.includes(cookiePart) || messageLower.includes(cookiePart);
                    }
                    return evidenceLower.includes(valLower) || messageLower.includes(valLower);
                }
                return true;
            }
            if ((finding.ruleId === 'swazz/header-injection' || finding.ruleId === 'swazz/cors-misconfig') && lowerKey === 'access-control-allow-origin') {
                if (value) {
                    const valLower = value.toLowerCase();
                    return (finding.evidence || '').toLowerCase().includes(valLower);
                }
                return true;
            }
            return false;
        });
    };

    const renderRequestHeaders = () => {
        if (!result.requestHeaders || Object.keys(result.requestHeaders).length === 0) return null;
        return (
            <div style={{ marginTop: 'var(--space-3)' }}>
                <div className="detail-section-title">Request Headers</div>
                <div className="detail-json-wrapper" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                    <div className="detail-headers-grid">
                        {Object.entries(result.requestHeaders).map(([key, val]) => (
                            <div key={key} className="detail-header-row">
                                <span className="detail-header-name">{key}:</span>
                                <span className="detail-header-value" style={{ wordBreak: 'break-all' }}>{highlightOobPayload(val, result.id)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const initialUrl = joinUrl(baseUrl, result.resolvedPath || result.endpoint);
    const initialBody = formatValue(result.payload);

    const [liveStatus, setLiveStatus] = useState<number>(result.status);
    const [liveResponse, setLiveResponse] = useState<any>(result.responseBody);
    const [liveHeaders, setLiveHeaders] = useState<Record<string, string[]>>(result.responseHeaders || {});
    const [isReplaying, setIsReplaying] = useState(false);

    const [editedUrl, setEditedUrl] = useState(initialUrl);
    const [editedBody, setEditedBody] = useState(initialBody);

    useEffect(() => {
        setEditedUrl(joinUrl(baseUrl, result.resolvedPath || result.endpoint));
        setEditedBody(formatValue(result.payload));
        setLiveStatus(result.status);
        setLiveResponse(result.responseBody);
        setLiveHeaders(result.responseHeaders || {});
    }, [result, baseUrl]);

    const matchingEndpoint = config?.endpoints.find(
        (ep) => ep.path === result.endpoint && ep.method.toUpperCase() === result.method.toUpperCase()
    );

    // Process body payload diff
    let parsedFuzzedBody: any = undefined;
    let parsedTemplateBody: any = undefined;
    let isJson = false;

    if (result.payload !== undefined && result.payload !== null) {
        let payloadToParse = result.payload;
        if (typeof payloadToParse === 'string') {
            const trimmed = payloadToParse.trim();
            if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                try {
                    payloadToParse = JSON.parse(trimmed);
                } catch { /* ignore */ }
            }
        }

        if (typeof payloadToParse === 'string') {
            const trimmed = payloadToParse.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    parsedFuzzedBody = JSON.parse(trimmed);
                    isJson = true;
                } catch {
                    parsedFuzzedBody = payloadToParse;
                }
            } else {
                parsedFuzzedBody = payloadToParse;
            }
        } else if (typeof payloadToParse === 'object') {
            parsedFuzzedBody = payloadToParse;
            isJson = true;
        } else {
            parsedFuzzedBody = payloadToParse;
        }
    }

    if (isJson && matchingEndpoint?.schema) {
        try {
            parsedTemplateBody = generateTemplateFromSchema(matchingEndpoint.schema);
        } catch { /* ignore */ }
    }

    // Process query params diff
    const fuzzedQueryParams = parseQueryParams(result.resolvedPath);
    let templateQueryParams: Record<string, any> = {};
    if (matchingEndpoint?.schema && (!matchingEndpoint.schema.type || matchingEndpoint.schema.type === 'object') && matchingEndpoint.schema.properties) {
        // If there's no body, schema properties represent the query params (e.g. GET requests)
        const parsedQuerySchema = generateTemplateFromSchema(matchingEndpoint.schema);
        if (parsedQuerySchema && typeof parsedQuerySchema === 'object') {
            templateQueryParams = parsedQuerySchema;
        }
    }
    const hasQueryDiff = Object.keys(fuzzedQueryParams).length > 0 || Object.keys(templateQueryParams).length > 0;

    useEffect(() => {
        const hasBody = result.payload !== undefined && result.payload !== null;
        const hasHeaders = !!result.requestHeaders && Object.keys(result.requestHeaders).length > 0;
        if (hasBody) {
            setSubTab('body');
        } else if (hasQueryDiff) {
            setSubTab('query');
        } else if (hasHeaders) {
            setSubTab('headers');
        }
    }, [result, hasQueryDiff]);

    const copy = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(label);
            setTimeout(() => setCopied(null), 2000);
        }).catch(err => console.error('Failed to copy text: ', err));
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleReplay = async () => {
        if (!onReplay) return;
        setIsReplaying(true);
        try {
            // Try to parse as JSON, but fall back to raw string if it fails.
            // Truncated or intentionally malformed payloads are valid fuzz cases.
            let parsedBody: any = undefined;
            if (editedBody && editedBody.trim()) {
                try {
                    parsedBody = JSON.parse(editedBody);
                } catch {
                    parsedBody = editedBody; // send as raw string
                }
            }
            const response = await onReplay({
                url: editedUrl,
                method: result.method,
                headers: { ...globalHeaders },
                cookies: { ...globalCookies },
                body: parsedBody,
            });
            setLiveStatus(response.status);
            setLiveResponse(response.body);
            if (response.headers) {
                const formattedHeaders: Record<string, string[]> = {};
                for (const [k, v] of Object.entries(response.headers)) {
                    formattedHeaders[k] = Array.isArray(v) ? v : [v as string];
                }
                setLiveHeaders(formattedHeaders);
            } else {
                setLiveHeaders({});
            }
        } catch (err) {
            setLiveStatus(0);
            setLiveResponse(err instanceof Error ? err.message : String(err));
            setLiveHeaders({});
        } finally {
            setIsReplaying(false);
        }
    };

    let responseBodyJson = '';
    if (liveResponse !== undefined) {
        let parsed = liveResponse;
        if (typeof liveResponse === 'string') {
            try {
                parsed = JSON.parse(liveResponse);
            } catch {
                parsed = liveResponse;
            }
        }
        
        parsed = tryParseEmbeddedJson(parsed);

        if (typeof parsed === 'string') {
            responseBodyJson = parsed;
        } else {
            responseBodyJson = JSON.stringify(parsed, null, 2);
        }
    }

    let isMcpError = false;
    if ((result.method === 'CALL' || result.method === 'MCP') && liveResponse !== undefined) {
        let parsed = liveResponse;
        if (typeof liveResponse === 'string') {
            try {
                parsed = JSON.parse(liveResponse);
            } catch {}
        }
        if (parsed && typeof parsed === 'object' && parsed.isError === true) {
            isMcpError = true;
        }
    }

    const displayStatus = isMcpError ? (liveStatus === 200 ? 400 : liveStatus) : liveStatus;
    const statusClass =
        isMcpError ? (displayStatus >= 500 ? 'status-5xx' : 'status-4xx') :
        liveStatus >= 500 ? 'status-5xx' :
        liveStatus >= 400 ? 'status-4xx' :
        liveStatus > 0 ? 'status-2xx' : 'status-5xx';

    return (
        <div className="modal-backdrop">
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal-content">
                <div className="modal-header">
                    <div className="request-detail-header-meta">
                        <div className={`detail-status ${statusClass}`}>
                            {liveStatus === 0 ? <span title="Infinity (Timeout / Network Error)">∞</span> : (isMcpError ? `-${displayStatus}` : liveStatus || 'ERR')}
                        </div>
                        <div className="request-detail-header-info">
                            <div className="request-detail-endpoint-row">
                                <span className={`method method-${result.method.toLowerCase()}`} style={{ fontSize:'var(--font-size-md)' }}>
                                    {result.method}
                                </span>
                                <span className="request-detail-endpoint">{result.endpoint}</span>
                            </div>
                            <div className="request-detail-meta-row">
                                <span>Profile: <strong className="request-detail-profile-val">{result.profile}</strong></span>
                                {isMultiIdentity && (
                                    <>
                                        <span className="request-detail-separator">·</span>
                                        <span className="request-detail-identity-container">
                                            Identity: 
                                            <strong className={`request-detail-identity-badge ${result.identity === 'Anonymous' ? 'anonymous' : 'user-a'}`}>
                                                {result.identity || 'User A'}
                                            </strong>
                                        </span>
                                    </>
                                )}
                                { ((result.payload === undefined && result.payloadSize > 0) || (result.responseBody === undefined && (result.responseSize ?? 0) > 0)) && (
                                    <span style={{ color:'var(--accent-light)', marginLeft:2 }}>· Loading full data...</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div style={{ display:'flex', gap:'var(--space-2)', alignItems: 'center' }}>
                        {(() => {
                            const isErrorStatus = result.status >= 500 || 
                                                 (result.status === 0 && result.error) ||
                                                 (result.status >= 400 && ![401, 403, 404, 405, 422, 429].includes(result.status));
                            const isFinding = ((result.analyzerFindings && result.analyzerFindings.length > 0) || isErrorStatus) && !!onTriage;
                            if (isFinding) {
                                return (
                                    <select 
                                        className="btn btn-ghost btn-sm request-detail-triage-select"
                                        value={result.triage || 'none'}
                                        onChange={(e) => onTriage?.(result.id, e.target.value as any)}
                                    >
                                        <option value="none">🔍 No Triage</option>
                                        <option value="false_positive">❌ False Positive</option>
                                        <option value="ignored">🙈 Ignored</option>
                                        <option value="acknowledged">✅ Acknowledged</option>
                                    </select>
                                );
                            }
                            return null;
                        })()}
                        <button id="btn-replay" className="btn btn-primary" onClick={handleReplay} disabled={isReplaying}>
                            {isReplaying ? '↺ Sending...' : '↺ Replay'}
                        </button>
                        <button className="btn btn-icon" onClick={onClose} aria-label="Close" title="Close (Esc)">✕</button>
                    </div>
                </div>

                {result.analyzerFindings && result.analyzerFindings.length > 0 && (
                    <div className="analyzer-findings-alerts">
                        {result.analyzerFindings.map((finding, idx) => (
                            <div key={idx} className={`alert-banner alert-${finding.level}`}>
                                <div className="alert-banner-header">
                                    <span className={`alert-badge badge-${finding.level}`}>
                                        {finding.level}
                                    </span>
                                    <span>Vulnerability: {finding.ruleId}</span>
                                </div>
                                <div className="alert-banner-message">{finding.message}</div>
                                {finding.evidence && (
                                    <div className="alert-banner-evidence">
                                        {finding.evidence}
                                    </div>
                                )}
                                {finding.ai_status === 'completed' && (
                                    <div className="ai-insights-section">
                                        <div className="ai-insights-header">
                                            <span className="ai-insights-title">✨ AI Insights</span>
                                            <span className={`alert-badge ${finding.ai_relevance ? 'badge-error' : 'badge-success'}`}>
                                                {finding.ai_relevance ? 'True Positive' : 'False Positive'}
                                            </span>
                                        </div>
                                        {finding.ai_explanation && (
                                            <div className="ai-insights-block">
                                                <strong className="ai-insights-label">Explanation</strong>
                                                <div className="ai-insights-text">{finding.ai_explanation}</div>
                                            </div>
                                        )}
                                        {finding.ai_remediation && (
                                            <div className="ai-insights-block">
                                                <strong className="ai-insights-label">Remediation</strong>
                                                <div className="ai-insights-text">{finding.ai_remediation}</div>
                                            </div>
                                        )}
                                        {finding.ai_proposed_patch && (
                                            <div className="ai-insights-block">
                                                <strong className="ai-insights-label">Proposed Patch</strong>
                                                <div className="detail-json-wrapper">
                                                    <pre className="detail-json ai-insights-code">
                                                        <code>{finding.ai_proposed_patch}</code>
                                                    </pre>
                                                </div>
                                            </div>
                                        )}
                                        {finding.pr_link && (
                                            <div className="ai-insights-actions">
                                                <a href={finding.pr_link} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                                                    View Pull Request ↗
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div className="modal-split">
                    <div className="modal-pane">
                        <div className="detail-pane-header">
                            <span className="detail-section-title" style={{ margin: 0 }}>Request Details</span>
                            <div className="detail-toggle-group">
                                <button
                                    className={`btn btn-sm detail-toggle-btn ${viewMode === 'diff' ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setViewMode('diff')}
                                >
                                    Mutation Diff
                                </button>
                                <button
                                    className={`btn btn-sm detail-toggle-btn ${viewMode === 'raw' ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setViewMode('raw')}
                                >
                                    Raw Request
                                </button>
                            </div>
                        </div>

                        {viewMode === 'diff' ? (
                            <div className="detail-diff-container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', flex: 1, overflow: 'hidden' }}>
                                <div className="diff-legend">
                                    <span style={{ fontWeight: 500, marginRight: '4px' }}>Diff Legend:</span>
                                    <span className="diff-legend-item">
                                        <span className="diff-legend-dot added" /> Added Key
                                    </span>
                                    <span className="diff-legend-item">
                                        <span className="diff-legend-dot deleted" /> Deleted Key
                                    </span>
                                    <span className="diff-legend-item">
                                        <span className="diff-legend-dot mutated" /> Mutation
                                    </span>
                                    {result.profile === 'MALICIOUS' && (
                                        <span className="diff-legend-item">
                                            <span className="diff-legend-dot malicious" /> Malicious Payload
                                        </span>
                                    )}
                                </div>

                                <div>
                                    <div className="detail-section-title">Request URL</div>
                                    <div className="detail-url-display">
                                        {highlightOobPayload(result.resolvedPath || result.endpoint, result.id)}
                                    </div>
                                </div>

                                {(() => {
                                    const availableTabs = [
                                        { id: 'body', label: 'Request Body Diff', visible: result.payload !== undefined && result.payload !== null },
                                        { id: 'query', label: 'Query Parameters Diff', visible: hasQueryDiff },
                                        { id: 'headers', label: 'Request Headers', visible: !!result.requestHeaders && Object.keys(result.requestHeaders).length > 0 },
                                    ].filter(t => t.visible);

                                    if (availableTabs.length === 0) return null;

                                    return (
                                        <>
                                            <div className="detail-toggle-group" style={{ margin: 'var(--space-2) 0', display: 'flex', gap: 'var(--space-2)' }}>
                                                {availableTabs.map(t => (
                                                    <button
                                                        key={t.id}
                                                        className={`btn btn-sm detail-toggle-btn ${subTab === t.id ? 'btn-primary' : 'btn-ghost'}`}
                                                        onClick={() => setSubTab(t.id as any)}
                                                    >
                                                        {t.label}
                                                    </button>
                                                ))}
                                            </div>

                                            <div style={{ flex: 1, overflowY: 'auto' }}>
                                                {subTab === 'body' && result.payload !== undefined && result.payload !== null && (
                                                    <div className="detail-body-diff-section">
                                                        <div className="detail-json-wrapper detail-diff-json-wrapper">
                                                            <pre className="detail-json detail-diff-json-pre">
                                                                {isJson ? (
                                                                    renderJsonDiff(parsedFuzzedBody, parsedTemplateBody, result.profile === 'MALICIOUS', 0, result.id)
                                                                ) : (
                                                                    result.id && String(result.payload).includes(result.id) ? (
                                                                        highlightOobPayload(String(result.payload), result.id)
                                                                    ) : (
                                                                        <span className={result.profile === 'MALICIOUS' ? 'diff-mutated-malicious' : 'diff-mutated-boundary'}>
                                                                            {String(result.payload)}
                                                                        </span>
                                                                    )
                                                                )}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                )}

                                                {subTab === 'query' && hasQueryDiff && (
                                                    <div className="detail-query-diff-section">
                                                        <div className="detail-json-wrapper detail-diff-json-wrapper">
                                                            <pre className="detail-json detail-diff-json-pre">
                                                                {renderJsonDiff(fuzzedQueryParams, templateQueryParams, result.profile === 'MALICIOUS', 0, result.id)}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                )}

                                                {subTab === 'headers' && result.requestHeaders && Object.keys(result.requestHeaders).length > 0 && (
                                                    <div className="detail-json-wrapper">
                                                        <div className="detail-headers-grid">
                                                            {Object.entries(result.requestHeaders).map(([key, val]) => (
                                                                <div key={key} className="detail-header-row">
                                                                    <span className="detail-header-name">{key}:</span>
                                                                    <span className="detail-header-value" style={{ wordBreak: 'break-all' }}>{highlightOobPayload(val, result.id)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flex: 1, overflow: 'hidden' }}>
                                <div>
                                    <div className="detail-section-title">Request URL</div>
                                    <input
                                        className="input"
                                        style={{ fontFamily:'var(--font-mono)', fontSize:'var(--font-size-xs)', color:'var(--accent-light)' }}
                                        value={editedUrl}
                                        onChange={(e) => setEditedUrl(e.target.value)}
                                    />
                                </div>
                                {renderRequestHeaders()}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0 }}>
                                    <div className="detail-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>
                                            Payload
                                            {result.payload !== undefined && typeof result.payload === 'string' && result.payload.endsWith('…') && (
                                                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-disabled)', fontWeight: 400 }}>(preview — full payload not stored)</span>
                                            )}
                                        </span>
                                        <button className="btn btn-ghost btn-sm" onClick={() => copy(editedBody, 'payload')}>
                                            {copied === 'payload' ? '✓ Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <textarea
                                        className="textarea"
                                        style={{ flex: 1, margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}
                                        value={editedBody}
                                        onChange={(e) => setEditedBody(e.target.value)}
                                        spellCheck={false}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="modal-pane">
                        <div className="detail-section-title">Response Body</div>
                        <div className="detail-json-wrapper detail-spacing-bottom">
                            <pre className="detail-json detail-json-with-action">
                                {renderHighlightedJson(responseBodyJson)}
                            </pre>
                            {responseBodyJson && (
                                <button
                                    className="btn btn-ghost btn-xs response-copy-btn"
                                    onClick={() => copy(responseBodyJson, 'responseBody')}
                                >
                                    {copied === 'responseBody' ? '✓ Copied' : 'Copy'}
                                </button>
                            )}
                        </div>

                        {liveHeaders && Object.keys(liveHeaders).length > 0 && (
                            <>
                                <div className="detail-section-title detail-section-title-divider">Response Headers</div>
                                <div className="detail-json-wrapper">
                                    <div className="detail-headers-grid">
                                        {Object.entries(liveHeaders).map(([key, values]) => {
                                            const hasAnyInjection = isInjectedHeader(key);
                                            return ( 
                                                <div key={key} className="detail-header-row">
                                                    <span 
                                                        className={`detail-header-name ${hasAnyInjection ? 'detail-header-name-injected' : ''}`}
                                                    >
                                                        {key}:
                                                        {hasAnyInjection && (
                                                            <span className="detail-header-badge-injected">
                                                                INJECTED
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="detail-header-value">
                                                        {values.map((val, idx) => {
                                                            const injected = isInjectedHeader(key, val);
                                                            return (
                                                                <span 
                                                                    key={idx}
                                                                    className={injected ? 'detail-header-value-injected' : ''}
                                                                >
                                                                    {val}{idx < values.length - 1 ? ',' : ''}
                                                                </span>
                                                            );
                                                        })}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
