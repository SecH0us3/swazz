// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { ResultSummary } from '../hooks/useRunner.js';
import type { AnalysisFinding } from '../types.js';
import { extractErrorSubtype, getCleanDedupeKey } from './errors.js';
import { categorizeFinding } from './findings.js';

export interface FindingExample {
    id: string;
    timestamp: number;
    method: string;
    endpoint: string;
    resolvedPath: string;
    requestUri?: string;
    status: number;
    profile: string;
    duration: number;
    identity?: string;
    payloadSize: number;
    responseSize: number;
    requestHeaders?: Record<string, string>;
    payloadPreview: string;
    responseHeaders?: Record<string, string[]>;
    responsePreview: string;
    error?: string;
    triage?: 'false_positive' | 'ignored' | 'acknowledged' | 'none';
}

export interface GroupedFindingTarget {
    key: string;
    method: string;
    endpoint: string;
    ruleId?: string;
    message: string;
    severity?: string;
    status?: number;
    subtype?: string;
    count: number;
    identities: string[];
    owaspCategory?: string[];
    owaspApiCategory?: string[];
    cweIds?: string[];
    examples: FindingExample[];
}

export interface GroupedFindingCategory {
    id: string;
    section: 'security' | 'infrastructure';
    title: string;
    description: string;
    severityColor: string;
    totalMatches: number;
    uniqueTargets: number;
    targets: GroupedFindingTarget[];
}

export interface GroupedFindingsExport {
    schemaVersion: 1;
    format: 'swazz-grouped-findings';
    exportedAt: string;
    runId: string | null;
    baseUrl?: string;
    maxExamplesPerFinding: number;
    filters: {
        excludedStatuses: number[];
        search?: string;
        identityFilter?: string;
    };
    summary: {
        totalFindingRows: number;
        totalGroups: number;
        securityGroups: number;
        infrastructureGroups: number;
        uniqueTargets: number;
        exportedExamples: number;
    };
    securityVulnerabilities: GroupedFindingCategory[];
    infrastructureErrors: GroupedFindingCategory[];
}

export interface BuildGroupedFindingsOptions {
    runId: string | null;
    baseUrl?: string;
    maxExamplesPerFinding?: number;
    excludedStatuses?: Set<number>;
    search?: string;
    identityFilter?: string;
}

interface InternalTargetAccumulator {
    target: GroupedFindingTarget;
    identitySet: Set<string>;
    exampleSignatures: Set<string>;
}

interface InternalGroupAccumulator {
    id: string;
    section: 'security' | 'infrastructure';
    title: string;
    description: string;
    severityColor: string;
    targets: GroupedFindingTarget[];
    seenMap: Map<string, InternalTargetAccumulator>;
}

const COLOR_PRIORITY: Record<string, number> = {
    'var(--color-error)': 1,
    'var(--color-warning)': 2,
    'var(--color-info)': 3,
};

function toFindingExample(row: ResultSummary): FindingExample {
    return {
        id: row.id,
        timestamp: row.timestamp,
        method: row.method,
        endpoint: row.endpoint,
        resolvedPath: row.resolvedPath,
        ...(row.requestUri ? { requestUri: row.requestUri } : {}),
        status: row.status,
        profile: row.profile,
        duration: row.duration,
        ...(row.identity ? { identity: row.identity } : {}),
        payloadSize: row.payloadSize,
        responseSize: row.responseSize,
        ...(row.requestHeaders && Object.keys(row.requestHeaders).length > 0
            ? { requestHeaders: row.requestHeaders }
            : {}),
        payloadPreview: row.payloadPreview,
        ...(row.responseHeaders && Object.keys(row.responseHeaders).length > 0
            ? { responseHeaders: row.responseHeaders }
            : {}),
        responsePreview: row.responsePreview,
        ...(row.error ? { error: row.error } : {}),
        ...(row.triage && row.triage !== 'none' ? { triage: row.triage } : {}),
    };
}

