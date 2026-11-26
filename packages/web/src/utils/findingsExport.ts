// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { ResultSummary } from '../hooks/useRunner.js';
import type { AnalysisFinding } from '../types.js';
import { getCleanDedupeKey } from './errors.js';
import { categorizeFinding, classifyInfrastructureError } from './findings.js';

export type TargetTriageStatus = 'false_positive' | 'ignored' | 'acknowledged';

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
    triage?: TargetTriageStatus;
}

export interface GroupedFindingTarget {
    key: string;
    method: string;
    endpoint: string;
    ruleId?: string;
    message: string;
    severity?: string;
    evidence?: string;
    status?: number;
    subtype?: string;
    triage?: TargetTriageStatus;
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
    description?: string;
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
        truncated?: boolean;
        totalAvailableRows?: number;
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
    totalAvailableRows?: number;
}

interface InternalTargetAccumulator {
    target: GroupedFindingTarget;
    identitySet: Set<string>;
}

interface InternalGroupAccumulator {
    id: string;
    section: 'security' | 'infrastructure';
    title: string;
    description?: string;
    severityColor: string;
    targets: GroupedFindingTarget[];
    seenMap: Map<string, InternalTargetAccumulator>;
}

const COLOR_PRIORITY: Record<string, number> = {
    'var(--color-error)': 1,
    'var(--color-warning)': 2,
    'var(--color-info)': 3,
};

const SENSITIVE_HEADER_EXACT =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token)$/i;
const SENSITIVE_HEADER_PATTERN = /^x-.*(token|key|secret|auth)$/i;

function isSensitiveHeader(name: string): boolean {
    const trimmed = name.trim();
    return SENSITIVE_HEADER_EXACT.test(trimmed) || SENSITIVE_HEADER_PATTERN.test(trimmed);
}

function redactRequestHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        out[k] = isSensitiveHeader(k) ? '[REDACTED]' : v;
    }
    return out;
}

function redactResponseHeaders(headers: Record<string, string[]>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(headers)) {
        out[k] = isSensitiveHeader(k) ? ['[REDACTED]'] : [...v];
    }
    return out;
}

function mergeUniqueStrings(primary?: string[], secondary?: string[]): string[] | undefined {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const list of [primary, secondary]) {
        if (!list) continue;
        for (const item of list) {
            if (item && !seen.has(item)) {
                seen.add(item);
                merged.push(item);
            }
        }
    }
    return merged.length > 0 ? merged : undefined;
}

function toFindingExample(row: ResultSummary): FindingExample {
    const triage = row.triage && row.triage !== 'none' ? row.triage : undefined;
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
            ? { requestHeaders: redactRequestHeaders(row.requestHeaders) }
            : {}),
        payloadPreview: row.payloadPreview,
        ...(row.responseHeaders && Object.keys(row.responseHeaders).length > 0
            ? { responseHeaders: redactResponseHeaders(row.responseHeaders) }
            : {}),
        responsePreview: row.responsePreview,
        ...(row.error ? { error: row.error } : {}),
        ...(triage ? { triage } : {}),
    };
}

function isSameExample(ex: FindingExample, row: ResultSummary): boolean {
    return (
        (ex.requestUri || ex.resolvedPath) === (row.requestUri || row.resolvedPath) &&
        ex.status === row.status &&
        (ex.identity || '') === (row.identity || '') &&
        ex.payloadPreview === row.payloadPreview
    );
}

interface TargetMeta {
    ruleId?: string;
    message: string;
    severity?: string;
    status?: number;
    subtype?: string;
    finding?: AnalysisFinding;
}

