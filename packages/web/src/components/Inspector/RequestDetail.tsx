import React, { useState, useEffect } from 'react';
import type { FuzzResult } from '@swazz/core';

interface Props {
    result: FuzzResult;
    baseUrl: string;
    onClose: () => void;
    onReplay?: (req: any) => Promise<any>;
    onFetchFull?: () => Promise<FuzzResult | null>;
    onUpdateResult?: (result: FuzzResult) => void;
    globalHeaders: Record<string, string>;
    globalCookies: Record<string, string>;
}

function isTruncated(val: any): boolean {
    if (typeof val !== 'string') return false;
    return val.includes('... // +') && val.includes('KB total');
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

export function RequestDetail({
    result,
    baseUrl,
    onClose,
    onReplay,
    onFetchFull,
    onUpdateResult,
    globalHeaders,
    globalCookies
}: Props) {
    const [copied, setCopied] = useState<string | null>(null);
    const [isLoadingFull, setIsLoadingFull] = useState(false);

    // Initial editable states
    const initialUrl = joinUrl(baseUrl, result.resolvedPath || result.endpoint);
    const initialBody = result.payload !== undefined ? JSON.stringify(result.payload, null, 2) : '';

    const [editedUrl, setEditedUrl] = useState(initialUrl);
    const [editedBody, setEditedBody] = useState(initialBody);

    // Sync editedBody if result changes (e.g. after Load Full)
    useEffect(() => {
        setEditedBody(result.payload !== undefined
            ? (typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2))
            : '');
    }, [result.payload]);

    const [liveStatus, setLiveStatus] = useState<number>(result.status);
    const [liveResponse, setLiveResponse] = useState<any>(result.responseBody);
    const [isReplaying, setIsReplaying] = useState(false);

    const handleFetchFull = async () => {
        if (!onFetchFull || !onUpdateResult) return;
        setIsLoadingFull(true);
        try {
            const full = await onFetchFull();
            if (full) {
                onUpdateResult(full);
                setLiveResponse(full.responseBody);
            }
        } finally {
            setIsLoadingFull(false);
        }
    };

    const copy = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(label);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleReplay = async () => {
        if (!onReplay) return;

        setIsReplaying(true);
        try {
            let parsedBody = undefined;
            let bodyToUse = editedBody;

            // If body is truncated, we MUST load full first
            if (isTruncated(editedBody) && onFetchFull) {
                const full = await onFetchFull();
                if (full) {
                    bodyToUse = typeof full.payload === 'string' ? full.payload : JSON.stringify(full.payload, null, 2);
                }
            }

            if (bodyToUse && bodyToUse.trim()) {
                parsedBody = JSON.parse(bodyToUse);
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
        responseBodyJson = typeof liveResponse === 'string'
            ? liveResponse
            : JSON.stringify(liveResponse, null, 2);
    }

    // Safety truncate for rendering
    const isLargeResponse = responseBodyJson.length > 50000;

    const statusColor =
        liveStatus >= 500 ? 'var(--color-error)' :
            liveStatus >= 400 ? 'var(--color-warning)' :
                liveStatus > 0 ? 'var(--color-success)' :
                    'var(--color-error)';

    return (
        <div className="modal-backdrop">
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal-content">

                {/* Header */}
                <div className="modal-header">
                    <div>
                        <div className="detail-status" style={{ color: statusColor, fontSize: 'var(--font-size-2xl)' }}>
                            {liveStatus || 'Error'}
                        </div>
                        <div className="detail-meta" style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>{result.method}</span>
                            <span style={{ color: 'var(--text-muted)' }}> • {result.profile}</span>
                            {/* We'll pass isLoading from App.tsx as a prop or just handle it here if we refactor more, for now just show if bodies are missing and it's from history */}
                            {(result.payload === undefined && result.responseBody === undefined) && (
                                <span style={{ color: 'var(--color-info)', fontSize: 10 }}>Loading details...</span>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <button
                            className="btn btn-primary"
                            onClick={handleReplay}
                            disabled={isReplaying}
                        >
                            {isReplaying ? '↺ Replaying...' : '↺ Replay Request'}
                        </button>
                        <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 20 }}>✕</button>
                    </div>
                </div>

                <div className="modal-split">
                    {/* Left Panel: Request */}
                    <div className="modal-pane">
                        <div className="detail-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Request URL</span>
                            {isTruncated(result.resolvedPath) && (
                                <button className="btn btn-ghost" onClick={handleFetchFull} style={{ fontSize: 10, color: 'var(--color-primary)' }}>
                                    Load Full URL
                                </button>
                            )}
                        </div>
                        <input
                            type="text"
                            value={editedUrl}
                            onChange={(e) => setEditedUrl(e.target.value)}
                            style={{
                                width: '100%',
                                padding: 'var(--space-3)',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid var(--border-default)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--color-action-hover)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 'var(--font-size-sm)',
                                marginBottom: 'var(--space-4)'
                            }}
                        />

                        <div className="detail-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Request Payload (JSON)</span>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {isTruncated(editedBody) && (
                                    <button
                                        className="btn btn-ghost"
                                        onClick={handleFetchFull}
                                        disabled={isLoadingFull}
                                        style={{ color: 'var(--color-primary)', height: 24, fontSize: 10 }}
                                    >
                                        {isLoadingFull ? 'Loading...' : '📂 Load Full Payload'}
                                    </button>
                                )}
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => copy(editedBody, 'payload')}
                                    style={{ padding: '0 8px', height: 24, fontSize: 10 }}
                                >
                                    {copied === 'payload' ? '✓ Copied!' : '📋 Copy'}
                                </button>
                            </div>
                        </div>
                        <textarea
                            value={editedBody}
                            onChange={(e) => setEditedBody(e.target.value)}
                            spellCheck={false}
                            style={{
                                width: '100%',
                                flex: 1,
                                padding: 'var(--space-4)',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid var(--border-default)',
                                borderRadius: 'var(--radius-md)',
                                color: isTruncated(editedBody) ? 'var(--text-muted)' : 'var(--text-primary)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 'var(--font-size-sm)',
                                resize: 'none',
                                fontStyle: isTruncated(editedBody) ? 'italic' : 'normal'
                            }}
                        />
                    </div>

                    {/* Right Panel: Response */}
                    <div className="modal-pane">
                        <div className="detail-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Response Body</span>
                            {isTruncated(responseBodyJson) && (
                                <button
                                    className="btn btn-ghost"
                                    onClick={handleFetchFull}
                                    disabled={isLoadingFull}
                                    style={{ color: 'var(--color-primary)', height: 24, fontSize: 10 }}
                                >
                                    {isLoadingFull ? 'Loading...' : '📂 Load Full Response'}
                                </button>
                            )}
                        </div>
                        {isLargeResponse && !isTruncated(responseBodyJson) ? (
                            <div className="detail-json" style={{ color: 'var(--text-muted)', flex: 1 }}>
                                [Large Response Truncated for display]
                                <br /><br />
                                <strong>Size:</strong> {(responseBodyJson.length / 1024).toFixed(1)} KB
                            </div>
                        ) : (
                            <pre
                                className="detail-json"
                                style={{
                                    flex: 1,
                                    margin: 0,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all',
                                    border: '1px solid var(--border-default)',
                                    color: isTruncated(responseBodyJson) ? 'var(--text-muted)' : 'inherit',
                                    fontStyle: isTruncated(responseBodyJson) ? 'italic' : 'normal'
                                }}
                            >
                                {responseBodyJson || 'No response body.'}
                            </pre>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
