import React, { useState, useEffect } from 'react';
import type { ParsingErrorDetails } from '../../services/swaggerService.js';

interface ParsingErrorModalProps {
    error: ParsingErrorDetails;
    onClose: () => void;
}

export function ParsingErrorModal({ error, onClose }: ParsingErrorModalProps) {
    const [activeTab, setActiveTab] = useState<'error' | 'request' | 'response'>('error');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = originalOverflow;
        };
    }, [onClose]);

    const formatHeaders = (headers?: Record<string, string>) => {
        if (!headers || Object.keys(headers).length === 0) return 'None';
        return Object.entries(headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');
    };

    const renderHeadersTable = (headers?: Record<string, string>) => {
        if (!headers || Object.keys(headers).length === 0) {
            return <div className="parsing-error-no-headers">None</div>;
        }
        return (
            <div className="parsing-error-headers-table-container">
                <table className="parsing-error-headers-table">
                    <thead>
                        <tr>
                            <th>Header</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.entries(headers).map(([k, v]) => (
                            <tr key={k}>
                                <td className="parsing-error-header-name">{k}</td>
                                <td className="parsing-error-header-value">{v}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const copyToClipboard = () => {
        let text = '';
        if (activeTab === 'error') {
            text = `Error Message: ${error.error.message}\nParser Details: ${JSON.stringify(error.error.parserDetails || {}, null, 2)}\n\nStack Trace:\n${error.error.stack || 'No JS Stack Trace Available'}`;
        } else if (activeTab === 'request') {
            text = `${error.request.method} ${error.request.url}\n\nHeaders:\n${formatHeaders(error.request.headers)}\n\nBody:\n${error.request.body || 'Empty'}`;
        } else if (activeTab === 'response') {
            text = error.response
                ? `HTTP ${error.response.status} ${error.response.statusText}\n\nHeaders:\n${formatHeaders(error.response.headers)}\n\nBody:\n${error.response.body || 'Empty'}`
                : 'No Response Data';
        }
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const copyAllJson = () => {
        navigator.clipboard.writeText(JSON.stringify(error, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="parsing-error-backdrop" onClick={onClose}>
            <div className="parsing-error-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="parsing-error-header">
                    <h3>Specification Parsing Failure</h3>
                    <button className="parsing-error-close" onClick={onClose} aria-label="Close modal">
                        &times;
                    </button>
                </div>

                <div className="parsing-error-tabs">
                    <button
                        className={`parsing-error-tab ${activeTab === 'error' ? 'active' : ''}`}
                        onClick={() => setActiveTab('error')}
                    >
                        Error Details
                    </button>
                    <button
                        className={`parsing-error-tab ${activeTab === 'request' ? 'active' : ''}`}
                        onClick={() => setActiveTab('request')}
                    >
                        Request Details
                    </button>
                    <button
                        className={`parsing-error-tab ${activeTab === 'response' ? 'active' : ''}`}
                        onClick={() => setActiveTab('response')}
                        disabled={!error.response}
                    >
                        Response Details
                    </button>
                </div>

                <div className="parsing-error-body">
                    {activeTab === 'error' && (
                        <div className="parsing-error-content">
                            <div className="parsing-error-field">
                                <label className="parsing-error-label">Message</label>
                                <div className="parsing-error-msg">{error.error.message}</div>
                            </div>
                            {error.error.parserDetails && (
                                <div className="parsing-error-field">
                                    <label className="parsing-error-label">Parser Info</label>
                                    <pre className="parsing-error-pre">
                                        <code>{JSON.stringify(error.error.parserDetails, null, 2)}</code>
                                    </pre>
                                </div>
                            )}
                            <div className="parsing-error-field">
                                <label className="parsing-error-label">Stack Trace / Details</label>
                                <pre className="parsing-error-pre">
                                    <code>{error.error.stack || 'No Javascript stack trace available.'}</code>
                                </pre>
                            </div>
                        </div>
                    )}

                    {activeTab === 'request' && (
                        <div className="parsing-error-content">
                            <div className="parsing-error-field">
                                <label className="parsing-error-label">Endpoint</label>
                                <div className="parsing-error-request-line">
                                    <span className="parsing-error-method">{error.request.method}</span>
                                    <span className="parsing-error-url">{error.request.url}</span>
                                </div>
                            </div>
                            <div className="parsing-error-field">
                                <label className="parsing-error-label">Request Headers</label>
                                {renderHeadersTable(error.request.headers)}
                            </div>
                            {error.request.body && (
                                <div className="parsing-error-field">
                                    <label className="parsing-error-label">Request Body</label>
                                    {isJson(error.request.body) ? (
                                        <pre className="parsing-error-pre">
                                            <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(error.request.body || '') }} />
                                        </pre>
                                    ) : (
                                        <pre className="parsing-error-pre">
                                            <code>{error.request.body}</code>
                                        </pre>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'response' && error.response && (
                        <div className="parsing-error-content">
                            <div className="parsing-error-field">
                                <label className="parsing-error-label">Status</label>
                                <div className="parsing-error-status-line">
                                    <span className="parsing-error-status">{error.response.status}</span>
                                    <span className="parsing-error-statustext">{error.response.statusText}</span>
                                </div>
                            </div>
                            <div className="parsing-error-field">
                                <label className="parsing-error-label">Response Headers</label>
                                {renderHeadersTable(error.response.headers)}
                            </div>
                            <div className="parsing-error-field">
                                <label className="parsing-error-label">Response Body Snippet</label>
                                {isJson(error.response.body) ? (
                                    <pre className="parsing-error-pre">
                                        <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(error.response.body || '') }} />
                                    </pre>
                                ) : (
                                    <pre className="parsing-error-pre">
                                        <code>{error.response.body || 'Empty body'}</code>
                                    </pre>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="parsing-error-footer">
                    <button className="btn btn-secondary" onClick={copyToClipboard}>
                        {copied ? 'Copied Active Tab!' : 'Copy Active Tab'}
                    </button>
                    <button className="btn btn-secondary" onClick={copyAllJson}>
                        Copy Full Error JSON
                    </button>
                    <button className="btn btn-primary" onClick={onClose}>
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isJson(str?: string): boolean {
    if (!str) return false;
    try {
        const parsed = JSON.parse(str);
        return parsed && typeof parsed === 'object';
    } catch {
        return false;
    }
}

function syntaxHighlightJson(jsonStr: string): string {
    try {
        const obj = JSON.parse(jsonStr);
        jsonStr = JSON.stringify(obj, null, 2);
    } catch {}

    const escaped = escapeHtml(jsonStr);
    return escaped.replace(
        /(&quot;(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&quot;])*&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        (match) => {
            let cls = 'json-number';
            if (/^&quot;/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return `<span class="${cls}">${match}</span>`;
        }
    );
}
