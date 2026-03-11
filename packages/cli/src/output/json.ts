/**
 * JSON output — structured report with findings and stats.
 */

import type { RunStats } from '@swazz/core';
import type { Finding } from '../types.js';

export function toJson(findings: Finding[], stats: RunStats): any {
    return {
        tool: 'swazz',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        summary: {
            totalRequests: stats.totalRequests,
            totalFindings: findings.length,
            byLevel: {
                error: findings.filter(f => f.level === 'error').length,
                warning: findings.filter(f => f.level === 'warning').length,
                note: findings.filter(f => f.level === 'note').length,
            },
            statusCounts: stats.statusCounts,
            durationSeconds: Math.round((Date.now() - stats.startTime) / 1000),
        },
        findings,
    };
}
