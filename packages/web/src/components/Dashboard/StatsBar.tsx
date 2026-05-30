import type { RunStats } from '../../types.js';

interface Props {
    stats: RunStats;
    isRunning: boolean;
    onExportHTML: () => void;
}

function StatNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
    return (
        <span className="stat-value">
            {decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString()}
        </span>
    );
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function get2xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 200 && Number(s) < 300)
        .reduce((sum, [, c]) => sum + c, 0);
}

function get4xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 400 && Number(s) < 500)
        .reduce((sum, [, c]) => sum + c, 0);
}

function get5xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 500)
        .reduce((sum, [, c]) => sum + c, 0);
}

export function StatsBar({ stats, isRunning, onExportHTML }: Props) {
    const count2xx = get2xx(stats);
    const count4xx = get4xx(stats);
    const count5xx = get5xx(stats);

    const { completedEndpoints, totalEndpoints, currentEndpoint, currentProfile } = stats.progress;
    const pct = totalEndpoints > 0 ? Math.round((completedEndpoints / totalEndpoints) * 100) : 0;
    const showProgress = isRunning && totalEndpoints > 0;

    return (
        <div className="stats-bar card">
            <div className="stats-bar-row">
                {/* RPS */}
                <div className="stat-card stat-rps">
                    <span className="stat-label">Req / sec</span>
                    <StatNumber value={stats.requestsPerSecond} decimals={1} />
                </div>
                <div className="stat-divider" />

                {/* Total */}
                <div className="stat-card stat-total">
                    <span className="stat-label">Total</span>
                    <StatNumber value={stats.totalRequests} />
                </div>
                <div className="stat-divider" />

                {/* 2xx */}
                <div className="stat-card stat-2xx">
                    <span className="stat-label">2xx Success</span>
                    <StatNumber value={count2xx} />
                </div>
                <div className="stat-divider" />

                {/* 4xx */}
                <div className="stat-card stat-4xx">
                    <span className="stat-label">4xx Client</span>
                    <StatNumber value={count4xx} />
                </div>
                <div className="stat-divider" />

                {/* 5xx */}
                <div className={`stat-card stat-5xx ${count5xx > 0 ? 'has-errors' : ''}`}>
                    <span className="stat-label">{count5xx > 0 ? '5xx CRASHES' : '5xx Errors'}</span>
                    <StatNumber value={count5xx} />
                </div>
                <div className="stat-divider" />

                {/* Data Received */}
                <div className="stat-card stat-data-received">
                    <span className="stat-label">Data Received</span>
                    <span className="stat-value">{formatBytes(stats.totalResponseBytes || 0)}</span>
                </div>
                <div className="stat-divider" />

                {/* Max Response Size */}
                <div className="stat-card stat-max-response">
                    <span className="stat-label">Max Response</span>
                    <span className="stat-value">{formatBytes(stats.maxResponseSize || 0)}</span>
                </div>

                <div className="stat-divider" />

                {/* Export Button */}
                <div className="stat-card stat-export" style={{ justifyContent: 'center' }}>
                    <button
                        className="btn btn-ghost btn-sm"
                        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-light)' }}
                        onClick={onExportHTML}
                        title="Generate and download a visual HTML report"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        HTML Report
                    </button>
                </div>
            </div>

            {showProgress && (
                <div className="progress-strip">
                    <div className="progress-bar-track">
                        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="progress-meta">
                        <span className="progress-pct">{pct}%</span>
                        <span className="progress-label">
                            {completedEndpoints}/{totalEndpoints} endpoints
                            {currentEndpoint ? (
                                <> · <span className="progress-current">
                                    {currentProfile && <span className="progress-profile">{currentProfile}</span>}
                                    {currentEndpoint}
                                </span></>
                            ) : null}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