function recordTargetHit(
    group: InternalGroupAccumulator,
    dedupeKey: string,
    row: ResultSummary,
    maxExamples: number,
    createMeta: () => TargetMeta
): void {
    let acc = group.seenMap.get(dedupeKey);
    if (!acc) {
        const meta = createMeta();
        const owaspCategory = mergeUniqueStrings(meta.finding?.owaspCategory, row.owaspCategory);
        const owaspApiCategory = mergeUniqueStrings(meta.finding?.owaspApiCategory, row.owaspApiCategory);
        const cweIds = mergeUniqueStrings(meta.finding?.cweIds, row.cweIds);

        const target: GroupedFindingTarget = {
            key: dedupeKey,
            method: row.method,
            endpoint: row.endpoint,
            ...(meta.ruleId ? { ruleId: meta.ruleId } : {}),
            message: meta.message,
            ...(meta.severity ? { severity: meta.severity } : {}),
            ...(meta.finding?.evidence ? { evidence: meta.finding.evidence } : {}),
            ...(meta.status !== undefined ? { status: meta.status } : {}),
            ...(meta.subtype ? { subtype: meta.subtype } : {}),
            count: 0,
            identities: [],
            ...(owaspCategory ? { owaspCategory } : {}),
            ...(owaspApiCategory ? { owaspApiCategory } : {}),
            ...(cweIds ? { cweIds } : {}),
            examples: [],
        };
        acc = {
            target,
            identitySet: new Set<string>(),
        };
        group.seenMap.set(dedupeKey, acc);
        group.targets.push(target);
    }

    acc.target.count += 1;

    if (row.triage && row.triage !== 'none' && !acc.target.triage) {
        acc.target.triage = row.triage;
    }

    if (row.identity && !acc.identitySet.has(row.identity)) {
        acc.identitySet.add(row.identity);
        acc.target.identities.push(row.identity);
    }

    if (acc.target.examples.length < maxExamples) {
        if (!acc.target.examples.some((ex) => isSameExample(ex, row))) {
            acc.target.examples.push(toFindingExample(row));
        }
    }
}

