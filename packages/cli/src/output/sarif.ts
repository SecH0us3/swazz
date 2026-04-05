/**
 * SARIF 2.1.0 output — compatible with DefectDojo, GitHub Security, SonarQube.
 */

import type { Finding } from '../types.js';

interface SarifRule {
    id: string;
    shortDescription: { text: string };
    defaultConfiguration: { level: string };
}

interface SarifResult {
    ruleId: string;
    level: string;
    message: { text: string };
    locations: any[];
    properties: Record<string, any>;
}

export function toSarif(findings: Finding[], toolVersion: string = '1.0.0'): any {
    // Collect unique rules
    const rulesMap = new Map<string, SarifRule>();

    for (const f of findings) {
        if (!rulesMap.has(f.ruleId)) {
            rulesMap.set(f.ruleId, {
                id: f.ruleId,
                shortDescription: { text: descriptionForRule(f.ruleId) },
                defaultConfiguration: { level: f.level },
            });
        }
    }

    const results: SarifResult[] = findings.map(f => ({
        ruleId: f.ruleId,
        level: f.level,
        message: {
            text: buildMessage(f),
        },
        locations: [{
            physicalLocation: {
                artifactLocation: {
                    uri: `${f.method} ${f.endpoint}`,
                },
            },
        }],
        properties: {
            profile: f.profile,
            status: f.status,
            duration: f.duration,
            resolvedPath: f.resolvedPath,
            payload: f.payload,
            ...(f.responseBody !== undefined ? { responseBody: f.responseBody } : {}),
            ...(f.error ? { error: f.error } : {}),
            timestamp: new Date(f.timestamp).toISOString(),
        },
    }));

    return {
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
        version: '2.1.0',
        runs: [{
            tool: {
                driver: {
                    name: 'swazz',
                    version: toolVersion,
                    informationUri: 'https://github.com/SecH0us3/swazz',
                    rules: [...rulesMap.values()],
                },
            },
            results,
        }],
    };
}

function descriptionForRule(ruleId: string): string {
    if (ruleId === 'swazz/timeout') return 'Request timed out during fuzzing';
    if (ruleId === 'swazz/network-error') return 'Network error during fuzzing';
    const match = ruleId.match(/swazz\/status-(\d+)/);
    if (match) {
        const code = Number(match[1]);
        if (code >= 500) return `Server error ${code} triggered by fuzz payload`;
        if (code >= 400) return `Client error ${code} triggered by fuzz payload`;
        if (code >= 200 && code < 300) return `Unexpected success ${code} with fuzz payload`;
        return `Unexpected status ${code} from fuzz payload`;
    }
    return 'Unexpected behavior detected by fuzzing';
}

function buildMessage(f: Finding): string {
    const parts = [
        `${f.status || 'TIMEOUT'}`,
        `on ${f.method} ${f.endpoint}`,
        `with ${f.profile} profile`,
    ];
    if (f.error) parts.push(`(${f.error})`);
    return parts.join(' ');
}
