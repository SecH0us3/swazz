import { ReactNode, useState, useEffect } from 'react';
import type { FuzzResult } from '../../types.js';

interface Props {
    result: FuzzResult;
    baseUrl: string;
    onClose: () => void;
    onReplay?: (req: any) => Promise<any>;
    globalHeaders: Record<string, string>;
    globalCookies: Record<string, string>;
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

export function RequestDetail({
    result,
    baseUrl,
    onClose,
    onReplay,
    globalHeaders,
    globalCookies
}: Props) {
    const [copied, setCopied] = useState<string | null>(null);

    const initialUrl = joinUrl(baseUrl, result.resolvedPath || result.endpoint);
    const initialBody = result.payload !== undefined
        ? (typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2))
        : '';

    const [editedUrl, setEditedUrl] = useState(initialUrl);
    const [editedBody, setEditedBody] = useState(initialBody);

    useEffect(() => {
        setEditedBody(result.payload !== undefined
            ? (typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2))
            : '');
    }, [result.payload]);

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
            let parsedBody = undefined;
            if (editedBody && editedBody.trim()) {
                parsedBody = JSON.parse(editedBody);
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

                <div className="modal-split">
                    <div className="modal-pane">
                        <div className="detail-section-title">Request URL</div>
                        <input
                            className="input"
                            style={{ fontFamily:'var(--font-mono)', fontSize:'var(--font-size-xs)', color:'var(--accent-light)' }}
                            value={editedUrl}
                            onChange={(e) => setEditedUrl(e.target.value)}
                        />

                        <div className="detail-section-title" style={{ marginTop:'var(--space-4)', display:'flex', justifyContent:'space-between' }}>
                            Payload
                            <button className="btn btn-ghost btn-sm" onClick={() => copy(editedBody, 'payload')}>
                                {copied === 'payload' ? '✓ Copied' : 'Copy'}
                            </button>
                        </div>
                        <textarea
                            className="textarea"
                            style={{ flex:1, margin:0, fontFamily:'var(--font-mono)', fontSize:'var(--font-size-xs)' }}
                            value={editedBody}
                            onChange={(e) => setEditedBody(e.target.value)}
                            spellCheck={false}
                        />
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
