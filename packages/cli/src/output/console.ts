/**
 * Console output — live progress + summary table.
 */

import type { RunStats } from '@swazz/core';
import type { Finding } from '../types.js';

let lastLineLength = 0;

export function printProgress(stats: RunStats): void {
    const { progress, totalRequests, totalPlanned, requestsPerSecond } = stats;
    const pct = totalPlanned > 0 ? Math.round((totalRequests / totalPlanned) * 100) : 0;

    const statusStr = Object.entries(stats.statusCounts)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([code, count]) => `${code}:${count}`)
        .join(' ');

    const line = `  [${pct}%] ${totalRequests}/${totalPlanned} reqs | ${requestsPerSecond} rps | ${progress.currentEndpoint} (${progress.currentProfile}) | ${statusStr}`;

    // Clear previous line and write new one
    process.stderr.write('\r' + ' '.repeat(lastLineLength) + '\r');
    process.stderr.write(line);
    lastLineLength = line.length;
}

export function clearProgress(): void {
    process.stderr.write('\r' + ' '.repeat(lastLineLength) + '\r');
    lastLineLength = 0;
}

export function printSummary(findings: Finding[], stats: RunStats): void {
    clearProgress();

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log(`  swazz scan complete`);
    console.log('='.repeat(60));
    console.log(`  Total requests:  ${stats.totalRequests}`);
    console.log(`  Duration:        ${elapsed}s`);
    console.log(`  Avg RPS:         ${stats.requestsPerSecond}`);

    // Status distribution
    console.log(`\n  Status distribution:`);
    for (const [code, count] of Object.entries(stats.statusCounts).sort(([a], [b]) => Number(a) - Number(b))) {
        const bar = '#'.repeat(Math.min(count, 40));
        console.log(`    ${code.padStart(3)}: ${String(count).padStart(5)} ${bar}`);
    }

    // Findings
    console.log(`\n  Findings: ${findings.length}`);
    if (findings.length > 0) {
        const errors = findings.filter(f => f.level === 'error').length;
        const warnings = findings.filter(f => f.level === 'warning').length;
        const notes = findings.filter(f => f.level === 'note').length;

        if (errors) console.log(`    errors:   ${errors}`);
        if (warnings) console.log(`    warnings: ${warnings}`);
        if (notes) console.log(`    notes:    ${notes}`);

        // Group by endpoint
        const byEndpoint = new Map<string, Finding[]>();
        for (const f of findings) {
            const key = `${f.method} ${f.endpoint}`;
            if (!byEndpoint.has(key)) byEndpoint.set(key, []);
            byEndpoint.get(key)!.push(f);
        }

        console.log('');
        for (const [ep, epFindings] of byEndpoint) {
            console.log(`    ${ep}:`);
            const byStatus = new Map<number, Finding[]>();
            for (const f of epFindings) {
                if (!byStatus.has(f.status)) byStatus.set(f.status, []);
                byStatus.get(f.status)!.push(f);
            }
            for (const [status, sf] of [...byStatus.entries()].sort(([a], [b]) => a - b)) {
                const profiles = [...new Set(sf.map(f => f.profile))].join(',');
                const level = sf[0].level;
                console.log(`      ${status} (${level}) x${sf.length} [${profiles}]`);
            }
        }
    }

    console.log('\n' + '='.repeat(60));
}
