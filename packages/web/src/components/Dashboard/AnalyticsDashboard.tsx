import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/appStore.js';

interface Props {
    projectId?: string;
}

interface ScanStats {
    total: number;
    completed: number;
    failed: number;
    avgDuration: number;
}

interface ScanHistoryItem {
    date: string;
    count: number;
    completed_count: number;
    failed_count: number;
}

interface FindingStatItem {
    severity: string;
    category: string;
    count: number;
}

interface FindingHistoryItem {
    date: string;
    severity: string;
    count: number;
}

interface Runner {
    name: string;
    isShared: boolean;
    isBusy: boolean;
}

interface RunnerMetrics {
    totalConnected: number;
    totalBusy: number;
    utilization: number;
    runners: Runner[];
}

interface AnalyticsData {
    scanStats: ScanStats;
    scanHistory: ScanHistoryItem[];
    findingsStats: FindingStatItem[];
    findingsHistory: FindingHistoryItem[];
    runnerMetrics: RunnerMetrics;
}

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

const PRETTY_CATEGORIES: Record<string, string> = {
    'swazz/sensitive-data-leak': 'Sensitive Data Leak',
    'swazz/sql-injection': 'SQL Injection',
    'swazz/xss': 'Cross-Site Scripting',
    'swazz/path-traversal': 'Path Traversal',
    'swazz/command-injection': 'Command Injection',
    'swazz/ssti': 'SSTI',
    'swazz/xxe': 'XXE Injection',
    'swazz/cors': 'CORS Policy',
    'swazz/crlf-injection': 'CRLF Injection',
    'swazz/timing-attack': 'Timing Attack',
    'swazz/sensitive-headers': 'Sensitive Headers',
    'swazz/sensitive-query-params': 'Sensitive Query Params',
    'swazz/bola': 'BOLA Vulnerability',
    'swazz/similarity': 'Response Similarity',
    'swazz/reflected-xss': 'Reflected XSS',
    'swazz/bola-idor': 'BOLA IDOR',
    'swazz/sql-error-leak': 'SQL Error Leak',
    'swazz/cmdi-leak': 'Command Injection Leak',
    'swazz/ssti-leak': 'SSTI Leak',
    'swazz/path-traversal-leak': 'Path Traversal Leak',
    'swazz/cors-misconfig': 'CORS Misconfiguration',
    'swazz/no-rate-limit': 'Missing Rate Limit',
    'swazz/unauthorized-access': 'Unauthorized Access',
    'swazz/csp-missing': 'Missing CSP Header',
    'swazz/csp-unsafe-directive': 'Unsafe CSP Directive',
    'swazz/custom-auth-leak': 'Custom Auth Leak',
    'swazz/header-injection': 'HTTP Header Injection',
    'swazz/null-pointer-exception': 'Null Pointer Exception',
    'swazz/oob-interaction': 'Out-of-Band Interaction',
    'swazz/rce-leak': 'Remote Code Execution Leak',
    'swazz/response-size-anomaly': 'Response Size Anomaly',
    'swazz/stack-trace-leak': 'Stack Trace Leak',
    'swazz/time-based-cmdi': 'Time-based Command Injection',
    'swazz/time-based-sqli': 'Time-based SQL Injection',
    'swazz/xxe-leak': 'XXE Leak',
    'swazz/tenant-isolation-bypass': 'Tenant Isolation Bypass'
};

