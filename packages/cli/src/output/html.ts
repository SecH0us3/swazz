/**
 * HTML output — premium report with summary and details.
 */

import type { RunStats } from '@swazz/core';
import type { Finding } from '../types.js';

export function toHtml(findings: Finding[], stats: RunStats): string {
    const timestamp = new Date().toLocaleString();
    const duration = Math.round((Date.now() - stats.startTime) / 1000);
    
    const byLevel = {
        error: findings.filter(f => f.level === 'error').length,
        warning: findings.filter(f => f.level === 'warning').length,
        note: findings.filter(f => f.level === 'note').length,
    };

    // Group findings by endpoint for cleaner display
    const groups: Record<string, Finding[]> = {};
    for (const f of findings) {
        const key = `${f.method} ${f.endpoint}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    }

    function escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    const VALUE_LIMIT = 100;

    /** Recursively truncate long values, with special handling for repeating patterns. */
    function truncateValue(val: any): any {
        if (val === null || val === undefined) return val;
        
        if (typeof val === 'string') {
            if (val.length <= VALUE_LIMIT) return val;
            
            // Check for simple repetition (e.g. "AAAAA...")
            const firstChar = val[0];
            let isUniform = true;
            for (let i = 1; i < val.length; i++) {
                if (val[i] !== firstChar) {
                    isUniform = false;
                    break;
                }
            }
            
            if (isUniform) {
                return firstChar.repeat(10) + `... (${val.length} repeats)`;
            }
            
            // Standard truncation
            return val.slice(0, VALUE_LIMIT) + `... (${val.length - VALUE_LIMIT} chars more)`;
        }
        
        if (Array.isArray(val)) {
            if (val.length <= 5) return val.map(truncateValue);
            return [...val.slice(0, 5).map(truncateValue), `... (${val.length - 5} more items)`];
        }
        
        if (typeof val === 'object') {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(val)) {
                out[k] = truncateValue(v);
            }
            return out;
        }
        
        return val;
    }

    const findingRows = Object.entries(groups).map(([key, group]) => {
        const [method, path] = key.split(' ');
        const items = group.map(f => {
            const truncatedPayload = truncateValue(f.payload);
            const truncatedResponse = truncateValue(f.responseBody);

            const payloadHtml = f.payload ? `
                <div class="payload-block">
                    <h4>Payload</h4>
                    <pre><code>${escapeHtml(JSON.stringify(truncatedPayload, null, 2))}</code></pre>
                </div>
            ` : '';

            const responseHtml = f.responseBody ? `
                <div class="payload-block">
                    <h4>Response Body</h4>
                    <pre><code>${escapeHtml(typeof truncatedResponse === 'string' ? truncatedResponse : JSON.stringify(truncatedResponse, null, 2))}</code></pre>
                </div>
            ` : '';

            return `
                <div class="finding-item level-${f.level}">
                    <div class="finding-meta">
                        <span class="badge profile-${f.profile}">${f.profile}</span>
                        <span class="status">HTTP ${f.status}</span>
                        <span class="duration">${f.duration}ms</span>
                    </div>
                    ${payloadHtml}
                    ${responseHtml}
                </div>
            `;
        }).join('');

        return `
            <div class="finding-group">
                <h3><span class="method">${method}</span> ${path} <span class="count">${group.length}</span></h3>
                <div class="group-items">${items}</div>
            </div>
        `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swazz Fuzzing Report</title>
    <style>
        :root {
            --bg: #0f172a;
            --fg: #f1f5f9;
            --card: #1e293b;
            --border: #334155;
            --primary: #38bdf8;
            --error: #ef4444;
            --warning: #f59e0b;
            --note: #10b981;
        }
        body {
            background: var(--bg);
            color: var(--fg);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 2rem;
            line-height: 1.5;
        }
        .container { max-width: 1000px; margin: 0 auto; }
        header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
        h1 { margin: 0; font-size: 1.875rem; color: var(--primary); }
        .timestamp { font-size: 0.875rem; color: #94a3b8; }
        
        .stats-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 1rem; 
            margin-bottom: 3rem; 
        }
        .stat-card { 
            background: var(--card); 
            padding: 1.5rem; 
            border-radius: 0.75rem; 
            border: 1px solid var(--border); 
            text-align: center;
        }
        .stat-value { font-size: 1.5rem; font-weight: bold; display: block; }
        .stat-label { font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        
        .finding-group { 
            background: var(--card); 
            margin-bottom: 1.5rem; 
            border-radius: 0.75rem; 
            border: 1px solid var(--border);
            overflow: hidden;
        }
        .finding-group h3 { 
            margin: 0; 
            padding: 1rem 1.5rem; 
            background: #273549; 
            font-size: 1.125rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .method { color: var(--primary); font-family: monospace; }
        .count { margin-left: auto; font-size: 0.875rem; background: #475569; padding: 0.125rem 0.5rem; border-radius: 9999px; }
        
        .finding-item { 
            padding: 1rem 1.5rem; 
            border-top: 1px solid var(--border);
        }
        .finding-meta { display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem; font-size: 0.875rem; }
        .badge { padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: bold; }
        .profile-RANDOM { background: #6366f1; }
        .profile-BOUNDARY { background: #8b5cf6; }
        .profile-MALICIOUS { background: #d946ef; }
        .status { color: var(--error); font-weight: bold; }
        .duration { color: #94a3b8; }
        .payload-block {
            margin-top: 1rem;
        }
        .payload-block h4 {
            margin: 0 0 0.5rem 0;
            font-size: 0.75rem;
            text-transform: uppercase;
            color: #94a3b8;
            letter-spacing: 0.05em;
        }
        .payload-block pre {
            background: #0f172a; 
            padding: 0.75rem; 
            border-radius: 0.375rem; 
            margin: 0;
            overflow-x: auto;
        }
        .payload-block code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            font-size: 0.8125rem;
            word-break: break-all;
            white-space: pre-wrap;
        }
        
        .level-error { border-left: 4px solid var(--error); }
        .level-warning { border-left: 4px solid var(--warning); }
        .level-note { border-left: 4px solid var(--note); }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Swazz Scan Report</h1>
            <div class="timestamp">Generated on ${timestamp} &bull; Took ${duration}s</div>
        </header>

        <div class="stats-grid">
            <div class="stat-card">
                <span class="stat-value">${stats.totalRequests}</span>
                <span class="stat-label">Requests</span>
            </div>
            <div class="stat-card">
                <span class="stat-value" style="color: var(--error)">${byLevel.error}</span>
                <span class="stat-label">Errors</span>
            </div>
            <div class="stat-card">
                <span class="stat-value" style="color: var(--warning)">${byLevel.warning}</span>
                <span class="stat-label">Warnings</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${stats.progress.totalEndpoints || Object.keys(groups).length}</span>
                <span class="stat-label">Endpoints</span>
            </div>
        </div>

        <h2>Findings</h2>
        <div class="findings-list">
            ${findingRows || '<p>No findings discovered. ✨</p>'}
        </div>
    </div>
</body>
</html>`;
}