function finalizeGroups(groupsMap: Map<string, InternalGroupAccumulator>): GroupedFindingCategory[] {
    return Array.from(groupsMap.values())
        .map((g) => ({
            id: g.id,
            section: g.section,
            title: g.title,
            ...(g.description ? { description: g.description } : {}),
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
    const hasExcluded = excludedStatuses.size > 0;

    const securityGroups = new Map<string, InternalGroupAccumulator>();
    const infraGroups = new Map<string, InternalGroupAccumulator>();
    let matchedRowCount = 0;

    for (const row of rows) {
        if (hasExcluded && excludedStatuses.has(row.status)) continue;
        let placed = false;

        if (row.analyzerFindings && row.analyzerFindings.length > 0) {
            for (const f of row.analyzerFindings) {
                const cat = categorizeFinding(f, row.responsePreview);
                let group = securityGroups.get(cat.key);
                if (!group) {
                    group = {
                        id: cat.key,
                        section: 'security',
                        title: cat.title,
                        severityColor: cat.color,
                        targets: [],
                        seenMap: new Map(),
                    };
                    securityGroups.set(cat.key, group);
                }
                const dedupeKey = `${row.method} ${row.endpoint}::${f.ruleId}::${f.message}`;
                recordTargetHit(group, dedupeKey, row, maxExamples, () => ({
                    ruleId: f.ruleId,
                    message: f.message,
                    severity: f.level,
                    status: row.status,
                    finding: f,
                }));
                placed = true;
            }
        }

        if (!placed) {
            const classified = classifyInfrastructureError(row);
            if (classified) {
                let group = infraGroups.get(classified.groupKey);
                if (!group) {
                    group = {
                        id: classified.groupKey,
                        section: 'infrastructure',
                        title: classified.title,
                        description:
                            classified.displayStatus === 0
                                ? 'Request failed before receiving an HTTP response.'
                                : classified.groupKey.startsWith('mcp_')
                                    ? 'MCP tool invocation returned an error.'
                                    : `Requests returning HTTP ${classified.displayStatus}.`,
                        severityColor: classified.color,
                        targets: [],
                        seenMap: new Map(),
                    };
                    infraGroups.set(classified.groupKey, group);
                }

                const dedupeKey = getCleanDedupeKey(
                    row.method,
                    row.endpoint,
                    classified.displayStatus,
                    row.error || row.responsePreview
                );
                recordTargetHit(group, dedupeKey, row, maxExamples, () => ({
                    message: row.error || classified.subtypeTitle || `HTTP ${classified.displayStatus}`,
                    status: classified.displayStatus,
                    ...(classified.subtypeTitle ? { subtype: classified.subtypeTitle } : {}),
                }));
                placed = true;
            }
        }

        if (placed) {
            matchedRowCount += 1;
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
    const isTruncated =
        options.totalAvailableRows !== undefined && options.totalAvailableRows > rows.length;

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
            totalFindingRows: matchedRowCount,
            totalGroups: allGroups.length,
            securityGroups: securityVulnerabilities.length,
            infrastructureGroups: infrastructureErrors.length,
            uniqueTargets,
            exportedExamples,
            ...(isTruncated
                ? {
                    truncated: true,
                    totalAvailableRows: options.totalAvailableRows,
                }
                : {}),
        },
        securityVulnerabilities,
        infrastructureErrors,
    };
}

function sanitizeInline(text: string): string {
    return text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function formatInlineCode(text: string): string {
    const clean = sanitizeInline(text);
    const matches = clean.match(/`+/g);
    const maxRun = matches ? Math.max(...matches.map((m) => m.length)) : 0;
    const fence = '`'.repeat(maxRun + 1);
    if (clean.startsWith('`') || clean.endsWith('`')) {
        return `${fence} ${clean} ${fence}`;
    }
    return `${fence}${clean}${fence}`;
}

function formatCodeBlock(lang: string, text: string, indent = ''): string {
    const matches = text.match(/`{3,}/g);
    const maxRun = matches ? Math.max(...matches.map((m) => m.length)) : 2;
    const fence = '`'.repeat(Math.max(3, maxRun + 1));
    const lines = [`${fence}${lang}`, ...text.split(/\r?\n/), fence];
    return lines.map((line) => `${indent}${line}`).join('\n');
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
        lines.push(`### ${sanitizeInline(cat.title)} (${cat.uniqueTargets} targets, ${cat.totalMatches} hits)`);
        if (cat.description) {
            lines.push(`_${sanitizeInline(cat.description)}_`);
        }
        lines.push('');

        for (const target of cat.targets) {
            const tags: string[] = [];
            if (target.ruleId) tags.push(`Rule: ${formatInlineCode(target.ruleId)}`);
            if (target.severity) tags.push(`Severity: ${formatInlineCode(target.severity)}`);
            if (target.status !== undefined) tags.push(`Status: ${formatInlineCode(String(target.status))}`);
            if (target.triage) tags.push(`Triage: ${formatInlineCode(target.triage)}`);
            if (target.identities.length > 0) tags.push(`Identities: ${target.identities.map(sanitizeInline).join(', ')}`);
            if (target.cweIds && target.cweIds.length > 0) tags.push(`CWE: ${target.cweIds.map(sanitizeInline).join(', ')}`);

            lines.push(
                `- **${formatInlineCode(`${target.method} ${target.endpoint}`)}** — ${target.count} hits${tags.length ? ` (${tags.join(' | ')})` : ''}`
            );
            lines.push(`  - Message: ${sanitizeInline(target.message)}`);
            if (target.evidence) {
                lines.push(`  - Evidence: ${formatInlineCode(target.evidence)}`);
            }

            target.examples.forEach((ex, idx) => {
                const targetUrl = ex.requestUri || ex.resolvedPath || ex.endpoint;
                lines.push(
                    `  - **Example ${idx + 1}/${target.examples.length}** — ${formatInlineCode(`${ex.method} ${targetUrl}`)} → HTTP ${ex.status} (${ex.duration}ms, profile: ${formatInlineCode(ex.profile)}${ex.identity ? `, identity: ${formatInlineCode(ex.identity)}` : ''})`
                );
                if (ex.requestHeaders && Object.keys(ex.requestHeaders).length > 0) {
                    lines.push('    - Request Headers:');
                    lines.push(formatCodeBlock('json', JSON.stringify(ex.requestHeaders, null, 2), '      '));
                }
                if (ex.payloadPreview) {
                    lines.push('    - Request Body:');
                    lines.push(formatCodeBlock('text', ex.payloadPreview, '      '));
                }
                if (ex.error) {
                    lines.push(`    - Error: ${formatInlineCode(ex.error)}`);
                }
                if (ex.responsePreview) {
                    lines.push('    - Response:');
                    lines.push(formatCodeBlock('text', ex.responsePreview, '      '));
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
    const truncationNote = report.summary.truncated
        ? ` _(truncated to loaded UI rows out of ${report.summary.totalAvailableRows?.toLocaleString() ?? 'unknown'} total)_`
        : '';

    const lines: string[] = [
        '# Swazz Grouped Findings Report',
        '',
        `- **Run ID:** ${report.runId ?? 'N/A'}`,
        ...(report.baseUrl ? [`- **Base URL:** ${report.baseUrl}`] : []),
        `- **Exported At:** ${report.exportedAt}`,
        `- **Examples per Finding:** ${report.maxExamplesPerFinding}`,
        `- **Summary:** ${report.summary.totalGroups} groups (${report.summary.securityGroups} security, ${report.summary.infrastructureGroups} infrastructure), ${report.summary.uniqueTargets} unique targets, ${report.summary.totalFindingRows} total finding hits, ${report.summary.exportedExamples} exported examples${truncationNote}`,
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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
