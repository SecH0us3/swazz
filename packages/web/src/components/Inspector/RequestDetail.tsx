import { ReactNode, useState, useEffect } from 'react';
import type { FuzzResult, SwazzConfig, AnalysisFinding } from '../../types.js';
import { generateTemplateFromSchema, parseQueryParams, renderJsonDiff } from './diffUtils.js';

interface Props {
    result: FuzzResult;
    baseUrl: string;
    onClose: () => void;
    onReplay?: (req: any) => Promise<any>;
    globalHeaders: Record<string, string>;
    globalCookies: Record<string, string>;
    config?: SwazzConfig;
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
    if (typeof val === 'string') {
        try {
            // Check if it looks like JSON before trying to parse
            const trimmed = val.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                const parsed = JSON.parse(trimmed);
                return JSON.stringify(parsed, null, 2);
            }
        } catch {
            // Not valid JSON or failed to parse
        }
        return val;
    }
    return JSON.stringify(val, null, 2);
}

export function RequestDetail({
    result,
    baseUrl,
    onClose,
    onReplay,
    globalHeaders,
    globalCookies,
    config
}: Props) {
    const [copied, setCopied] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'raw' | 'diff'>('diff');

    const initialUrl = joinUrl(baseUrl, result.resolvedPath || result.endpoint);
    const initialBody = formatValue(result.payload);

    const [editedUrl, setEditedUrl] = useState(initialUrl);
    const [editedBody, setEditedBody] = useState(initialBody);

    useEffect(() => {
        setEditedBody(formatValue(result.payload));
    }, [result.payload]);

    const matchingEndpoint = config?.endpoints.find(
        (ep) => ep.path === result.endpoint && ep.method.toUpperCase() === result.method.toUpperCase()
    );

    // Process body payload diff
    let parsedFuzzedBody: any = undefined;
    let parsedTemplateBody: any = undefined;
    let isJson = false;

    if (result.payload !== undefined && result.payload !== null) {
        if (typeof result.payload === 'string') {
            const trimmed = result.payload.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try {
                    parsedFuzzedBody = JSON.parse(trimmed);
                    isJson = true;
                } catch {
                    parsedFuzzedBody = result.payload;
                }
            } else {
                parsedFuzzedBody = result.payload;
            }
        } else if (typeof result.payload === 'object') {
            parsedFuzzedBody = result.payload;
            isJson = true;
        } else {
            parsedFuzzedBody = result.payload;
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

    const [liveStatus, setLiveStatus] = useState<number>(result.status);
    const [liveResponse, setLiveResponse] = useState<any>(result.responseBody);
    const [isReplaying, setIsReplaying] = useState(false);

    const copy = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(label);
            setTimeout(() => setCopied(null), 2000);
        });
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
        } catch (err) {
            setLiveStatus(0);
            setLiveResponse(err instanceof Error ? err.message : String(err));
        } finally {
            setIsReplaying(false);
        }
    };

    let responseBodyJson = '';
    if (liveResponse !== undefined) {
        if (typeof liveResponse === 'string') {
            try {
                const parsed = JSON.parse(liveResponse);
                responseBodyJson = JSON.stringify(parsed, null, 2);
            } catch {
                responseBodyJson = liveResponse;
            }
        } else {
            responseBodyJson = JSON.stringify(liveResponse, null, 2);
        }
    }

    const statusClass =
        liveStatus >= 500 ? 'status-5xx' :
        liveStatus >= 400 ? 'status-4xx' :
        liveStatus > 0 ? 'status-2xx' : 'status-5xx';

    return (
        <div className="modal-backdrop">
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal-content">
                <div className="modal-header">
                    <div style={{ display:'flex', alignItems:'center', gap:'var(--space-4)' }}>
                        <div className={`detail-status ${statusClass}`}>
                            {liveStatus || 'ERR'}
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                <span className={`method method-${result.method.toLowerCase()}`} style={{ fontSize:'var(--font-size-md)' }}>
                                    {result.method}
                                </span>
                                <span style={{ color:'var(--text-primary)', fontWeight:600 }}>{result.endpoint}</span>
                            </div>
                            <div style={{ fontSize:'var(--font-size-xs)', color:'var(--text-muted)' }}>
                                Profile: <span style={{ color:'var(--text-secondary)' }}>{result.profile}</span>
                                { (result.payload === undefined && result.responseBody === undefined) && (
                                    <span style={{ color:'var(--accent-light)', marginLeft:8 }}>· Loading full data...</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div style={{ display:'flex', gap:'var(--space-2)' }}>
                        <button className="btn btn-primary" onClick={handleReplay} disabled={isReplaying}>
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
                            <div className="detail-diff-container">
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
                                        {result.resolvedPath || result.endpoint}
                                    </div>
                                </div>

                                {hasQueryDiff && (
                                    <div className="detail-query-diff-section">
                                        <div className="detail-section-title">Query Parameters Diff</div>
                                        <div className="detail-json-wrapper detail-diff-json-wrapper">
                                            <pre className="detail-json detail-diff-json-pre">
                                                {renderJsonDiff(fuzzedQueryParams, templateQueryParams, result.profile === 'MALICIOUS')}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                                {result.payload !== undefined && result.payload !== null && (
                                    <div className="detail-body-diff-section">
                                        <div className="detail-section-title">Request Body Diff</div>
                                        <div className="detail-json-wrapper detail-diff-json-wrapper">
                                            <pre className="detail-json detail-diff-json-pre">
                                                {isJson ? (
                                                    renderJsonDiff(parsedFuzzedBody, parsedTemplateBody, result.profile === 'MALICIOUS')
                                                ) : (
                                                    <span className={result.profile === 'MALICIOUS' ? 'diff-mutated-malicious' : 'diff-mutated-boundary'}>
                                                        {String(result.payload)}
                                                    </span>
                                                )}
                                            </pre>
                                        </div>
                                    </div>
                                )}
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
                        <div className="detail-json-wrapper">
                            <pre className="detail-json">
                                {renderHighlightedJson(responseBodyJson)}
                            </pre>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
