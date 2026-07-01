import type { RunStats } from '../types.js';
import type { ResultSummary } from './useRunner.js';
import type { QueryOptions } from './useDb.js';
import { useAppStore } from '../store/appStore.js';

interface UseRunHistoryProps {
    runs: any[];
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
    getRunResults: (id: string) => Promise<ResultSummary[]>;
    deleteRun: (id: string) => Promise<void>;
    showToast: (message: string, type: 'info' | 'success' | 'error') => void;
    onRunLoaded: () => void;
}

export function useRunHistory({ runs, queryResults, getRunResults, deleteRun, showToast, onRunLoaded }: UseRunHistoryProps) {
    // No need to subscribe to store state here since we use getState() in callbacks

    const handleLoadRun = async (runId: string, importedRun?: any) => {
        const runData = importedRun || runs.find(r => r.id === runId);
        if (!runData) return;
        useAppStore.setState({
            historyStats: runData.stats,
            loadedRunId: runId,
        });
        onRunLoaded();
        showToast(`Loaded run from history`, 'success');
    };

    const handleDeleteRun = async (runId: string) => {
        await deleteRun(runId);
        const state = useAppStore.getState();
        if (state.loadedRunId === runId) {
            useAppStore.setState({ loadedRunId: null, historyStats: null });
        }
        if (state.compareRunIdA === runId || state.compareRunIdB === runId) {
            useAppStore.setState({
                compareRunIdA: null,
                compareRunIdB: null,
                activeTab: state.activeTab === 'compare' ? 'heatmap' : state.activeTab
            });
        }
        showToast('Run deleted', 'success');
    };

    const handleExport = async (runId: string | null, baseUrl?: string) => {
        if (!runId) {
            showToast('No run selected to export', 'error');
            return;
        }
        showToast('Preparing export…', 'info');
        const rows = await getRunResults(runId);
        if (rows.length === 0) {
            showToast('No results to export', 'error');
            return;
        }
        const data = {
            exportedAt: new Date().toISOString(),
            baseUrl,
            totalRequests: rows.length,
            summary: {
                crashes5xx: rows.filter(r => r.status >= 500).length,
                errors4xx: rows.filter(r => r.status >= 400 && r.status < 500).length,
                success2xx: rows.filter(r => r.status >= 200 && r.status < 300).length,
                networkErrors: rows.filter(r => r.status === 0).length,
                totalRetries: rows.reduce((sum, r) => sum + (r.retries ?? 0), 0),
            },
            results: rows,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swazz-results-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${rows.length.toLocaleString()} results`, 'success');
    };

    const handleExportHTML = async (runId: string | null) => {
        if (!runId) {
            showToast('No active run or selected history to export', 'error');
            return;
        }
        showToast('Generating HTML report…', 'info');
        try {
            const runData = runs.find(r => r.id === runId);
            const startedAt = runData ? runData.startedAt : Date.now();
            const completedAt = runData ? runData.completedAt : Date.now();
            const stats = runData ? runData.stats : null;

            const rows = await getRunResults(runId);
            const findings = classifyResults(rows);
            const htmlContent = generateHTMLReport(findings, stats, startedAt, completedAt);

            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `swazz-report-${Date.now()}.html`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Report downloaded', 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Export failed', 'error');
        }
    };

    const handleExportMD = async (runId: string | null) => {
        if (!runId) {
            showToast('No active run or selected history to export', 'error');
            return;
        }
        showToast('Generating Markdown report…', 'info');
        try {
            const runData = runs.find(r => r.id === runId);
            const startedAt = runData ? runData.startedAt : Date.now();
            const completedAt = runData ? runData.completedAt : Date.now();
            const stats = runData ? runData.stats : null;

            const rows = await getRunResults(runId);
            const findings = classifyResults(rows);
            const mdContent = generateMarkdownReport(findings, stats, startedAt, completedAt);

            const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `swazz-report-${Date.now()}.md`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Markdown downloaded', 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Export failed', 'error');
        }
    };

    return {
        handleLoadRun, handleDeleteRun, handleExport, handleExportHTML, handleExportMD,
        queryResults,
    };
}

// ─── Helpers for Client-Side Report Generation ─────────────────

interface ClientFinding {
    id: string;
    ruleId: string;
    level: 'error' | 'warning' | 'note';
    endpoint: string;
    resolvedPath: string;
    method: string;
    profile: string;
    status: number;
    duration: number;
    payload?: any;
    payloadPreview?: string;
    responseBody?: any;
    responsePreview?: string;
    error?: string;
    timestamp: number;
    source: string;
    owaspCategory: string[];
}

function escapeHtml(str: string): string {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDateTime(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function getOwaspCategories(ruleId: string): string[] {
    switch (ruleId) {
        case 'swazz/bola-idor':
        case 'swazz/tenant-isolation-bypass':
            return ['A01:2025 Broken Access Control'];
        case 'swazz/unauthorized-access':
            return [
                'A07:2025 Authentication Failures',
                'A01:2025 Broken Access Control'
            ];
        case 'swazz/sensitive-data-leak':
            return ['A01:2025 Broken Access Control'];
        case 'swazz/no-rate-limit':
        case 'swazz/rate-limit-active':
        case 'swazz/response-size-anomaly':
            return ['A06:2025 Insecure Design'];
        case 'swazz/oob-interaction':
            return ['A08:2025 Software or Data Integrity Failures'];
        case 'swazz/cors-misconfig':
            return ['A02:2025 Security Misconfiguration'];
        case 'swazz/crlf-injection':
        case 'swazz/header-injection':
        case 'swazz/reflected-xss':
        case 'swazz/rce-leak':
        case 'swazz/time-based-sqli':
        case 'swazz/time-based-cmdi':
            return ['A05:2025 Injection'];
        case 'swazz/stack-trace-leak':
        case 'swazz/null-pointer-exception':
        case 'swazz/sql-error-leak':
        case 'swazz/timeout':
        case 'swazz/network-error':
            return ['A10:2025 Mishandling of Exceptional Conditions'];
        default:
            if (ruleId.startsWith('swazz/status-5')) {
                return ['A10:2025 Mishandling of Exceptional Conditions'];
            }
            return [];
    }
}

function classifyResults(rows: ResultSummary[]): ClientFinding[] {
    const findings: ClientFinding[] = [];
    const defaultIgnore = new Set([401, 403, 404, 405, 422, 429]);

    for (const r of rows) {
        if (r.analyzerFindings && r.analyzerFindings.length > 0) {
            for (const af of r.analyzerFindings) {
                let source = 'response_body';
                if (af.ruleId.startsWith('swazz/crlf-') || af.ruleId.startsWith('swazz/header-') || af.ruleId === 'swazz/crlf-injection') {
                    source = 'response_headers';
                } else if (af.ruleId === 'swazz/no-rate-limit' || af.ruleId === 'swazz/rate-limit-active') {
                    source = 'rate_limiting';
                } else if (af.ruleId === 'swazz/bola-idor' || af.ruleId === 'swazz/unauthorized-access') {
                    source = 'access_control';
                }

                findings.push({
                    id: r.id,
                    ruleId: af.ruleId,
                    level: af.level,
                    endpoint: r.endpoint,
                    resolvedPath: r.resolvedPath,
                    method: r.method,
                    profile: r.profile,
                    status: r.status,
                    duration: r.duration,
                    payloadPreview: r.payloadPreview,
                    responsePreview: r.responsePreview,
                    error: af.message || af.evidence,
                    timestamp: r.timestamp,
                    source,
                    owaspCategory: af.owaspCategory || getOwaspCategories(af.ruleId),
                });
            }
        } else {
            const isIgnoredCode = defaultIgnore.has(r.status);
            if (r.status === 0 || r.status >= 400) {
                if (!isIgnoredCode) {
                    let ruleId = '';
                    let level: 'error' | 'warning' | 'note' = 'error';
                    let errorMsg = r.error || '';

                    if (r.status === 0) {
                        if (errorMsg.includes('timed out')) {
                            ruleId = 'swazz/timeout';
                        } else {
                            ruleId = 'swazz/network-error';
                        }
                    } else {
                        ruleId = `swazz/status-${r.status}`;
                        if (r.status >= 400 && r.status < 500) {
                            level = 'error';
                        }
                    }

                    findings.push({
                        id: r.id,
                        ruleId,
                        level,
                        endpoint: r.endpoint,
                        resolvedPath: r.resolvedPath,
                        method: r.method,
                        profile: r.profile,
                        status: r.status,
                        duration: r.duration,
                        payloadPreview: r.payloadPreview,
                        responsePreview: r.responsePreview,
                        error: errorMsg,
                        timestamp: r.timestamp,
                        source: 'status_code',
                        owaspCategory: getOwaspCategories(ruleId),
                    });
                }
            }
        }
    }
    return findings;
}

function generateHTMLReport(findings: ClientFinding[], stats: RunStats | null, startedAt: number, completedAt: number): string {
    const timestampStr = formatDateTime(new Date());
    let duration = 0;
    if (completedAt && startedAt) {
        duration = Math.max(0, Math.floor((completedAt - startedAt) / 1000));
    }

    let errors = 0;
    let warnings = 0;
    let notes = 0;

    for (const f of findings) {
        if (f.level === 'error') errors++;
        else if (f.level === 'warning') warnings++;
        else if (f.level === 'note') notes++;
    }

    const owaspCounts: Record<string, number> = {};
    for (const f of findings) {
        if (f.owaspCategory && f.owaspCategory.length > 0) {
            for (const cat of f.owaspCategory) {
                owaspCounts[cat] = (owaspCounts[cat] || 0) + 1;
            }
        } else {
            owaspCounts["Unmapped / Other"] = (owaspCounts["Unmapped / Other"] || 0) + 1;
        }
    }

    const owaspCategories = [
        "A01:2025 Broken Access Control",
        "A02:2025 Security Misconfiguration",
        "A03:2025 Software Supply Chain Failures",
        "A04:2025 Cryptographic Failures",
        "A05:2025 Injection",
        "A06:2025 Insecure Design",
        "A07:2025 Authentication Failures",
        "A08:2025 Software or Data Integrity Failures",
        "A09:2025 Security Logging & Alerting Failures",
        "A10:2025 Mishandling of Exceptional Conditions",
    ];

    let owaspGrid = '';
    for (const cat of owaspCategories) {
        const count = owaspCounts[cat] || 0;
        const cardClass = count > 0 ? "has-findings" : "no-findings";
        owaspGrid += `
            <div class="owasp-card ${cardClass}">
                <span class="owasp-name">${escapeHtml(cat)}</span>
                <span class="owasp-count">${count}</span>
            </div>`;
    }
    if (owaspCounts["Unmapped / Other"]) {
        owaspGrid += `
            <div class="owasp-card has-findings">
                <span class="owasp-name">Unmapped / Other Findings</span>
                <span class="owasp-count">${owaspCounts["Unmapped / Other"]}</span>
            </div>`;
    }

    const groups: Record<string, ClientFinding[]> = {};
    const groupOrder: string[] = [];
    const uniqueStatuses = new Set<number>();
    const uniqueProfiles = new Set<string>();

    for (const f of findings) {
        const key = `${f.method} ${f.endpoint}`;
        if (!groups[key]) {
            groups[key] = [];
            groupOrder.push(key);
        }
        groups[key].push(f);
        uniqueStatuses.add(f.status);
        uniqueProfiles.add(f.profile);
    }

    let statusOptions = '';
    for (const status of Array.from(uniqueStatuses).sort()) {
        statusOptions += `<option value="${status}">${status}</option>`;
    }
    let profileOptions = '';
    for (const profile of Array.from(uniqueProfiles).sort()) {
        profileOptions += `<option value="${profile}">${profile}</option>`;
    }

    let totalEndpoints = stats?.progress?.totalEndpoints || 0;
    if (totalEndpoints === 0) {
        totalEndpoints = groupOrder.length;
    }
    const totalRequests = stats?.totalRequests || 0;

    let findingsContent = '';
    for (const key of groupOrder) {
        const group = groups[key];
        const firstSpace = key.indexOf(' ');
        const method = key.substring(0, firstSpace);
        const path = key.substring(firstSpace + 1);

        findingsContent += `
            <div class="finding-group" data-endpoint="${escapeHtml(path)}">
                <h3><span class="method">${escapeHtml(method)}</span> ${escapeHtml(path)} <span class="count">${group.length}</span></h3>
                <div class="group-items">`;

        for (const f of group) {
            let payloadHTML = '';
            if (f.payloadPreview) {
                payloadHTML = `
                    <div class="payload-block">
                        <h4>Payload</h4>
                        <pre><code>${escapeHtml(f.payloadPreview)}</code></pre>
                    </div>`;
            }

            let responseHTML = '';
            if (f.responsePreview) {
                responseHTML = `
                    <div class="payload-block">
                        <h4>Response Body</h4>
                        <pre><code>${escapeHtml(f.responsePreview)}</code></pre>
                    </div>`;
            }

            let errorHTML = '';
            if (f.error) {
                errorHTML = `
                    <div style="margin-top: 8px; font-size: 0.875rem; color: #94a3b8;">
                        <strong>Description:</strong> ${escapeHtml(f.error)}
                    </div>`;
            }

            findingsContent += `
                <div class="finding-item level-${f.level}" data-status="${f.status}" data-profile="${f.profile}">
                    <div class="finding-meta">
                        <span class="badge profile-${f.profile}">${f.profile}</span>
                        <span class="status">HTTP ${f.status}</span>
                        <span class="duration">${f.duration}ms</span>
                    </div>
                    ${errorHTML}
                    ${payloadHTML}
                    ${responseHTML}
                </div>`;
        }
        findingsContent += `</div></div>`;
    }

    if (!findingsContent) {
        findingsContent = `<p>No findings discovered. ✨</p>`;
    }

    const reportJS = `document.addEventListener("DOMContentLoaded", () => {
    const epFilter = document.getElementById('endpointFilter');
    const statusFilter = document.getElementById('statusFilter');
    const profileFilter = document.getElementById('profileFilter');

    function filterFindings() {
        const epValue = epFilter ? epFilter.value.toLowerCase() : "";
        const statusValue = statusFilter ? statusFilter.value : "";
        const profileValue = profileFilter ? profileFilter.value : "";

        document.querySelectorAll('.finding-group').forEach(group => {
            const endpoint = (group.getAttribute('data-endpoint') || "").toLowerCase();
            const items = group.querySelectorAll('.finding-item');
            let visibleItems = 0;

            items.forEach(item => {
                const status = item.getAttribute('data-status') || "";
                const profile = item.getAttribute('data-profile') || "";

                const epMatch = endpoint.includes(epValue);
                const statusMatch = !statusValue || status === statusValue;
                const profileMatch = !profileValue || profile === profileValue;

                if (epMatch && statusMatch && profileMatch) {
                    item.style.display = 'block';
                    visibleItems++;
                } else {
                    item.style.display = 'none';
                }
            });

            if (visibleItems > 0) {
                group.style.display = 'block';
                const countSpan = group.querySelector('.count');
                if (countSpan) {
                    countSpan.textContent = visibleItems;
                }
            } else {
                group.style.display = 'none';
            }
        });
    }

    if (epFilter) epFilter.addEventListener('input', filterFindings);
    if (statusFilter) statusFilter.addEventListener('change', filterFindings);
    if (profileFilter) profileFilter.addEventListener('change', filterFindings);
});`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swazz Fuzzing Report</title>
    <style>
        :root {
            --bg: #0f172a; --fg: #f1f5f9; --card: #1e293b;
            --border: #334155; --primary: #38bdf8;
            --error: #ef4444; --warning: #f59e0b; --note: #10b981;
        }
        body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 2rem; line-height: 1.5; }
        .container { max-width: 1000px; margin: 0 auto; }
        header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
        h1 { margin: 0; font-size: 1.875rem; color: var(--primary); }
        .timestamp { font-size: 0.875rem; color: #94a3b8; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 3rem; }
        .stat-card { background: var(--card); padding: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border); text-align: center; }
        .stat-value { font-size: 1.5rem; font-weight: bold; display: block; }
        .stat-label { font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .owasp-section { margin-bottom: 3rem; }
        .owasp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
        .owasp-card { background: var(--card); padding: 1.25rem; border-radius: 0.75rem; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .owasp-card.has-findings { border-color: var(--error); }
        .owasp-card.no-findings { opacity: 0.65; }
        .owasp-name { font-size: 0.875rem; font-weight: 500; }
        .owasp-count { font-size: 1.125rem; font-weight: bold; padding: 0.25rem 0.75rem; border-radius: 9999px; }
        .owasp-card.has-findings .owasp-count { background: rgba(239, 68, 68, 0.2); color: var(--error); }
        .owasp-card.no-findings .owasp-count { background: #475569; color: var(--fg); }
        .finding-group { background: var(--card); margin-bottom: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border); overflow: hidden; }
        .finding-group h3 { margin: 0; padding: 1rem 1.5rem; background: #273549; font-size: 1.125rem; display: flex; align-items: center; gap: 0.75rem; }
        .method { color: var(--primary); font-family: monospace; }
        .count { margin-left: auto; font-size: 0.875rem; background: #475569; padding: 0.125rem 0.5rem; border-radius: 9999px; }
        .finding-item { padding: 1rem 1.5rem; border-top: 1px solid var(--border); }
        .finding-meta { display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem; font-size: 0.875rem; }
        .badge { padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: bold; }
        .profile-RANDOM { background: #6366f1; } .profile-BOUNDARY { background: #8b5cf6; } .profile-MALICIOUS { background: #d946ef; }
        .status { color: var(--error); font-weight: bold; }
        .duration { color: #94a3b8; }
        .payload-block { margin-top: 1rem; }
        .payload-block h4 { margin: 0 0 0.5rem 0; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; }
        .payload-block pre { background: #0f172a; padding: 0.75rem; border-radius: 0.375rem; margin: 0; overflow-x: auto; }
        .payload-block code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.8125rem; word-break: break-all; white-space: pre-wrap; }
        .level-error { border-left: 4px solid var(--error); }
        .level-warning { border-left: 4px solid var(--warning); }
        .level-note { border-left: 4px solid var(--note); }
        .filters { display: flex; gap: 1rem; margin-bottom: 2rem; background: var(--card); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); }
        .filters input, .filters select { flex: 1; padding: 0.5rem; border-radius: 0.375rem; border: 1px solid var(--border); background: var(--bg); color: var(--fg); outline: none; }
        .filters input:focus, .filters select:focus { border-color: var(--primary); }
        @media print {
            body { background: white; color: black; }
            .filters, .owasp-section { display: none; }
            .finding-group { break-inside: avoid; border-color: #ccc; box-shadow: none; }
            .finding-group h3 { background: #f8fafc; color: #0f172a; border-bottom: 1px solid #ccc; }
            .finding-item { break-inside: avoid; }
            .payload-block pre { background: #f8fafc; color: black; border: 1px solid #ccc; white-space: pre-wrap; word-wrap: break-word; }
            .stat-card { border-color: #ccc; }
        }
        .noscript-warning {
            background: var(--warning); color: #000; padding: 1rem; border-radius: 0.5rem; margin: 1rem auto; max-width: 1000px; font-weight: bold; text-align: center;
        }
    </style>
</head>
<body>
    <noscript>
        <div class="noscript-warning">
            ⚠️ JavaScript is disabled. Filters and interactive features are unavailable, but all raw findings are displayed below.
        </div>
    </noscript>
    <div class="container">
        <header>
            <h1>Swazz Scan Report</h1>
            <div class="timestamp">Generated on ${timestampStr} &bull; Took ${duration}s</div>
        </header>
        <div class="stats-grid">
            <div class="stat-card"><span class="stat-value">${totalRequests}</span><span class="stat-label">Requests</span></div>
            <div class="stat-card"><span class="stat-value" style="color: var(--error)">${errors}</span><span class="stat-label">Errors</span></div>
            <div class="stat-card"><span class="stat-value" style="color: var(--warning)">${warnings}</span><span class="stat-label">Warnings</span></div>
            <div class="stat-card"><span class="stat-value">${totalEndpoints}</span><span class="stat-label">Endpoints</span></div>
        </div>

        <h2>OWASP Top 10 (2025) Summary</h2>
        <div class="owasp-section">
            <div class="owasp-grid">
                ${owaspGrid}
            </div>
        </div>

        <div class="filters">
            <input type="text" id="endpointFilter" placeholder="Filter by endpoint path...">
            <select id="statusFilter">
                <option value="">All Statuses</option>
                ${statusOptions}
            </select>
            <select id="profileFilter">
                <option value="">All Profiles</option>
                ${profileOptions}
            </select>
        </div>

        <h2>Findings</h2>
        <div class="findings-list">${findingsContent}</div>
    </div>
    <script>
${reportJS}
    </script>
</body>
</html>`;
}

function generateMarkdownReport(findings: ClientFinding[], stats: RunStats | null, startedAt: number, completedAt: number, version: string = '1.0.0'): string {
    let errors = 0;
    let warnings = 0;
    let notes = 0;

    for (const f of findings) {
        if (f.level === 'error') errors++;
        else if (f.level === 'warning') warnings++;
        else if (f.level === 'note') notes++;
    }

    let durationSec = 0;
    if (completedAt && startedAt) {
        durationSec = Math.max(0, Math.floor((completedAt - startedAt) / 1000));
    }
    const totalRequests = stats?.totalRequests || 0;

    let sb = '';
    sb += `# 🛡️ Swazz API Fuzzer Report (v${version})\n\n`;
    sb += `**Generated At**: ${new Date().toISOString()}\n\n`;

    sb += `## 📊 Executive Summary\n\n`;
    sb += `| Metric | Value |\n`;
    sb += `| --- | --- |\n`;
    sb += `| Total Requests | ${totalRequests} |\n`;
    sb += `| Duration | ${durationSec}s |\n`;
    sb += `| Total Findings | ${findings.length} |\n`;
    sb += `| 🔴 Errors | ${errors} |\n`;
    sb += `| 🟡 Warnings | ${warnings} |\n`;
    sb += `| 🔵 Notes | ${notes} |\n\n`;

    const groupedByEndpoint: Record<string, ClientFinding[]> = {};
    for (const f of findings) {
        if (!groupedByEndpoint[f.endpoint]) {
            groupedByEndpoint[f.endpoint] = [];
        }
        groupedByEndpoint[f.endpoint].push(f);
    }

    sb += `## 🔍 Detailed Findings\n\n`;
    if (findings.length === 0) {
        sb += `✅ **No vulnerabilities detected.**\n`;
        return sb;
    }

    for (const [endpoint, epFindings] of Object.entries(groupedByEndpoint)) {
        sb += `### ${endpoint}\n\n`;
        for (const f of epFindings) {
            sb += `#### [${f.level.toUpperCase()}] ${f.ruleId}\n`;
            sb += `- **Path:** \`${f.resolvedPath}\`\n`;
            if (f.method) {
                sb += `- **Method:** \`${f.method}\`\n`;
            }
            if (f.owaspCategory && f.owaspCategory.length > 0) {
                sb += `- **OWASP Category:** ${f.owaspCategory.join(', ')}\n`;
            }
            if (f.source) {
                sb += `- **Source:** \`${f.source}\`\n`;
            }
            if (f.error) {
                sb += `- **Description:** ${f.error}\n`;
            }

            if (f.payloadPreview && f.payloadPreview.trim() && f.payloadPreview !== '<nil>') {
                sb += `- **Sent Payload:**\n`;
                sb += `  \`\`\`json\n  ${f.payloadPreview.split('\n').join('\n  ')}\n  \`\`\`\n`;
            }

            if (f.responsePreview && f.responsePreview.trim() && f.responsePreview !== '<nil>') {
                sb += `- **Response Preview:**\n`;
                sb += `  \`\`\`text\n  ${f.responsePreview.split('\n').join('\n  ')}\n  \`\`\`\n`;
            }
            sb += `\n`;
        }
    }

    return sb;
}
