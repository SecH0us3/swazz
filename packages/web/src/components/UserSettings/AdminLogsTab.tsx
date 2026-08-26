// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect, useCallback } from 'react';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function AdminLogsTab() {
    const [adminSecret, setAdminSecret] = useState(() => localStorage.getItem('admin_secret') || '');
    const [inputSecret, setInputSecret] = useState(() => localStorage.getItem('admin_secret') || '');
    const [logs, setLogs] = useState<any[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error' | 'debug'>('all');
    const [moduleFilter, setModuleFilter] = useState('');
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    const fetchLogs = useCallback(async (secretToUse?: string) => {
        const secret = secretToUse !== undefined ? secretToUse : adminSecret;
        if (!secret) {
            setLogs([]);
            return;
        }
        setLogsLoading(true);
        setLogsError('');
        try {
            const res = await fetch(`${PROXY_URL}/api/admin/logs`, {
                headers: {
                    'Authorization': `Bearer ${secret}`
                }
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP error ${res.status}`);
            }
            const data = await res.json();
            setLogs(data || []);
        } catch (err: any) {
            console.error('Failed to fetch admin logs', err);
            setLogsError(err.message || 'Failed to fetch logs');
        } finally {
            setLogsLoading(false);
        }
    }, [adminSecret]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const handleSaveSecret = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('admin_secret', inputSecret);
        setAdminSecret(inputSecret);
    };

    const handleClearSecret = () => {
        localStorage.removeItem('admin_secret');
        setInputSecret('');
        setAdminSecret('');
        setLogs([]);
        setLogsError('');
    };

    return (
        <div className="settings-card">
            <div className="logs-header-container">
                <h2 className="settings-card-title">
                    Admin Edge Worker Logs
                </h2>
                {adminSecret && (
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => fetchLogs()}
                        disabled={logsLoading}
                    >
                        {logsLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                )}
            </div>

            {!adminSecret ? (
                <form onSubmit={handleSaveSecret} className="logs-secret-section">
                    <p className="settings-danger-text">
                        Enter your Admin Secret key to authenticate and view real-time system logs.
                    </p>
                    <div className="logs-secret-row">
                        <input
                            type="password"
                            className="input logs-secret-input"
                            placeholder="Enter Admin Secret"
                            value={inputSecret}
                            onChange={(e) => setInputSecret(e.target.value)}
                            required
                            data-1p-ignore
                        />
                        <button type="submit" className="btn btn-primary btn-sm">
                            Save & Authenticate
                        </button>
                    </div>
                </form>
            ) : (
                <div className="logs-tab-container">
                    <div className="logs-secret-row">
                        <input
                            type="password"
                            className="input logs-secret-input"
                            value="••••••••••••••••"
                            disabled
                            data-1p-ignore
                        />
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={handleClearSecret}
                        >
                            Clear Secret
                        </button>
                    </div>

                    {logsError && (
                        <div className="two-factor-error-alert">
                            {logsError}
                        </div>
                    )}

                    <div className="logs-filter-row">
                        <input
                            type="text"
                            className="input logs-filter-input"
                            placeholder="Search messages..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <input
                            type="text"
                            className="input logs-filter-input"
                            placeholder="Filter by module..."
                            value={moduleFilter}
                            onChange={(e) => setModuleFilter(e.target.value)}
                        />
                        <select
                            className="input logs-filter-select"
                            value={levelFilter}
                            onChange={(e) => setLevelFilter(e.target.value as any)}
                        >
                            <option value="all">All Levels</option>
                            <option value="info">Info</option>
                            <option value="warn">Warn</option>
                            <option value="error">Error</option>
                            <option value="debug">Debug</option>
                        </select>
                    </div>

                    {logsLoading && logs.length === 0 ? (
                        <p className="logs-no-data">Loading logs...</p>
                    ) : (() => {
                        const filtered = (Array.isArray(logs) ? logs : []).filter(log => {
                            if (!log) return false;
                            if (levelFilter !== 'all' && log.level !== levelFilter) return false;
                            if (moduleFilter && !log.module?.toLowerCase().includes(moduleFilter.toLowerCase())) return false;
                            if (searchQuery && !log.msg?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                            return true;
                        });

                        if (filtered.length === 0) {
                            return <p className="logs-no-data">No logs found matching filters.</p>;
                        }

                        return (
                            <div className="logs-table-wrapper">
                                <table className="logs-table">
                                    <thead className="logs-table-header">
                                        <tr>
                                            <th className="logs-th">Timestamp</th>
                                            <th className="logs-th">Level</th>
                                            <th className="logs-th">Module</th>
                                            <th className="logs-th">Message</th>
                                            <th className="logs-th">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((log, idx) => {
                                            const logId = `${log.timestamp}-${idx}`;
                                            const isExpanded = expandedLogId === logId;
                                            const hasPayload = log.payload && Object.keys(log.payload).length > 0;
                                            const hasError = !!log.error;
                                            const canInspect = hasPayload || hasError;
                                            
                                            let levelClass = '';
                                            if (log.level === 'info') levelClass = 'log-row-info';
                                            else if (log.level === 'warn') levelClass = 'log-row-warn';
                                            else if (log.level === 'error') levelClass = 'log-row-error';

                                            return (
                                                <React.Fragment key={logId}>
                                                    <tr className="logs-tr">
                                                        <td className="logs-td">
                                                            {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                                                        </td>
                                                        <td className="logs-td">
                                                            <span className={`logs-level-badge ${levelClass}`}>
                                                                {log.level}
                                                            </span>
                                                        </td>
                                                        <td className="logs-td">{log.module}</td>
                                                        <td className="logs-td-msg">{log.msg}</td>
                                                        <td className="logs-td">
                                                            {canInspect ? (
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary logs-inspect-btn"
                                                                    onClick={() => setExpandedLogId(isExpanded ? null : logId)}
                                                                >
                                                                    {isExpanded ? 'Hide' : 'Inspect'}
                                                                </button>
                                                            ) : (
                                                                <span className="text-muted">-</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {isExpanded && canInspect && (
                                                        <tr className="logs-tr">
                                                            <td colSpan={5} className="logs-payload-row-td">
                                                                <div className="logs-payload-container">
                                                                    <pre className="log-payload-preview">
                                                                        {JSON.stringify(
                                                                            hasError ? { error: log.error, payload: log.payload } : log.payload,
                                                                            null,
                                                                            2
                                                                        )}
                                                                    </pre>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}