function getExampleSignature(row: ResultSummary): string {
    return `${row.requestUri || row.resolvedPath}::${row.status}::${row.identity || ''}::${row.payloadPreview}`;
}

function recordTargetHit(
    group: InternalGroupAccumulator,
    dedupeKey: string,
    row: ResultSummary,
    maxExamples: number,
    meta: {
        ruleId?: string;
        message: string;
        severity?: string;
        status?: number;
        subtype?: string;
        finding?: AnalysisFinding;
    }
): void {
    let acc = group.seenMap.get(dedupeKey);
    if (!acc) {
        const target: GroupedFindingTarget = {
            key: dedupeKey,
            method: row.method,
            endpoint: row.endpoint,
            ...(meta.ruleId ? { ruleId: meta.ruleId } : {}),
            message: meta.message,
            ...(meta.severity ? { severity: meta.severity } : {}),
            ...(meta.status !== undefined ? { status: meta.status } : {}),
            ...(meta.subtype ? { subtype: meta.subtype } : {}),
            count: 0,
            identities: [],
            ...(row.owaspCategory && row.owaspCategory.length > 0 ? { owaspCategory: row.owaspCategory } : {}),
            ...(row.owaspApiCategory && row.owaspApiCategory.length > 0 ? { owaspApiCategory: row.owaspApiCategory } : {}),
            ...(row.cweIds && row.cweIds.length > 0 ? { cweIds: row.cweIds } : {}),
            examples: [],
        };
        acc = {
            target,
            identitySet: new Set<string>(),
            exampleSignatures: new Set<string>(),
        };
        group.seenMap.set(dedupeKey, acc);
        group.targets.push(target);
    }

    acc.target.count += 1;

    if (row.identity && !acc.identitySet.has(row.identity)) {
        acc.identitySet.add(row.identity);
        acc.target.identities.push(row.identity);
    }

    if (acc.target.examples.length < maxExamples) {
        const sig = getExampleSignature(row);
        if (!acc.exampleSignatures.has(sig)) {
            acc.exampleSignatures.add(sig);
            acc.target.examples.push(toFindingExample(row));
        }
    }
}

function finalizeGroups(groupsMap: Record<string, InternalGroupAccumulator>): GroupedFindingCategory[] {
    return Object.values(groupsMap)
        .map((g) => ({
            id: g.id,
            section: g.section,
            title: g.title,
            description: g.description,
            severityColor: g.severityColor,
            totalMatches: g.targets.reduce((sum, t) => sum + t.count, 0),
            uniqueTargets: g.targets.length,
            targets: g.targets,
        }))
        .sort((a, b) => {
            const pA = COLOR_PRIORITY[a.severityColor] ?? 99;
            const pB = COLOR_PRIORITY[b.severityColor] ?? 99;
            if (pA !== pB) return pA - pB;
            return a.title.localeCompare(b.title);
        });
}

/**
 * Groups raw finding rows into deduplicated security vulnerabilities and
 * infrastructure errors with at most 1-2 representative request/response examples per finding.
 */
