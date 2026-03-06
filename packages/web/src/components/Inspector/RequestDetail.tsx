import React, { useState } from 'react';
import type { FuzzResult } from '@swazz/core';

interface Props {
    result: FuzzResult;
    baseUrl: string;
    onClose: () => void;
}

/**
 * Escape characters that the browser interprets as HTML.
 * Applied BEFORE any <span> injection so user-controlled payload values
 * (e.g. <script>alert(1)</script> or <img onerror=alert(1)>)
 * are rendered as plain text and never executed.
 */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Syntax-highlight a pretty-printed JSON string.
 * The string is HTML-escaped first, so payload values cannot inject HTML.
 * After escaping, quote characters are still literal " (JSON.stringify output
 * doesn't produce &, < or > in key names, only in values).
 */
function syntaxHighlight(json: string): string {
    const safe = escapeHtml(json);
    return safe
        // Keys:  "key":
        .replace(/("(?:\\.|[^"\\])*")\s*:/g, '<span style="color:var(--color-info)">$1</span>:')
        // String values:  : "value"
        .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span style="color:var(--color-success)">$1</span>')
        // Numbers
        .replace(/:\s*(-?\d+\.?\d*)/g, ': <span style="color:var(--color-warning)">$1</span>')
        // null / undefined / NaN
        .replace(/:\s*(null|undefined|NaN)/g, ': <span style="color:var(--color-error)">$1</span>')
        // booleans
        .replace(/:\s*(true|false)/g, ': <span style="color:var(--color-action)">$1</span>');
}

function joinUrl(base?: string, path?: string): string {
    const b = (base || '').replace(/\/+$/, '');
    const p = (path || '').replace(/^\/+/, '');
    return b && p ? `${b}/${p}` : `${b}${p}`;
}

function generateCurl(result: FuzzResult, baseUrl?: string): string {
    const url = joinUrl(baseUrl, result.resolvedPath || result.endpoint);
    let cmd = `curl -X ${result.method} '${url}'`;
    cmd += ` \\\n  -H 'Content-Type: application/json'`;
    if (result.payload !== undefined) {
        cmd += ` \\\n  -d '${JSON.stringify(result.payload)}'`;
    }
    return cmd;
}

export function RequestDetail({ result, baseUrl, onClose }: Props) {
    const [copied, setCopied] = useState<string | null>(null);

    const copy = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(label);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    const payloadJson = JSON.stringify(result.payload, null, 2) || '';
    const isLargePayload = payloadJson.length > 10000;

    let responseBodyJson = '';
    if (result.responseBody !== undefined) {
        responseBodyJson = typeof result.responseBody === 'string'
            ? result.responseBody
            : JSON.stringify(result.responseBody, null, 2);
    }
    const isLargeResponse = responseBodyJson.length > 10000;
    const statusColor =
        result.status >= 500 ? 'var(--color-error)' :
            result.status >= 400 ? 'var(--color-warning)' :
                'var(--color-success)';

    const resolvedUrl = joinUrl(baseUrl, result.resolvedPath || result.endpoint);
    const templateUrl = joinUrl(baseUrl, result.endpoint);
    const hasResolvedPath = result.resolvedPath && result.resolvedPath !== result.endpoint;

    return (
        <>
            <div className="detail-overlay" onClick={onClose} />
            <div className="detail-panel">
                {/* Header */}
                <div className="detail-header">
                    <div>
                        <div className="detail-status" style={{ color: statusColor }}>
                            {result.status || 'Network Error'}
                            {(result.retries ?? 0) > 0 && (
                                <span style={{
                                    marginLeft: 8,
                                    fontSize: 10,
                                    background: 'var(--color-warning-bg)',
                                    color: 'var(--color-warning)',
                                    padding: '1px 6px',
                                    borderRadius: 'var(--radius-full)',
                                    fontWeight: 600,
                                    verticalAlign: 'middle',
                                }}>{result.retries} retries (429)</span>
                            )}
                        </div>
                        <div className="detail-meta">
                            <span
                                style={{ wordBreak: 'break-all', userSelect: 'all' }}
                                title={resolvedUrl}
                            >
                                {result.method} {hasResolvedPath ? resolvedUrl : templateUrl}
                            </span>
                            {hasResolvedPath && (
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    template: {result.endpoint}
                                </span>
                            )}
                            <span>{result.profile} • {result.duration}ms</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button
                            className="btn btn-ghost"
                            title="Replay this request"
                            onClick={() => window.open(resolvedUrl, '_blank', 'noopener,noreferrer')}
                            style={{ fontSize: 12 }}
                        >
                            ↺ Replay
                        </button>
                        <button className="btn btn-ghost" onClick={onClose}>✕</button>
                    </div>
                </div>

                {/* Error message */}
                {result.error && (
                    <div style={{
                        padding: 'var(--space-3)',
                        background: 'var(--color-error-bg)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--color-error)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--font-size-xs)',
                    }}>
                        {/* result.error is a plain string — safe to render as text */}
                        {result.error}
                    </div>
                )}

                {/* Request Body */}
                <div className="detail-section">
                    <div className="detail-section-title">Request Body</div>
                    {isLargePayload ? (
                        <div className="detail-json" style={{ color: 'var(--text-muted)' }}>
                            [Large Payload Truncated]
                            <br />
                            <br />
                            <strong>Size:</strong> {(payloadJson.length / 1024).toFixed(1)} KB
                            <br />
                            <strong>Type:</strong> {typeof result.payload === 'object' ? (Array.isArray(result.payload) ? 'Array' : 'Object') : typeof result.payload}
                        </div>
                    ) : (
                        <div
                            className="detail-json"
                            dangerouslySetInnerHTML={{ __html: syntaxHighlight(payloadJson) }}
                        />
                    )}
                    <button
                        className="btn btn-ghost detail-copy-btn"
                        onClick={() => copy(payloadJson, 'payload')}
                    >
                        {copied === 'payload' ? '✓ Copied!' : (isLargePayload ? '📋 Copy Full Payload' : '📋 Copy Payload')}
                    </button>
                </div>

                {/* Response Body (for errors) */}
                {result.responseBody !== undefined && (
                    <div className="detail-section">
                        <div className="detail-section-title">Response Body</div>
                        {isLargeResponse ? (
                            <div className="detail-json" style={{ color: 'var(--text-muted)' }}>
                                [Large Response Truncated]
                                <br />
                                <br />
                                <strong>Size:</strong> {(responseBodyJson.length / 1024).toFixed(1)} KB
                            </div>
                        ) : (
                            <pre className="detail-json" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {responseBodyJson}
                            </pre>
                        )}
                    </div>
                )}

                {/* Copy as cURL */}
                <div className="detail-section">
                    <button
                        className="btn btn-ghost"
                        style={{ width: '100%' }}
                        onClick={() => copy(generateCurl(result, baseUrl), 'curl')}
                    >
                        {copied === 'curl' ? '✓ Copied!' : '🔗 Copy as cURL'}
                    </button>
                </div>
            </div>
        </>
    );
}
