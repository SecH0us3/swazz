// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, expect, it } from 'vitest';
import type { ResultSummary } from '../hooks/useRunner.js';
import { categorizeFinding, classifyInfrastructureError } from './findings.js';
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
        expect(report2.securityVulnerabilities[0].description).toBeUndefined();

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

    it('matches Inspector UI grouping for status 0, MCP errors, and HTTP errors while respecting excludedStatuses', () => {
        const rows: ResultSummary[] = [
            makeRow({
                id: 'ok-200',
                method: 'GET',
                endpoint: '/api/health',
                status: 200,
                responsePreview: 'ok',
            }),
            makeRow({
                id: 'net-0',
                method: 'GET',
                endpoint: '/api/slow',
                status: 0,
                error: 'dial tcp timeout',
                responsePreview: '{"error":"should not split status 0"}',
            }),
            makeRow({
                id: 'mcp-1',
                method: 'CALL',
                endpoint: 'mcp://tool/search',
                status: 200,
                responsePreview: 'MCP error -32602: Invalid params',
            }),
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
            totalAvailableRows: 120000,
        });

        expect(report.summary.totalFindingRows).toBe(4);
        expect(report.summary.truncated).toBe(true);
        expect(report.summary.totalAvailableRows).toBe(120000);
        expect(report.summary.infrastructureGroups).toBe(3);

        const netGroup = report.infrastructureErrors.find((g) => g.id === 'status_0');
        expect(netGroup?.title).toBe('Network Timeout / Error');

        const http500Group = report.infrastructureErrors.find((g) => g.id === 'status_500');
        expect(http500Group?.title).toBe('HTTP 500 Error');
        expect(http500Group?.totalMatches).toBe(2);
        expect(http500Group?.targets[0].examples).toHaveLength(1);

        const mcpGroup = report.infrastructureErrors.find((g) => g.id.startsWith('mcp_'));
        expect(mcpGroup).toBeDefined();
    });

    it('extracts OWASP/CWE/evidence from AnalysisFinding, propagates cluster triage, and redacts sensitive headers', () => {
        const inputHeaders = {
            Authorization: 'Bearer secret-jwt',
            Cookie: 'session=abc',
            'X-API-Key': 'key-123',
            'Content-Type': 'application/json',
        };
        const rows: ResultSummary[] = [
            makeRow({
                id: 'hit-1',
                requestHeaders: inputHeaders,
                responseHeaders: {
                    'Set-Cookie': ['sid=xyz; HttpOnly'],
                    'Content-Type': ['application/json'],
                },
                analyzerFindings: [
                    {
                        ruleId: 'swazz/sql-error-leak',
                        level: 'error',
                        message: 'SQL syntax error (PostgreSQL)',
                        evidence: 'ERROR: syntax error at or near "OR"',
                        owaspCategory: ['A03:2021-Injection'],
                        cweIds: ['CWE-89'],
                    },
                ],
            }),
            makeRow({
                id: 'hit-2',
                payloadPreview: '{"tpl":"other"}',
                analyzerFindings: [
                    {
                        ruleId: 'swazz/sql-error-leak',
                        level: 'error',
                        message: 'SQL syntax error (PostgreSQL)',
                    },
                ],
            }),
            makeRow({
                id: 'hit-3',
                triage: 'false_positive',
                analyzerFindings: [
                    {
                        ruleId: 'swazz/sql-error-leak',
                        level: 'error',
                        message: 'SQL syntax error (PostgreSQL)',
                    },
                ],
            }),
        ];

        const report = buildGroupedFindingsExport(rows, {
            runId: 'run-meta',
            maxExamplesPerFinding: 2,
        });

        const target = report.securityVulnerabilities[0].targets[0];
        expect(target.triage).toBe('false_positive');
        expect(target.evidence).toBe('ERROR: syntax error at or near "OR"');
        expect(target.owaspCategory).toEqual(['A03:2021-Injection']);
        expect(target.cweIds).toEqual(['CWE-89']);

        const ex0 = target.examples[0];
        expect(ex0.requestHeaders).toEqual({
            Authorization: '[REDACTED]',
            Cookie: '[REDACTED]',
            'X-API-Key': '[REDACTED]',
            'Content-Type': 'application/json',
        });
        expect(ex0.responseHeaders).toEqual({
            'Set-Cookie': ['[REDACTED]'],
            'Content-Type': ['application/json'],
        });
        // Original input headers must remain untouched
        expect(inputHeaders.Authorization).toBe('Bearer secret-jwt');
    });

    it('formats a valid CommonMark Markdown report with indented code blocks and escaped backticks', () => {
        const rows: ResultSummary[] = [
            makeRow({
                id: 'sec-1',
                payloadPreview: '```js\nalert(1)\n```',
                analyzerFindings: [
                    {
                        ruleId: 'sqli-error',
                        level: 'error',
                        message: 'SQL syntax error\non line 2',
                        evidence: 'near `SELECT`',
                    },
                ],
                responsePreview: 'SQLSTATE[42000]: syntax error',
            }),
        ];

        const report = buildGroupedFindingsExport(rows, {
            runId: 'run-md',
            baseUrl: 'https://api.example.com',
            maxExamplesPerFinding: 2,
            totalAvailableRows: 200000,
        });
        const md = formatGroupedFindingsMarkdown(report);

        expect(md).toContain('# Swazz Grouped Findings Report');
        expect(md).toContain('**Run ID:** run-md');
        expect(md).toContain('**Base URL:** https://api.example.com');
        expect(md).toContain('truncated to loaded UI rows');
        expect(md).toContain('## Security Vulnerabilities');
        expect(md).toContain('POST /api/render');
        expect(md).toContain('Message: SQL syntax error on line 2');
        expect(md).toContain('      ````text');
        expect(md).toContain('      ```js');
        expect(md).toContain('SQLSTATE[42000]: syntax error');
    });

    it('covers classifyInfrastructureError edge cases, clamping, filters, triage:none, and group sorting', () => {
        expect(
            classifyInfrastructureError({ method: 'GET', endpoint: '/ok', status: 0 })
        ).toBeNull();
        expect(
            classifyInfrastructureError({ method: 'MCP', endpoint: '/tool', status: 200 })?.displayStatus
        ).toBe(400);
        expect(
            classifyInfrastructureError({ method: 'CALL', endpoint: 'mcp://tool/x', status: 500 })?.displayStatus
        ).toBe(500);

        const subtypeCls = classifyInfrastructureError({
            method: 'GET',
            endpoint: '/err',
            status: 400,
            responsePreview: '{"error":"ValidationError: bad field"}',
        });
        expect(subtypeCls?.groupKey).toMatch(/^status_400_/);
        expect(subtypeCls?.title).toMatch(/^400 - /);

        const rows: ResultSummary[] = [
            makeRow({
                id: 'r1',
                triage: 'none',
                owaspApiCategory: ['API1:2023-BOLA', 'API3:2023'],
                requestHeaders: { 'X-Custom-Secret': 'top-secret', Accept: 'application/json' },
                analyzerFindings: [
                    {
                        ruleId: 'swazz/oob-interaction',
                        level: 'error',
                        message: 'SSRF',
                        owaspApiCategory: ['API7:2023-SSRF', 'API1:2023-BOLA'],
                        cweIds: ['CWE-918'],
                    },
                ],
            }),
            makeRow({
                id: 'r2',
                triage: 'acknowledged',
                payloadPreview: '{"tpl":"v2"}',
                analyzerFindings: [
                    {
                        ruleId: 'swazz/oob-interaction',
                        level: 'error',
                        message: 'SSRF',
                    },
                ],
            }),
            makeRow({
                id: 'r3',
                method: 'GET',
                endpoint: '/api/info',
                status: 200,
                analyzerFindings: [
                    {
                        ruleId: 'custom/info-rule',
                        level: 'note',
                        message: 'Alpha Info',
                    },
                ],
            }),
        ];

        const clampedLow = buildGroupedFindingsExport(rows, {
            runId: 'run-clamp',
            maxExamplesPerFinding: 0,
            search: 'api',
            identityFilter: 'all',
            totalAvailableRows: rows.length,
        });
        expect(clampedLow.maxExamplesPerFinding).toBe(1);
        expect(clampedLow.filters.search).toBe('api');
        expect(clampedLow.filters.identityFilter).toBeUndefined();
        expect(clampedLow.summary.truncated).toBeUndefined();

        const clampedHigh = buildGroupedFindingsExport(rows, {
            runId: 'run-clamp',
            maxExamplesPerFinding: 5,
            identityFilter: 'User A',
        });
        expect(clampedHigh.maxExamplesPerFinding).toBe(2);
        expect(clampedHigh.filters.identityFilter).toBe('User A');

        // Error group sorts before info group
        expect(clampedHigh.securityVulnerabilities[0].severityColor).toBe('var(--color-error)');
        expect(clampedHigh.securityVulnerabilities[1].severityColor).toBe('var(--color-info)');

        const ssrfTarget = clampedHigh.securityVulnerabilities[0].targets[0];
        expect(ssrfTarget.triage).toBe('acknowledged');
        expect(ssrfTarget.examples[0].triage).toBeUndefined();
        expect(ssrfTarget.examples[0].requestHeaders?.['X-Custom-Secret']).toBe('[REDACTED]');
        expect(ssrfTarget.owaspApiCategory).toEqual(['API7:2023-SSRF', 'API1:2023-BOLA', 'API3:2023']);
    });

    it('renders Markdown _None._ sections, header/error/triage blocks, and backtick-padded inline code', () => {
        const emptyReport = buildGroupedFindingsExport([], { runId: null });
        const emptyMd = formatGroupedFindingsMarkdown(emptyReport);
        expect(emptyMd).toContain('_None._');

        const rows: ResultSummary[] = [
            makeRow({
                id: 'md-1',
                identity: 'User A',
                triage: 'ignored',
                error: 'upstream reset',
                requestHeaders: { Authorization: 'Bearer abc', Host: 'example.com' },
                analyzerFindings: [
                    {
                        ruleId: 'custom/rule',
                        level: 'warning',
                        message: 'Edge case',
                        evidence: '`SELECT`',
                        cweIds: ['CWE-20'],
                    },
                ],
            }),
        ];
        const report = buildGroupedFindingsExport(rows, { runId: 'run-full-md' });
        const md = formatGroupedFindingsMarkdown(report);
        expect(md).toContain('Triage: `ignored`');
        expect(md).toContain('Identities: User A');
        expect(md).toContain('CWE: CWE-20');
        expect(md).toContain('Evidence: `` `SELECT` ``');
        expect(md).toContain('- Request Headers:');
        expect(md).toContain('"[REDACTED]"');
        expect(md).toContain('- Error: `upstream reset`');
    });

    it('categorizes file upload analyzer findings in web UI', () => {
        const uploadCat = categorizeFinding({
            ruleId: 'swazz/unvalidated-file-upload',
            level: 'error',
            message: 'Accepted mime_mismatch_png',
        });
        expect(uploadCat).toEqual({
            title: 'Unvalidated File Upload',
            color: 'var(--color-error)',
            key: 'unvalidated_file_upload',
        });

        const parserCat = categorizeFinding({
            ruleId: 'swazz/file-parser-error',
            level: 'error',
            message: 'PIL.UnidentifiedImageError',
        });
        expect(parserCat).toEqual({
            title: 'File Parser Crash / Error Disclosure',
            color: 'var(--color-error)',
            key: 'file_parser_error',
        });
    });
});
