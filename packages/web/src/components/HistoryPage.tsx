import React, { useRef } from 'react';
import { useAppStore } from '../store/appStore.js';
import type { ScanRun } from '../hooks/useDb.js';

interface HistoryPageProps {
    runs: ScanRun[];
    onLoadRun: (runId: string, importedRun?: any) => void;
    onDeleteRun: (runId: string) => void;
    onImportRun: (data: any) => Promise<{ runId: string; run: any } | undefined>;
    onExport: (runId: string | null, baseUrl?: string) => void;
    onExportHTML: (runId: string | null) => void;
    onExportMD: (runId: string | null) => void;
}

export function HistoryPage({
    runs,
    onLoadRun,
    onDeleteRun,
    onImportRun,
    onExport,
    onExportHTML,
    onExportMD,
}: HistoryPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const loadedRunId = useAppStore(state => state.loadedRunId);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const json = JSON.parse(evt.target?.result as string);
                const result = await onImportRun(json);
                if (result) {
                    const { runId, run } = result;
                    onLoadRun(runId, run);
                }
            } catch (err: any) {
                alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const formatDuration = (start: number, end: number) => {
        if (!start || !end) return '-';
        const diffMs = end - start;
        if (diffMs < 0) return '0s';
        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs < 60) return `${diffSecs}s`;
        const mins = Math.floor(diffSecs / 60);
        const secs = diffSecs % 60;
        return `${mins}m ${secs}s`;
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            padding: '24px',
            height: '100%',
            overflowY: 'auto',
            minWidth: 0
        }}>
            {/* Header */}
            <div style={{
                borderBottom: '1px solid var(--border-default)',
                paddingBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: 'var(--text-default)' }}>Scan History</h1>
                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>
                        Manage past fuzzing sessions, analyze anomaly reports, and export scan artifacts.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        style={{ display: 'none' }} 
                        accept=".json" 
                        onChange={handleFileChange} 
                    />
                    <button 
                        className="btn btn-secondary" 
                        onClick={() => fileInputRef.current?.click()}
                        style={{ gap: '6px', display: 'flex', alignItems: 'center' }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        Import CLI Report
                    </button>
                    <button 
                        className="btn btn-primary" 
                        onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                        style={{ gap: '6px', display: 'flex', alignItems: 'center' }}
                    >
                        Dashboard
                    </button>
                </div>
            </div>

            {/* Content area */}
            {runs.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
                    <div className="empty-state" style={{ padding: '48px', maxWidth: '480px', textAlign: 'center' }}>
                        <div className="empty-state-icon" style={{ fontSize: '48px', marginBottom: '16px' }}>🕒</div>
                        <div className="empty-state-title" style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>No scan history yet</div>
                        <div className="empty-state-text" style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>
                            Perform a fuzz test or import a CLI report (JSON format) to view previous execution logs and reports.
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={() => fileInputRef.current?.click()}
                            style={{ margin: '0 auto' }}
                        >
                            Import JSON Report
                        </button>
                    </div>
                </div>
            ) : (
                <div style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                    backgroundColor: 'var(--bg-elevated)',
                    boxShadow: 'var(--shadow-sm)'
                }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-default)' }}>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Scan Date</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Target Base URL</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Duration</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Requests</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Crashes / Anomalies</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map((r, i) => {
                                const errors5xx = r.stats?.statusCounts
                                    ? Object.entries(r.stats.statusCounts)
                                        .filter(([s]) => s.startsWith('5'))
                                        .reduce((acc: number, [, c]) => acc + (c as number), 0)
                                    : 0;
                                const isLoaded = loadedRunId === r.id;

                                return (
                                    <tr 
                                        key={r.id} 
                                        style={{ 
                                            borderBottom: i === runs.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                                            backgroundColor: isLoaded ? 'rgba(124,58,237,0.03)' : 'transparent',
                                            transition: 'background-color 0.2s'
                                        }}
                                        className="history-row"
                                    >
                                        <td style={{ padding: '16px', fontWeight: 500 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                                                    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                                                </svg>
                                                <span>{new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.baseUrl || '(no url)'}
                                        </td>
                                        <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>
                                            {formatDuration(r.startedAt, r.completedAt)}
                                        </td>
                                        <td style={{ padding: '16px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                            {r.stats?.totalRequests?.toLocaleString() || 0}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            {errors5xx > 0 ? (
                                                <span className="badge badge-error" style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px' }}>
                                                    {errors5xx} crash{errors5xx > 1 ? 'es' : ''}
                                                </span>
                                            ) : (
                                                <span style={{
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    color: 'var(--color-success)',
                                                    backgroundColor: 'rgba(34,211,160,0.12)',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px'
                                                }}>
                                                    0 Crashes
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                                                <button
                                                    className={`btn ${isLoaded ? 'btn-success' : 'btn-secondary'} btn-sm`}
                                                    style={{ fontSize: '12px', padding: '4px 10px' }}
                                                    onClick={() => onLoadRun(r.id)}
                                                    disabled={isLoaded}
                                                >
                                                    {isLoaded ? '✓ Loaded' : 'Load Run'}
                                                </button>
                                                
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ fontSize: '12px', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                    onClick={() => onExportHTML(r.id)}
                                                    title="Export HTML Report"
                                                >
                                                    HTML
                                                </button>

                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ fontSize: '12px', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                    onClick={() => onExportMD(r.id)}
                                                    title="Export Markdown Report"
                                                >
                                                    MD
                                                </button>

                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ fontSize: '12px', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                    onClick={() => onExport(r.id, r.baseUrl)}
                                                    title="Export JSON Config + Results"
                                                >
                                                    JSON
                                                </button>

                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ fontSize: '12px', padding: '4px 6px', color: 'var(--color-error)', display: 'inline-flex', alignItems: 'center' }}
                                                    onClick={() => { if (confirm('Delete this scan history?')) onDeleteRun(r.id); }}
                                                    title="Delete Scan Run"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
