// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, expect, it } from 'vitest';
import type { ResultSummary } from '../hooks/useRunner.js';
import { buildGroupedFindingsExport, formatGroupedFindingsMarkdown } from './findingsExport.js';

function makeRow(overrides: Partial<ResultSummary> = {}): ResultSummary {
    return {
        id: 'row-1',
        timestamp: 1700000000000,
        method: 'POST',
        endpoint: '/api/render',
        resolvedPath: '/api/render',
        status: 200,
        profile: 'MALICIOUS',
        duration: 42,
        payloadSize: 32,
        retries: 0,
        payloadPreview: '{"tpl":"{{7*7}}"}',
        responsePreview: '49',
        responseSize: 2,
        ...overrides,
    };
}

describe('buildGroupedFindingsExport', () => {
    it('deduplicates 100+ repeated security findings into 1 target with up to 2 distinct examples', () => {
        const rows: ResultSummary[] = [];
        for (let i = 0; i < 120; i++) {
            rows.push(
                makeRow({
                    id: `r-${i}`,
                    identity: i < 60 ? 'User A' : 'User B',
                    payloadPreview: i < 60 ? '{"tpl":"{{7*7}}"}' : '{"tpl":"${7*7}"}',
                    analyzerFindings: [
                        {
                            ruleId: 'ssti-detection',
                            level: 'error',
                            message: 'Server-Side Template Injection detected',
                        },
                    ],
                })
            );
        }

        const report2 = buildGroupedFindingsExport(rows, {
            runId: 'run-123',
            baseUrl: 'https://target.example',
            maxExamplesPerFinding: 2,
        });

        expect(report2.summary.totalFindingRows).toBe(120);
        expect(report2.summary.securityGroups).toBe(1);
        expect(report2.summary.uniqueTargets).toBe(1);
        expect(report2.summary.exportedExamples).toBe(2);

        const target = report2.securityVulnerabilities[0].targets[0];
        expect(target.count).toBe(120);
        expect(target.identities).toEqual(['User A', 'User B']);
        expect(target.examples).toHaveLength(2);
        expect(target.examples[0].payloadPreview).toBe('{"tpl":"{{7*7}}"}');
        expect(target.examples[1].payloadPreview).toBe('{"tpl":"${7*7}"}');

        const report1 = buildGroupedFindingsExport(rows, {
            runId: 'run-123',
            maxExamplesPerFinding: 1,
        });
        expect(report1.summary.exportedExamples).toBe(1);
        expect(report1.securityVulnerabilities[0].targets[0].examples).toHaveLength(1);
    });

    it('groups infrastructure errors separately and respects excludedStatuses', () => {
        const rows: ResultSummary[] = [
            makeRow({
                id: 'err-500-1',
                method: 'GET',
                endpoint: '/api/items',
                status: 500,
                responsePreview: 'Internal Server Error',
            }),
            makeRow({
                id: 'err-500-2',
                method: 'GET',
                endpoint: '/api/items',
                status: 500,
                responsePreview: 'Internal Server Error',
            }),
            makeRow({
                id: 'err-404-1',
                method: 'GET',
                endpoint: '/api/missing',
                status: 404,
                responsePreview: 'Not Found',
            }),
        ];

        const report = buildGroupedFindingsExport(rows, {
            runId: 'run-456',
            excludedStatuses: new Set([404]),
        });

        expect(report.summary.totalFindingRows).toBe(2);
        expect(report.summary.infrastructureGroups).toBe(1);
        expect(report.infrastructureErrors[0].title).toContain('500');
        expect(report.infrastructureErrors[0].totalMatches).toBe(2);
        expect(report.infrastructureErrors[0].targets[0].examples).toHaveLength(1);
    });

    it('formats a readable Markdown report with group titles, target counts, and examples', () => {
        const rows: ResultSummary[] = [
            makeRow({
                id: 'sec-1',
                analyzerFindings: [
                    {
                        ruleId: 'sqli-error',
                        level: 'error',
                        message: 'SQL syntax error reflected',
                    },
                ],
                responsePreview: 'SQLSTATE[42000]: syntax error',
            }),
        ];

        const report = buildGroupedFindingsExport(rows, {
            runId: 'run-md',
            baseUrl: 'https://api.example.com',
            maxExamplesPerFinding: 2,
        });
        const md = formatGroupedFindingsMarkdown(report);

        expect(md).toContain('# Swazz Grouped Findings Report');
        expect(md).toContain('**Run ID:** run-md');
        expect(md).toContain('**Base URL:** https://api.example.com');
        expect(md).toContain('## Security Vulnerabilities');
        expect(md).toContain('POST /api/render');
        expect(md).toContain('SQL syntax error reflected');
        expect(md).toContain('SQLSTATE[42000]: syntax error');
    });
});
