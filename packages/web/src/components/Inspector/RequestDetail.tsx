import React, { useState } from 'react';
import type { FuzzResult } from '@swazz/core';

interface Props {
    result: FuzzResult;
    onClose: () => void;
}

function syntaxHighlight(json: string): string {
    return json
        .replace(/("(?:\\.|[^"\\])*")\s*:/g, '<span style="color: var(--color-info)">$1</span>:')
        .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span style="color: var(--color-success)">$1</span>')
        .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color: var(--color-warning)">$1</span>')
        .replace(/:\s*(null|undefined|NaN)/g, ': <span style="color: var(--color-error)">$1</span>')
        .replace(/:\s*(true|false)/g, ': <span style="color: var(--color-action)">$1</span>');
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
                        <div className="detail-json">
                            {typeof result.responseBody === 'string'
                                ? result.responseBody
                                : JSON.stringify(result.responseBody, null, 2)}
                        </div>
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
