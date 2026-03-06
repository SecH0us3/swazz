import React, { useState, useMemo } from 'react';
import type { FuzzResult } from '@swazz/core';
import type { HeatmapFilter } from '../Dashboard/Heatmap.js';

interface Props {
    results: FuzzResult[];
    onSelectResult: (result: FuzzResult) => void;
    heatmapFilter: HeatmapFilter | null;
    onClearHeatmapFilter: () => void;
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

export function Inspector({ results, onSelectResult, heatmapFilter, onClearHeatmapFilter }: Props) {
    const [filter, setFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');

    const count5xx = useMemo(
        () => results.filter((r) => r.status >= 500).length,
        [results],
    );

    const filtered = useMemo(() => {
        let list = results;

        // Heatmap cell filter takes priority (exact endpoint + exact status code)
        if (heatmapFilter) {
            list = list.filter(
                (r) => r.endpoint === heatmapFilter.endpoint && r.status === heatmapFilter.status,
            );
        } else {
            // Tab filter
            if (filter === '5xx') list = list.filter((r) => r.status >= 500);
            else if (filter === '4xx') list = list.filter((r) => r.status >= 400 && r.status < 500);
            else if (filter === '2xx') list = list.filter((r) => r.status >= 200 && r.status < 300);
        }

        // Text search always applies on top
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(
                (r) => r.endpoint.toLowerCase().includes(q) || r.profile.toLowerCase().includes(q),
            );
        }

        return list.slice(-500).reverse(); // newest first
    }, [results, filter, search, heatmapFilter]);

    const tabs: { key: StatusFilter; label: string; count?: number }[] = [
        { key: 'all', label: 'All' },
        { key: '5xx', label: '5xx', count: count5xx },
        { key: '4xx', label: '4xx' },
        { key: '2xx', label: '2xx' },
    ];

    return (
        <div className="inspector">
            <div className="inspector-header">
                {heatmapFilter ? (
                    // When a heatmap cell is active, show a clear filter indicator instead of tabs
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                            Filtered:
                        </span>
                        <span
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            {heatmapFilter.endpoint}
                        </span>
                        <span
                            style={{
                                background:
                                    heatmapFilter.status >= 500
                                        ? 'var(--color-error-dim)'
                                        : heatmapFilter.status >= 400
                                            ? 'var(--color-warning-dim)'
                                            : 'var(--color-success-dim)',
                                color:
                                    heatmapFilter.status >= 500
                                        ? 'var(--color-error)'
                                        : heatmapFilter.status >= 400
                                            ? 'var(--color-warning)'
                                            : 'var(--color-success)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 10,
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-full)',
                                fontWeight: 600,
                            }}
                        >
                            {heatmapFilter.status}
                        </span>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-disabled)' }}>
                            {filtered.length} results
                        </span>
                        <button
                            onClick={onClearHeatmapFilter}
                            style={{
                                marginLeft: 4,
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-disabled)',
                                cursor: 'pointer',
                                fontSize: 12,
                                padding: '2px 4px',
                                borderRadius: 'var(--radius-sm)',
                                transition: 'color var(--duration-fast)',
                            }}
                            title="Clear filter"
                            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-error)')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-disabled)')}
                        >
                            ✕ clear
                        </button>
                    </div>
                ) : (
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
                )}

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
