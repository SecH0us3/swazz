import React, { useState, useMemo } from 'react';
import type { FuzzResult } from '@swazz/core';

interface Props {
    results: FuzzResult[];
    onSelectResult: (result: FuzzResult) => void;
}

type StatusFilter = 'all' | '2xx' | '4xx' | '5xx';

function getStatusClass(status: number): string {
    if (status >= 500) return 'status-5xx';
    if (status >= 400) return 'status-4xx';
    return '';
}

function getBadgeClass(status: number): string {
    if (status >= 500) return 'badge badge-error';
    if (status >= 400) return 'badge badge-warning';
    if (status >= 200 && status < 300) return 'badge badge-success';
    return 'badge';
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function Inspector({ results, onSelectResult }: Props) {
    const [filter, setFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');

    const count5xx = useMemo(
        () => results.filter((r) => r.status >= 500).length,
        [results],
    );

    const filtered = useMemo(() => {
        let list = results;

        if (filter === '5xx') list = list.filter((r) => r.status >= 500);
        else if (filter === '4xx') list = list.filter((r) => r.status >= 400 && r.status < 500);
        else if (filter === '2xx') list = list.filter((r) => r.status >= 200 && r.status < 300);

        if (search) {
            const q = search.toLowerCase();
            list = list.filter((r) => r.endpoint.toLowerCase().includes(q) || r.profile.toLowerCase().includes(q));
        }

        return list.slice(-200).reverse(); // Show latest 200, newest first
    }, [results, filter, search]);

    const tabs: { key: StatusFilter; label: string; count?: number }[] = [
        { key: 'all', label: 'All' },
        { key: '5xx', label: '5xx', count: count5xx },
        { key: '4xx', label: '4xx' },
        { key: '2xx', label: '2xx' },
    ];

    return (
        <div className="inspector">
            <div className="inspector-header">
                <div className="inspector-tabs">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            className={`inspector-tab ${filter === tab.key ? 'active' : ''}`}
                            onClick={() => setFilter(tab.key)}
                        >
                            {tab.label}
                            {tab.count !== undefined && tab.count > 0 && (
                                <span className="badge badge-error" style={{ marginLeft: 4, fontSize: 10, padding: '0 5px' }}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <input
                    className="input inspector-search"
                    placeholder="Filter by path..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <div className="request-log">
                {filtered.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-text">
                            {results.length === 0 ? 'Waiting for requests...' : 'No matching requests'}
                        </div>
                    </div>
                ) : (
                    filtered.map((r) => (
                        <div
                            key={r.id}
                            className={`log-row ${getStatusClass(r.status)}`}
                            onClick={() => onSelectResult(r)}
                        >
                            <span className="log-timestamp">{formatTime(r.timestamp)}</span>
                            <span className="log-method">{r.method}</span>
                            <span className="log-path">{r.endpoint}</span>
                            <span className={getBadgeClass(r.status)}>{r.status || 'ERR'}</span>
                            <span className="badge-profile">{r.profile}</span>
                            <span className="log-duration">{r.duration}ms</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