export function buildGroupedFindingsExport(
    rows: ResultSummary[],
    options: BuildGroupedFindingsOptions
): GroupedFindingsExport {
    const rawMax = options.maxExamplesPerFinding ?? 2;
    const maxExamples = Math.min(2, Math.max(1, Math.floor(rawMax)));
    const excludedStatuses = options.excludedStatuses ?? new Set<number>();

    const filteredRows = rows.filter((row) => !excludedStatuses.has(row.status));

    const securityGroups: Record<string, InternalGroupAccumulator> = {};
    const infraGroups: Record<string, InternalGroupAccumulator> = {};

    for (const row of filteredRows) {
        let placed = false;

        if (row.analyzerFindings && row.analyzerFindings.length > 0) {
            for (const f of row.analyzerFindings) {
                const cat = categorizeFinding(f, row.responsePreview);
                if (!securityGroups[cat.key]) {
                    securityGroups[cat.key] = {
                        id: cat.key,
                        section: 'security',
                        title: cat.title,
                        description: '',
                        severityColor: cat.color,
                        targets: [],
                        seenMap: new Map(),
                    };
                }
                const dedupeKey = `${row.method} ${row.endpoint}::${f.ruleId}::${f.message}`;
                recordTargetHit(securityGroups[cat.key], dedupeKey, row, maxExamples, {
                    ruleId: f.ruleId,
                    message: f.message,
                    severity: f.level,
                    status: row.status,
                    finding: f,
                });
                placed = true;
            }
        }

        if (!placed) {
            const isMcpErr =
                row.method === 'CALL' ||
                row.method === 'MCP' ||
                Boolean(row.endpoint && row.endpoint.startsWith('mcp://tool/'));
            const isErrorStatus = row.status >= 400 || (row.status === 0 && Boolean(row.error)) || isMcpErr;
            if (isErrorStatus) {
                const displayStatus = isMcpErr ? (row.status === 200 ? 400 : row.status) : row.status;
                const subtype = extractErrorSubtype(row.responsePreview);
                const groupKey = subtype ? `${displayStatus}_${subtype.key}` : `status_${displayStatus}`;

                if (!infraGroups[groupKey]) {
                    const color =
                        displayStatus >= 500 || displayStatus === 0 ? 'var(--color-error)' : 'var(--color-warning)';
                    const title = isMcpErr
                        ? subtype
                            ? `MCP Tool Error: ${subtype.title}`
                            : 'MCP Tool Error'
                        : subtype
                            ? `HTTP ${displayStatus} — ${subtype.title}`
                            : displayStatus === 0
                                ? 'Network / Connection Error'
                                : `HTTP ${displayStatus} Errors`;

                    infraGroups[groupKey] = {
                        id: groupKey,
                        section: 'infrastructure',
                        title,
                        description: isMcpErr
                            ? 'MCP tool invocation returned an error.'
                            : displayStatus === 0
                                ? 'Request failed before receiving an HTTP response.'
                                : `Requests returning HTTP ${displayStatus}.`,
                        severityColor: color,
                        targets: [],
                        seenMap: new Map(),
                    };
                }

                const dedupeKey = getCleanDedupeKey(
                    row.method,
                    row.endpoint,
                    displayStatus,
                    row.error || row.responsePreview
                );
                recordTargetHit(infraGroups[groupKey], dedupeKey, row, maxExamples, {
                    message: row.error || subtype?.title || `HTTP ${displayStatus}`,
                    status: displayStatus,
                    ...(subtype ? { subtype: subtype.title } : {}),
                });
            }
        }
    }

    const securityVulnerabilities = finalizeGroups(securityGroups);
    const infrastructureErrors = finalizeGroups(infraGroups);

    const allGroups = [...securityVulnerabilities, ...infrastructureErrors];
    const uniqueTargets = allGroups.reduce((sum, g) => sum + g.uniqueTargets, 0);
    const exportedExamples = allGroups.reduce(
        (sum, g) => sum + g.targets.reduce((tSum, t) => tSum + t.examples.length, 0),
        0
    );

    return {
        schemaVersion: 1,
        format: 'swazz-grouped-findings',
        exportedAt: new Date().toISOString(),
        runId: options.runId,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        maxExamplesPerFinding: maxExamples,
        filters: {
            excludedStatuses: Array.from(excludedStatuses).sort((a, b) => a - b),
            ...(options.search ? { search: options.search } : {}),
            ...(options.identityFilter && options.identityFilter !== 'all'
                ? { identityFilter: options.identityFilter }
                : {}),
        },
        summary: {
            totalFindingRows: filteredRows.length,
            totalGroups: allGroups.length,
            securityGroups: securityVulnerabilities.length,
            infrastructureGroups: infrastructureErrors.length,
            uniqueTargets,
            exportedExamples,
        },
        securityVulnerabilities,
        infrastructureErrors,
    };
}

