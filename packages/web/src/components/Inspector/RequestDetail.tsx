import React, { useState } from 'react';
import type { FuzzResult } from '@swazz/core';

interface Props {
    result: FuzzResult;
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

function generateCurl(result: FuzzResult, baseUrl?: string): string {
    const url = baseUrl ? `${baseUrl}${result.endpoint}` : result.endpoint;
    let cmd = `curl -X ${result.method} '${url}'`;
    cmd += ` \\\n  -H 'Content-Type: application/json'`;
    cmd += ` \\\n  -d '${JSON.stringify(result.payload)}'`;
    return cmd;
}

export function RequestDetail({ result, onClose }: Props) {
    const [copied, setCopied] = useState<string | null>(null);

    const copy = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(label);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    const payloadJson = JSON.stringify(result.payload, null, 2);
    const statusColor =
        result.status >= 500 ? 'var(--color-error)' :
            result.status >= 400 ? 'var(--color-warning)' :
                'var(--color-success)';

    return (
        <>
            <div className="detail-overlay" onClick={onClose} />
            <div className="detail-panel">
                {/* Header */}
                <div className="detail-header">
                    <div>
                        <div className="detail-status" style={{ color: statusColor }}>
                            {result.status || 'Network Error'}
                        </div>
                        <div className="detail-meta">
                            <span>{result.method} {result.endpoint}</span>
                            <span>{result.profile} • {result.duration}ms</span>
                        </div>
                    </div>
                    <button className="btn btn-ghost" onClick={onClose}>✕</button>
                </div>

                {/* Error message */}
                {result.error && (
                    <div style={{
                        padding: 'var(--space-3)',
                        background: 'var(--color-error-dim)',
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
                    <div
                        className="detail-json"
                        dangerouslySetInnerHTML={{ __html: syntaxHighlight(payloadJson) }}
                    />
                    <button
                        className="btn btn-ghost detail-copy-btn"
                        onClick={() => copy(payloadJson, 'payload')}
                    >
                        {copied === 'payload' ? '✓ Copied!' : '📋 Copy Payload'}
                    </button>
                </div>

                {/* Response Body (for 5xx) */}
                {result.responseBody && (
                    <div className="detail-section">
                        <div className="detail-section-title">Response Body</div>
                        {/* Render as plain text — never dangerouslySetInnerHTML on server responses */}
                        <pre className="detail-json" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {typeof result.responseBody === 'string'
                                ? result.responseBody
                                : JSON.stringify(result.responseBody, null, 2)}
                        </pre>
                    </div>
                )}

                {/* Copy as cURL */}
                <div className="detail-section">
                    <button
                        className="btn btn-ghost"
                        style={{ width: '100%' }}
                        onClick={() => copy(generateCurl(result), 'curl')}
                    >
                        {copied === 'curl' ? '✓ Copied!' : '🔗 Copy as cURL'}
                    </button>
                </div>
            </div>
        </>
    );
}
