import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../store/appStore.js';



interface AuditLog {
    id: string;
    user_id: string | null;
    actor_username: string | null;
    actor_role: string | null;
    action: string;
    action_label: string | null;
    source: 'web' | 'api_key' | 'mcp';
    details?: string | null;
    ip_address: string | null;
    timestamp: string;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    pages: number;
}

const SOURCE_ICONS: Record<string, string> = {
    web: '🌐',
    api_key: '🔑',
    mcp: '🤖',
};

const SOURCE_LABELS: Record<string, string> = {
    web: 'Web UI',
    api_key: 'API Key',
    mcp: 'MCP',
};

function formatTimestamp(ts: string): string {
    try {
        const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
        return new Date(normalized).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    } catch {
        return ts;
    }
}

function exportToCsv(logs: AuditLog[], projectId: string) {
    const headers = ['Timestamp (UTC)', 'Actor', 'Role', 'Action', 'Source', 'Details', 'IP Address'];
    const rows = logs.map(l => [
        l.timestamp,
        l.actor_username ?? '[deleted]',
        l.actor_role ?? '—',
        l.action_label ?? l.action,
        SOURCE_LABELS[l.source] ?? l.source,
        l.details ?? '—',
        l.ip_address ?? '—',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `audit-trail-${projectId}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function RenderDetailsDiff({ details }: { details: string }) {
    try {
        const parsed = JSON.parse(details);
        if (parsed && typeof parsed === 'object') {
            // Check if before/after diff structure
            if ('before' in parsed && 'after' in parsed) {
                const before = parsed.before || {};
                const after = parsed.after || {};
                const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
                
                if (keys.length === 0) return <span className="audit-details-text">No fields were modified.</span>;

                return (
                    <div className="audit-details-diff">
                        <table className="audit-diff-table">
                            <thead>
                                <tr>
                                    <th>Field</th>
                                    <th>Old Value</th>
                                    <th>New Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {keys.map(key => (
                                    <tr key={key}>
                                        <td className="audit-diff-field">{key}</td>
                                        <td className="audit-diff-val audit-diff-val--old">{String(before[key] ?? '—')}</td>
                                        <td className="audit-diff-val audit-diff-val--new">{String(after[key] ?? '—')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            }
            
            // Render general key-value pairs (e.g. scan target, profile)
            const keys = Object.keys(parsed);
            return (
                <div className="audit-details-params">
                    {keys.map(key => (
                        <div key={key} className="audit-details-param-row">
                            <span className="audit-details-param-key">{key}:</span>
                            <span className="audit-details-param-val">{String(parsed[key])}</span>
                        </div>
                    ))}
                </div>
            );
        }
    } catch {
        // Fallback to plain text
    }
    return <span className="audit-details-text">{details}</span>;
}

export function AuditTrailTab() {
    const projectId = useAppStore(s => s.activeProject?.id ?? null);

    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 0 });
    const [isLoading, setIsLoading] = useState(false);
    const [forbidden, setForbidden] = useState(false);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [source, setSource] = useState('');
    const [page, setPage] = useState(1);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchLogs = useCallback(async (searchVal: string, sourceVal: string, pageVal: number, signal?: AbortSignal) => {
        if (!projectId) return;
        setIsLoading(true);
        setError('');
        setForbidden(false);

        const token = localStorage.getItem('swazz_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const params = new URLSearchParams({ page: String(pageVal), limit: '20' });
        if (searchVal) params.set('search', searchVal);
        if (sourceVal) params.set('source', sourceVal);

        try {
            const res = await fetch(`/api/projects/${projectId}/audit-logs?${params}`, { headers, signal });
            if (res.status === 403) {
                setForbidden(true);
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setLogs(data.logs || []);
            setPagination(data.pagination || { page: 1, limit: 20, total: 0, pages: 0 });
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            setError(err.message || 'Failed to load audit logs');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    // Initial load and when page/source changes
    useEffect(() => {
        const controller = new AbortController();
        fetchLogs(search, source, page, controller.signal);
        return () => {
            controller.abort();
        };
    }, [source, page, projectId]);

    // Debounce search input
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setSearch(val);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            setPage(1);
            fetchLogs(val, source, 1);
        }, 300);
    };

    const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSource(e.target.value);
        setPage(1);
    };

    const handleExport = async () => {
        if (!projectId) return;
        const token = localStorage.getItem('swazz_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const params = new URLSearchParams({ limit: '1000' });
        if (search) params.set('search', search);
        if (source) params.set('source', source);

        try {
            const res = await fetch(`/api/projects/${projectId}/audit-logs?${params}`, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            exportToCsv(data.logs || [], projectId);
        } catch (err: any) {
            setError(err.message || 'Export failed');
        }
    };

    const toggleRow = (id: string) => {
        setExpandedRow(prev => (prev === id ? null : id));
    };

    if (forbidden) {
        return (
            <div className="audit-trail-empty-state">
                <svg className="audit-trail-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="audit-trail-empty-title">Access Restricted</p>
                <p className="audit-trail-empty-desc">You don&apos;t have permission to view the audit trail. Only owners and editors can access this section.</p>
            </div>
        );
    }

    return (
        <div className="audit-trail-container">
            <div className="settings-section-header">
                <h2 className="settings-section-title">Audit Trail</h2>
                <p className="settings-section-desc">
                    Immutable log of all state-changing actions in this project. Records include the actor, their role at the time, the source (web UI, API, or MCP), and IP address.
                </p>
            </div>

            {/* Toolbar */}
            <div className="audit-trail-toolbar">
                <input
                    id="audit-trail-search"
                    className="audit-trail-search"
                    type="search"
                    placeholder="Search by user, action, or IP…"
                    value={search}
                    onChange={handleSearchChange}
                    aria-label="Search audit logs"
                />
                <select
                    id="audit-trail-source-filter"
                    className="audit-trail-source-select"
                    value={source}
                    onChange={handleSourceChange}
                    aria-label="Filter by source"
                >
                    <option value="">All sources</option>
                    <option value="web">🌐 Web UI</option>
                    <option value="api_key">🔑 API Key</option>
                    <option value="mcp">🤖 MCP</option>
                </select>
                <button
                    id="audit-trail-export-btn"
                    className="btn btn-secondary audit-trail-export-btn"
                    onClick={handleExport}
                    disabled={isLoading || logs.length === 0}
                    title="Export filtered results as CSV"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export CSV
                </button>
            </div>

            {error && <p className="audit-trail-error">{error}</p>}

            {/* Table */}
            {isLoading && logs.length === 0 ? (
                <div className="audit-trail-loading">
                    <div className="spinner" />
                    <span>Loading audit logs…</span>
                </div>
            ) : logs.length === 0 ? (
                <div className="audit-trail-empty-state">
                    <svg className="audit-trail-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                    </svg>
                    <p className="audit-trail-empty-title">No audit events yet</p>
                    <p className="audit-trail-empty-desc">
                        {search || source ? 'No results match your filters.' : 'Audit entries will appear here after project members perform actions.'}
                    </p>
                </div>
            ) : (
                <>
                    <div className="audit-trail-table-wrapper">
                        <table className="audit-trail-table" aria-label="Audit trail events">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px' }} />
                                    <th>Timestamp</th>
                                    <th>Actor</th>
                                    <th>Role</th>
                                    <th>Action</th>
                                    <th>Source</th>
                                    <th>IP Address</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => {
                                    const isExpanded = expandedRow === log.id;
                                    const hasDetails = !!log.details;
                                    
                                    return (
                                        <React.Fragment key={log.id}>
                                            <tr 
                                                className={`audit-row-main ${hasDetails ? 'audit-row-interactive' : ''}`}
                                                onClick={() => hasDetails && toggleRow(log.id)}
                                            >
                                                <td className="audit-row-chevron-cell">
                                                    {hasDetails && (
                                                        <svg 
                                                            className={`audit-chevron-icon ${isExpanded ? 'rotated' : ''}`} 
                                                            width="12" 
                                                            height="12" 
                                                            viewBox="0 0 24 24" 
                                                            fill="none" 
                                                            stroke="currentColor" 
                                                            strokeWidth="3"
                                                        >
                                                            <polyline points="9 18 15 12 9 6" />
                                                        </svg>
                                                    )}
                                                </td>
                                                <td className="audit-trail-timestamp">{formatTimestamp(log.timestamp)}</td>
                                                <td>
                                                    {log.actor_username ? (
                                                        <span className="audit-trail-actor">{log.actor_username}</span>
                                                    ) : (
                                                        <span className="audit-trail-actor-deleted">[deleted user]</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {log.actor_role ? (
                                                        <span className="audit-trail-role-badge">{log.actor_role}</span>
                                                    ) : '—'}
                                                </td>
                                                <td className="audit-trail-action-label" title={log.action}>
                                                    {log.action_label ?? log.action}
                                                </td>
                                                <td>
                                                    <span className={`audit-trail-source-badge audit-trail-source-badge--${log.source}`}>
                                                        {SOURCE_ICONS[log.source] ?? '?'} {SOURCE_LABELS[log.source] ?? log.source}
                                                    </span>
                                                </td>
                                                <td className="audit-trail-ip">{log.ip_address ?? '—'}</td>
                                            </tr>
                                            {isExpanded && log.details && (
                                                <tr className="audit-row-details">
                                                    <td />
                                                    <td colSpan={6} className="audit-details-cell">
                                                        <RenderDetailsDiff details={log.details} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {pagination.pages > 1 && (
                        <div className="audit-trail-pagination">
                            <span className="audit-trail-count">
                                Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, pagination.total)} of {pagination.total}
                            </span>
                            <div className="audit-trail-page-controls">
                                <button
                                    className="btn btn-icon"
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    aria-label="Previous page"
                                >‹</button>
                                {Array.from({ length: Math.min(pagination.pages, 7) }, (_, i) => {
                                    const p = i + 1;
                                    return (
                                        <button
                                            key={p}
                                            className={`btn btn-page ${page === p ? 'active' : ''}`}
                                            onClick={() => setPage(p)}
                                        >
                                            {p}
                                        </button>
                                    );
                                })}
                                <button
                                    className="btn btn-icon"
                                    onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                                    disabled={page >= pagination.pages}
                                    aria-label="Next page"
                                >›</button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