const getPrettyCategory = (name: string) => {
    return PRETTY_CATEGORIES[name] || name.replace(/^swazz\//, '');
};

export function AnalyticsDashboard({ projectId }: Props) {
    const activeProject = useAppStore(state => state.activeProject);
    const targetProjectId = projectId || activeProject?.id;

    const [data, setData] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [hoveredScanIndex, setHoveredScanIndex] = useState<number | null>(null);

    useEffect(() => {
        if (!targetProjectId) {
            setIsLoading(false);
            return;
        }

        let isMounted = true;
        const fetchAnalytics = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
                const headers: Record<string, string> = {};
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                const res = await fetch(`${PROXY_URL}/api/projects/${targetProjectId}/analytics`, { headers });
                if (!res.ok) {
                    throw new Error(`Failed to load analytics: ${res.statusText}`);
                }
                const json = await res.json();
                if (isMounted) {
                    setData(json);
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Unknown error fetching analytics');
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchAnalytics();

        return () => {
            isMounted = false;
        };
    }, [targetProjectId]);

    // Format duration helper
    const formatDuration = (seconds: number) => {
        if (!seconds) return '0s';
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    // Derived statistics calculations
    const totalFindings = useMemo(() => {
        if (!data?.findingsStats) return 0;
        return data.findingsStats.reduce((sum, item) => sum + item.count, 0);
    }, [data]);

    const severityBreakdown = useMemo(() => {
        const counts = { error: 0, warning: 0, note: 0 };
        if (!data?.findingsStats) return counts;
        data.findingsStats.forEach(item => {
            const s = (item.severity || '').toLowerCase();
            if (s === 'error') counts.error += item.count;
            else if (s === 'warning') counts.warning += item.count;
            else if (s === 'note') counts.note += item.count;
        });
        return counts;
    }, [data]);

    const topCategories = useMemo(() => {
        if (!data?.findingsStats) return [];
        const cats: Record<string, { count: number; maxSeverity: string }> = {};
        data.findingsStats.forEach(item => {
            const cat = item.category;
            const current = cats[cat] || { count: 0, maxSeverity: 'note' };
            current.count += item.count;
            
            // promote severity if higher
            const levelOrder = { error: 3, warning: 2, note: 1 };
            const itemOrder = levelOrder[item.severity.toLowerCase() as keyof typeof levelOrder] || 0;
            const currentOrder = levelOrder[current.maxSeverity as keyof typeof levelOrder] || 0;
            if (itemOrder > currentOrder) {
                current.maxSeverity = item.severity.toLowerCase();
            }
            cats[cat] = current;
        });
        return Object.entries(cats)
            .map(([category, info]) => ({
                category,
                count: info.count,
                maxSeverity: info.maxSeverity
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [data]);

    // SVG Line chart paths and grid calculations
    const lineChartProps = useMemo(() => {
        if (!data?.scanHistory || data.scanHistory.length === 0) return null;
        const history = data.scanHistory;
        const width = 500;
        const height = 200;
        const paddingX = 40;
        const paddingY = 20;

        const maxCount = Math.max(...history.map(d => d.count), 5);
        const points = history.map((d, i) => {
            const x = history.length > 1 
                ? paddingX + i * (width - 2 * paddingX) / (history.length - 1)
                : width / 2;
            const y = height - paddingY - (d.count / maxCount) * (height - 2 * paddingY);
            return { x, y, raw: d };
        });

        // Compute curved path using Cubic Beziers
        let pathD = '';
        if (points.length > 0) {
            pathD = `M ${points[0].x} ${points[0].y}`;
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[i];
                const p1 = points[i + 1];
                const cp1x = p0.x + (p1.x - p0.x) / 3;
                const cp1y = p0.y;
                const cp2x = p0.x + 2 * (p1.x - p0.x) / 3;
                const cp2y = p1.y;
                pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
            }
        }

        const areaD = points.length > 0 
            ? `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`
            : '';

        return { points, pathD, areaD, width, height, paddingX, paddingY, maxCount };
    }, [data]);

    // SVG Donut chart segment calculations
    const donutSegments = useMemo(() => {
        const total = severityBreakdown.error + severityBreakdown.warning + severityBreakdown.note;
        const radius = 35;
        const circumference = 2 * Math.PI * radius; // 219.91
        
        if (total === 0) {
            return [
                {
                    key: 'empty',
                    className: 'donut-segment-empty',
                    dashArray: `${circumference} 0`,
                    dashOffset: 0,
                    percent: 0,
                    count: 0
                }
            ];
        }

        const order = [
            { key: 'error', value: severityBreakdown.error, className: 'donut-segment-error' },
            { key: 'warning', value: severityBreakdown.warning, className: 'donut-segment-warning' },
            { key: 'note', value: severityBreakdown.note, className: 'donut-segment-note' }
        ];

        let accumulatedLength = 0;
        return order
            .filter(item => item.value > 0)
            .map(item => {
                const percent = (item.value / total) * 100;
                const length = circumference * (percent / 100);
                const segment = {
                    key: item.key,
                    className: item.className,
                    dashArray: `${length} ${circumference - length}`,
                    dashOffset: -accumulatedLength,
                    percent,
                    count: item.value
                };
                accumulatedLength += length;
                return segment;
            });
    }, [severityBreakdown]);

    if (!targetProjectId) {
        return (
            <div className="analytics-empty-state">
                <div className="analytics-empty-icon">📂</div>
                <h3>No Active Project</h3>
                <p>Select or create a project to view its analytics dashboard.</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="analytics-loading">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
                <span>Loading project analytics...</span>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="analytics-error">
                <div className="analytics-empty-icon">⚠️</div>
                <h3>Failed to Load Analytics</h3>
                <p>{error || 'An unexpected error occurred.'}</p>
            </div>
        );
    }

    const { scanStats, runnerMetrics } = data;

    return (
        <div className="analytics-dashboard">
            {/* KPI Cards Grid */}
            <div className="analytics-kpi-grid">
                {/* Total Scans Card */}
                <div className="analytics-card glassmorphic">
                    <div className="kpi-header">
                        <span className="kpi-title">Total Scans</span>
                        <span className="kpi-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                        </span>
                    </div>
                    <div className="kpi-value">{scanStats.total.toLocaleString()}</div>
                    <div className="kpi-subtext">
                        <span className="kpi-subtext-highlight">{scanStats.completed.toLocaleString()}</span> completed · <span className="kpi-subtext-highlight">{scanStats.failed.toLocaleString()}</span> failed
                    </div>
                </div>

                {/* Total Findings Card */}
                <div className="analytics-card glassmorphic">
                    <div className="kpi-header">
                        <span className="kpi-title">Total Findings</span>
                        <span className="kpi-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                        </span>
                    </div>
                    <div className="kpi-value">{totalFindings.toLocaleString()}</div>
                    <div className="kpi-subtext">
                        <span className="kpi-subtext-highlight">{severityBreakdown.error}</span> errors · <span className="kpi-subtext-highlight">{severityBreakdown.warning}</span> warnings
                    </div>
                </div>

                {/* Average Duration Card */}
                <div className="analytics-card glassmorphic">
                    <div className="kpi-header">
                        <span className="kpi-title">Avg Scan Time</span>
                        <span className="kpi-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                        </span>
                    </div>
                    <div className="kpi-value">{formatDuration(scanStats.avgDuration)}</div>
                    <div className="kpi-subtext">
                        Across all completed runs
                    </div>
                </div>

                {/* Runner Utilization Card */}
                <div className="analytics-card glassmorphic">
                    <div className="kpi-header">
                        <span className="kpi-title">Runner Utilization</span>
                        <span className="kpi-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                                <line x1="6" y1="18" x2="6.01" y2="18"></line>
                            </svg>
                        </span>
                    </div>
                    <div className="kpi-value">{runnerMetrics.utilization.toFixed(1)}%</div>
                    <div className="kpi-subtext">
                        <span className="kpi-subtext-highlight">{runnerMetrics.totalBusy}</span> busy / <span className="kpi-subtext-highlight">{runnerMetrics.totalConnected}</span> connected
                    </div>
                </div>
            </div>

            {/* Row 1: Scan History (Line Chart) and Severity (Donut Chart) */}
            <div className="analytics-chart-row">
                {/* Scan History Card */}
                <div className="analytics-card">
                    <h3 className="chart-card-title">Scans Frequency (Last 30 Days)</h3>
                    <div className="svg-chart-container">
                        {lineChartProps ? (
                            <svg className="svg-chart" viewBox={`0 0 ${lineChartProps.width} ${lineChartProps.height}`}>
                                <defs>
                                    <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--accent-light)" stopOpacity="0.4" />
                                        <stop offset="100%" stopColor="var(--accent-light)" stopOpacity="0.0" />
                                    </linearGradient>
                                </defs>
                                {/* Grid lines */}
                                {[0, 1, 2, 3, 4].map(i => {
                                    const y = lineChartProps.paddingY + i * (lineChartProps.height - 2 * lineChartProps.paddingY) / 4;
                                    const val = Math.round(lineChartProps.maxCount - (i * lineChartProps.maxCount / 4));
                                    return (
                                        <g key={i}>
                                            <line 
                                                x1={lineChartProps.paddingX} 
                                                y1={y} 
                                                x2={lineChartProps.width - lineChartProps.paddingX} 
                                                y2={y} 
                                                className="svg-grid-line" 
                                            />
                                            <text 
                                                x={lineChartProps.paddingX - 10} 
                                                y={y + 4} 
                                                textAnchor="end" 
                                                className="chart-axis-text"
                                            >
                                                {val}
                                            </text>
                                        </g>
                                    );
                                })}

                                {/* Area & Line paths */}
                                <path d={lineChartProps.areaD} className="svg-area-path" />
                                <path d={lineChartProps.pathD} className="svg-line-path" />

                                {/* Interactive Dots */}
                                {lineChartProps.points.map((pt, i) => (
                                    <circle
                                        key={i}
                                        cx={pt.x}
                                        cy={pt.y}
                                        r={hoveredScanIndex === i ? 6 : 4}
                                        fill="var(--accent-light)"
                                        className="chart-interactive-dot"
                                        onMouseEnter={() => setHoveredScanIndex(i)}
                                        onMouseLeave={() => setHoveredScanIndex(null)}
                                    />
                                ))}

                                {/* Interactive Tooltip Overlay */}
                                {lineChartProps.points.map((pt, i) => {
                                    const colWidth = (lineChartProps.width - 2 * lineChartProps.paddingX) / Math.max(1, lineChartProps.points.length - 1);
                                    const colX = pt.x - colWidth / 2;
                                    return (
                                        <rect
                                            key={i}
                                            x={colX}
                                            y={lineChartProps.paddingY}
                                            width={colWidth}
                                            height={lineChartProps.height - 2 * lineChartProps.paddingY}
                                            fill="transparent"
                                            onMouseEnter={() => setHoveredScanIndex(i)}
                                            onMouseLeave={() => setHoveredScanIndex(null)}
                                        />
                                    );
                                })}

                                {/* Tooltip UI */}
                                {hoveredScanIndex !== null && lineChartProps.points[hoveredScanIndex] && (() => {
                                    const pt = lineChartProps.points[hoveredScanIndex];
                                    const tooltipW = 150;
                                    const tooltipH = 50;
                                    
                                    // Keep tooltip inside limits
                                    let tooltipX = pt.x - tooltipW / 2;
                                    if (tooltipX < lineChartProps.paddingX) {
                                        tooltipX = lineChartProps.paddingX;
                                    } else if (tooltipX + tooltipW > lineChartProps.width - lineChartProps.paddingX) {
                                        tooltipX = lineChartProps.width - lineChartProps.paddingX - tooltipW;
                                    }
                                    
                                    let tooltipY = pt.y - tooltipH - 10;
                                    if (tooltipY < lineChartProps.paddingY) {
                                        tooltipY = pt.y + 10;
                                    }

                                    return (
                                        <g transform={`translate(${tooltipX}, ${tooltipY})`} className="chart-tooltip-group">
                                            <rect width={tooltipW} height={tooltipH} className="chart-tooltip-bg" />
                                            <text x="10" y="16" className="chart-tooltip-date">{pt.raw.date}</text>
                                            <text x="10" y="28" className="chart-tooltip-text">Scans: {pt.raw.count}</text>
                                            <text x="10" y="40" className="chart-tooltip-text">
                                                Success: {pt.raw.completed_count} / Fail: {pt.raw.failed_count}
                                            </text>
                                        </g>
                                    );
                                })()}
                            </svg>
                        ) : (
                            <div className="analytics-empty-state">
                                <div className="analytics-empty-icon">📊</div>
                                <p className="chart-axis-text">No scan history recorded in the last 30 days.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Severity Breakdown Card */}
                <div className="analytics-card">
                    <h3 className="chart-card-title">Severity Breakdown</h3>
                    <div className="svg-chart-container">
                        <svg className="svg-chart" viewBox="0 0 100 100">
                            {/* Donut rings */}
                            <g transform="rotate(-90 50 50)">
                                {donutSegments.map((seg) => (
                                    <circle
                                        key={seg.key}
                                        cx="50"
                                        cy="50"
                                        r="35"
                                        className={`svg-donut-segment ${seg.className}`}
                                        strokeDasharray={seg.dashArray}
                                        strokeDashoffset={seg.dashOffset}
                                    />
                                ))}
                            </g>
                            {/* Center labels */}
                            <text x="50" y="47" textAnchor="middle" className="donut-center-text">
                                {totalFindings.toLocaleString()}
                            </text>
                            <text x="50" y="60" textAnchor="middle" className="donut-center-label">
                                Findings
                            </text>
                        </svg>
                    </div>
                </div>
            </div>

            {/* Row 2: Top categories (Bar Chart) and Runner list */}
            <div className="analytics-grid-two-col">
                {/* Top Categories Card */}
                <div className="analytics-card">
                    <h3 className="chart-card-title">Top Vulnerability Categories</h3>
                    <div className="svg-chart-container">
                        {topCategories.length > 0 ? (
                            <svg className="svg-chart" viewBox="0 0 400 220">
                                {(() => {
                                    const maxVal = Math.max(...topCategories.map(c => c.count), 1);
                                    return topCategories.map((cat, i) => {
                                        const y = 25 + i * 38;
                                        const barWidth = (cat.count / maxVal) * 230;
                                        const barClass = `svg-bar-fill svg-bar-fill-${cat.maxSeverity}`;
                                        return (
                                            <g key={cat.category}>
                                                <text 
                                                    x="10" 
                                                    y={y + 12} 
                                                    className="bar-label-text"
                                                >
                                                    <title>{cat.category}</title>
                                                    {getPrettyCategory(cat.category)}
                                                </text>

                                                {/* Bar background */}
                                                <rect 
                                                    x="120" 
                                                    y={y} 
                                                    width="230" 
                                                    height="16" 
                                                    className="svg-bar-bg" 
                                                />

                                                {/* Bar fill */}
                                                <rect 
                                                    x="120" 
                                                    y={y} 
                                                    width={barWidth} 
                                                    height="16" 
                                                    className={barClass} 
                                                />

                                                {/* Value */}
                                                <text 
                                                    x={120 + barWidth + 8} 
                                                    y={y + 12} 
                                                    className="bar-value-text"
                                                >
                                                    {cat.count}
                                                </text>
                                            </g>
                                        );
                                    });
                                })()}
                            </svg>
                        ) : (
                            <div className="analytics-empty-state">
                                <div className="analytics-empty-icon">🎉</div>
                                <p className="chart-axis-text">No findings detected for this project.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Runners Status Card */}
                <div className="analytics-card">
                    <h3 className="chart-card-title">Active Runner Status</h3>
                    <div className="runners-list-container">
                        {runnerMetrics.runners && runnerMetrics.runners.length > 0 ? (
                            runnerMetrics.runners.map((r, i) => (
                                <div key={i} className="runner-row">
                                    <div className="runner-info-left">
                                        <div className={`runner-status-dot ${r.isBusy ? 'busy' : 'idle'}`} />
                                        <div className="runner-name-text">{r.name}</div>
                                        <span className={`runner-tag-badge ${r.isShared ? 'shared' : 'private'}`}>
                                            {r.isShared ? 'Shared' : 'Private'}
                                        </span>
                                    </div>
                                    <div className={`runner-status-text ${r.isBusy ? 'busy' : 'idle'}`}>
                                        {r.isBusy ? 'Fuzzing' : 'Idle'}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="analytics-empty-state">
                                <div className="analytics-empty-icon">🔌</div>
                                <p className="chart-axis-text">No runners currently connected.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
