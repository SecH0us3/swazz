/**
 * Console output — live progress + summary table.
 * All output goes to stderr so it never pollutes piped stdout (JSON/SARIF).
 * Uses ANSI colours unless NO_COLOR env var is set.
 */

import type { RunStats } from '@swazz/core';
import type { Finding } from '../types.js';

// ─── ANSI helpers ────────────────────────────────────────────

const useColor = !process.env['NO_COLOR'] && process.stderr.isTTY;

const c = {
    reset:  useColor ? '\x1b[0m'  : '',
    bold:   useColor ? '\x1b[1m'  : '',
    dim:    useColor ? '\x1b[2m'  : '',
    red:    useColor ? '\x1b[31m' : '',
    yellow: useColor ? '\x1b[33m' : '',
    green:  useColor ? '\x1b[32m' : '',
    cyan:   useColor ? '\x1b[36m' : '',
    white:  useColor ? '\x1b[97m' : '',
};

function colorStatus(code: number | string): string {
    const n = Number(code);
    if (n >= 500) return `${c.red}${code}${c.reset}`;
    if (n >= 400) return `${c.yellow}${code}${c.reset}`;
    if (n >= 200 && n < 300) return `${c.green}${code}${c.reset}`;
    return String(code);
}

function colorLevel(level: string): string {
    if (level === 'error')   return `${c.red}${level}${c.reset}`;
    if (level === 'warning') return `${c.yellow}${level}${c.reset}`;
    if (level === 'note')    return `${c.cyan}${level}${c.reset}`;
    return level;
}

// ─── Progress line ───────────────────────────────────────────

let lastLineLength = 0;

export function printProgress(stats: RunStats): void {
    const { progress, totalRequests, totalPlanned, requestsPerSecond } = stats;
    const pct = totalPlanned > 0 ? Math.round((totalRequests / totalPlanned) * 100) : 0;

    const statusStr = Object.entries(stats.statusCounts)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([code, count]) => `${colorStatus(code)}:${count}`)
        .join(' ');

    const ep = progress.currentEndpoint
        ? `${c.dim}${progress.currentEndpoint}${c.reset} ${c.dim}(${progress.currentProfile})${c.reset}`
        : '';

    const line = `  [${c.bold}${pct}%${c.reset}] ${totalRequests}/${totalPlanned} reqs | ${requestsPerSecond} rps | ${ep} | ${statusStr}`;

    // Strip ANSI codes to compute visible length for padding and truncation
    const visibleLen = stripAnsi(line).length;
    const cols = process.stderr.columns || 120;

    // Truncate if wider than terminal
    const displayLine = visibleLen > cols ? truncateAnsi(line, cols - 1) : line;

    process.stderr.write('\r' + ' '.repeat(lastLineLength) + '\r');
    process.stderr.write(displayLine);
    lastLineLength = Math.min(visibleLen, cols);
}

export function clearProgress(): void {
    process.stderr.write('\r' + ' '.repeat(lastLineLength) + '\r');
    lastLineLength = 0;
}

// ─── Summary ─────────────────────────────────────────────────

export function printSummary(findings: Finding[], stats: RunStats): void {
    clearProgress();

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    const sep = c.dim + '─'.repeat(60) + c.reset;

    process.stderr.write('\n' + sep + '\n');
    process.stderr.write(`  ${c.bold}${c.white}swazz scan complete${c.reset}\n`);
    process.stderr.write(sep + '\n');
    process.stderr.write(`  Total requests:  ${c.bold}${stats.totalRequests}${c.reset}\n`);
    process.stderr.write(`  Duration:        ${elapsed}s\n`);
    process.stderr.write(`  Avg RPS:         ${stats.requestsPerSecond}\n`);

    // Status distribution
    process.stderr.write(`\n  Status distribution:\n`);
    for (const [code, count] of Object.entries(stats.statusCounts).sort(([a], [b]) => Number(a) - Number(b))) {
        const bar = '█'.repeat(Math.min(count, 40));
        const coloredBar = Number(code) >= 500 ? c.red + bar + c.reset
            : Number(code) >= 400 ? c.yellow + bar + c.reset
            : c.green + bar + c.reset;
        process.stderr.write(`    ${colorStatus(code).padStart(useColor ? 13 : 3)}: ${String(count).padStart(5)} ${coloredBar}\n`);
    }

    // Findings
    const errors   = findings.filter(f => f.level === 'error').length;
    const warnings = findings.filter(f => f.level === 'warning').length;
    const notes    = findings.filter(f => f.level === 'note').length;

    process.stderr.write(`\n  Findings: ${findings.length > 0 ? c.bold : ''}${findings.length}${c.reset}\n`);
    if (findings.length > 0) {
        if (errors)   process.stderr.write(`    ${c.red}errors${c.reset}:   ${errors}\n`);
        if (warnings) process.stderr.write(`    ${c.yellow}warnings${c.reset}: ${warnings}\n`);
        if (notes)    process.stderr.write(`    ${c.cyan}notes${c.reset}:    ${notes}\n`);

        // Group by endpoint
        const byEndpoint = new Map<string, Finding[]>();
        for (const f of findings) {
            const key = `${f.method} ${f.endpoint}`;
            if (!byEndpoint.has(key)) byEndpoint.set(key, []);
            byEndpoint.get(key)!.push(f);
        }

        process.stderr.write('\n');
        for (const [ep, epFindings] of byEndpoint) {
            process.stderr.write(`    ${c.cyan}${ep}${c.reset}:\n`);
            const byStatus = new Map<number, Finding[]>();
            for (const f of epFindings) {
                if (!byStatus.has(f.status)) byStatus.set(f.status, []);
                byStatus.get(f.status)!.push(f);
            }
            for (const [status, sf] of [...byStatus.entries()].sort(([a], [b]) => a - b)) {
                const profiles = [...new Set(sf.map(f => f.profile))].join(',');
                const level    = sf[0].level;
                process.stderr.write(
                    `      ${colorStatus(status)} (${colorLevel(level)}) x${sf.length} [${c.dim}${profiles}${c.reset}]\n`,
                );
            }
        }
    }

    process.stderr.write('\n' + sep + '\n');
}

// ─── ANSI utilities ──────────────────────────────────────────

/** Remove ANSI escape sequences from a string. */
function stripAnsi(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Truncate a string with ANSI codes to at most `maxVisible` visible characters,
 * then append reset so the terminal isn't left with stale colour.
 */
function truncateAnsi(s: string, maxVisible: number): string {
    let visible = 0;
    let result = '';
    let i = 0;
    while (i < s.length) {
        // Consume ANSI escape
        if (s[i] === '\x1b' && s[i + 1] === '[') {
            const end = s.indexOf('m', i + 2);
            if (end !== -1) {
                result += s.slice(i, end + 1);
                i = end + 1;
                continue;
            }
        }
        if (visible >= maxVisible) break;
        result += s[i];
        visible++;
        i++;
    }
    return result + c.reset;
}