function formatCodeBlock(lang: string, text: string): string {
    const safeText = text.replace(/```/g, '` ` `');
    return `\`\`\`${lang}\n${safeText}\n\`\`\``;
}

function appendCategorySection(lines: string[], heading: string, categories: GroupedFindingCategory[]): void {
    lines.push(`## ${heading}`);
    lines.push('');

    if (categories.length === 0) {
        lines.push('_None._');
        lines.push('');
        return;
    }

    for (const cat of categories) {
        lines.push(`### ${cat.title} (${cat.uniqueTargets} targets, ${cat.totalMatches} hits)`);
        if (cat.description) {
            lines.push(`_${cat.description}_`);
        }
        lines.push('');

        for (const target of cat.targets) {
            const tags: string[] = [];
            if (target.ruleId) tags.push(`Rule: \`${target.ruleId}\``);
            if (target.severity) tags.push(`Severity: \`${target.severity}\``);
            if (target.status !== undefined) tags.push(`Status: \`${target.status}\``);
            if (target.identities.length > 0) tags.push(`Identities: ${target.identities.join(', ')}`);
            if (target.cweIds && target.cweIds.length > 0) tags.push(`CWE: ${target.cweIds.join(', ')}`);

            lines.push(`- **\`${target.method} ${target.endpoint}\`** — ${target.count} hits${tags.length ? ` (${tags.join(' | ')})` : ''}`);
            lines.push(`  - Message: ${target.message}`);

            target.examples.forEach((ex, idx) => {
                const targetUrl = ex.requestUri || ex.resolvedPath || ex.endpoint;
                lines.push(
                    `  - **Example ${idx + 1}/${target.examples.length}** — \`${ex.method} ${targetUrl}\` → HTTP ${ex.status} (${ex.duration}ms, profile: \`${ex.profile}\`${ex.identity ? `, identity: \`${ex.identity}\`` : ''})`
                );
                if (ex.requestHeaders && Object.keys(ex.requestHeaders).length > 0) {
                    lines.push('    - Request Headers:');
                    lines.push(formatCodeBlock('json', JSON.stringify(ex.requestHeaders, null, 2)));
                }
                if (ex.payloadPreview) {
                    lines.push('    - Request Body:');
                    lines.push(formatCodeBlock('text', ex.payloadPreview));
                }
                if (ex.error) {
                    lines.push(`    - Error: \`${ex.error}\``);
                }
                if (ex.responsePreview) {
                    lines.push('    - Response:');
                    lines.push(formatCodeBlock('text', ex.responsePreview));
                }
            });
            lines.push('');
        }
    }
}

/**
 * Formats a GroupedFindingsExport into a concise, readable Markdown report.
 */
export function formatGroupedFindingsMarkdown(report: GroupedFindingsExport): string {
    const lines: string[] = [
        '# Swazz Grouped Findings Report',
        '',
        `- **Run ID:** ${report.runId ?? 'N/A'}`,
        ...(report.baseUrl ? [`- **Base URL:** ${report.baseUrl}`] : []),
        `- **Exported At:** ${report.exportedAt}`,
        `- **Examples per Finding:** ${report.maxExamplesPerFinding}`,
        `- **Summary:** ${report.summary.totalGroups} groups (${report.summary.securityGroups} security, ${report.summary.infrastructureGroups} infrastructure), ${report.summary.uniqueTargets} unique targets, ${report.summary.totalFindingRows} total finding hits, ${report.summary.exportedExamples} exported examples`,
        '',
    ];

    appendCategorySection(lines, 'Security Vulnerabilities', report.securityVulnerabilities);
    appendCategorySection(lines, 'Infrastructure Errors', report.infrastructureErrors);

    return lines.join('\n');
}

/**
 * Triggers a browser download for a text payload.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
