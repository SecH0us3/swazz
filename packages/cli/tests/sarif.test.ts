import { describe, it, expect } from 'vitest';
import { toSarif } from '../src/output/sarif.js';
import type { Finding } from '../src/types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
        id: 'f-1',
        ruleId: 'swazz/status-500',
        level: 'error',
        endpoint: '/api/users',
        resolvedPath: '/api/users',
        method: 'POST',
        profile: 'MALICIOUS',
        status: 500,
        duration: 150,
        payload: { name: "' OR 1=1 --" },
        responseBody: 'Internal Server Error',
        timestamp: 1700000000000,
        ...overrides,
    };
}

describe('SARIF output', () => {
    describe('structure', () => {
        it('produces valid SARIF 2.1.0 structure', () => {
            const sarif = toSarif([makeFinding()]);

            expect(sarif.version).toBe('2.1.0');
            expect(sarif.$schema).toContain('sarif-schema-2.1.0');
            expect(sarif.runs).toHaveLength(1);
            expect(sarif.runs[0].tool.driver.name).toBe('swazz');
        });

        it('includes tool version', () => {
            const sarif = toSarif([makeFinding()], '2.3.0');
            expect(sarif.runs[0].tool.driver.version).toBe('2.3.0');
        });

        it('includes informationUri', () => {
            const sarif = toSarif([makeFinding()]);
            expect(sarif.runs[0].tool.driver.informationUri).toBeDefined();
        });
    });

    describe('rules deduplication', () => {
        it('deduplicates rules from multiple findings with same ruleId', () => {
            const findings = [
                makeFinding({ ruleId: 'swazz/status-500', level: 'error' }),
                makeFinding({ ruleId: 'swazz/status-500', level: 'error', id: 'f-2' }),
                makeFinding({ ruleId: 'swazz/status-200', level: 'warning', status: 200, id: 'f-3' }),
            ];

            const sarif = toSarif(findings);
            const rules = sarif.runs[0].tool.driver.rules;

            expect(rules).toHaveLength(2);
            expect(rules.map((r: any) => r.id).sort()).toEqual(['swazz/status-200', 'swazz/status-500']);
        });

        it('creates one rule per unique ruleId', () => {
            const findings = [
                makeFinding({ ruleId: 'swazz/timeout', id: 'f-1' }),
                makeFinding({ ruleId: 'swazz/network-error', id: 'f-2' }),
                makeFinding({ ruleId: 'swazz/status-500', id: 'f-3' }),
                makeFinding({ ruleId: 'swazz/status-502', id: 'f-4' }),
                makeFinding({ ruleId: 'swazz/status-200', id: 'f-5' }),
            ];

            const sarif = toSarif(findings);
            expect(sarif.runs[0].tool.driver.rules).toHaveLength(5);
        });
    });

    describe('results mapping', () => {
        it('maps findings to results correctly', () => {
            const sarif = toSarif([makeFinding()]);
            const result = sarif.runs[0].results[0];

            expect(result.ruleId).toBe('swazz/status-500');
            expect(result.level).toBe('error');
            expect(result.message.text).toContain('500');
            expect(result.message.text).toContain('POST /api/users');
            expect(result.message.text).toContain('MALICIOUS');
            expect(result.properties.profile).toBe('MALICIOUS');
            expect(result.properties.status).toBe(500);
            expect(result.properties.payload).toEqual({ name: "' OR 1=1 --" });
            expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('POST /api/users');
        });

        it('includes timeout findings with error in properties', () => {
            const sarif = toSarif([makeFinding({
                ruleId: 'swazz/timeout',
                status: 0,
                error: 'Request timed out after 10000ms',
            })]);

            const result = sarif.runs[0].results[0];
            expect(result.ruleId).toBe('swazz/timeout');
            expect(result.properties.error).toContain('timed out');
        });

        it('includes resolvedPath in properties', () => {
            const sarif = toSarif([makeFinding({
                endpoint: '/api/items/{id}',
                resolvedPath: '/api/items/abc123',
            })]);

            const result = sarif.runs[0].results[0];
            expect(result.properties.resolvedPath).toBe('/api/items/abc123');
        });

        it('includes timestamp as ISO string', () => {
            const sarif = toSarif([makeFinding({ timestamp: 1700000000000 })]);
            const result = sarif.runs[0].results[0];
            expect(result.properties.timestamp).toBe(new Date(1700000000000).toISOString());
        });

        it('omits responseBody from properties when undefined', () => {
            const sarif = toSarif([makeFinding({ responseBody: undefined })]);
            const result = sarif.runs[0].results[0];
            expect(result.properties).not.toHaveProperty('responseBody');
        });

        it('omits error from properties when not present', () => {
            const sarif = toSarif([makeFinding({ error: undefined })]);
            const result = sarif.runs[0].results[0];
            expect(result.properties).not.toHaveProperty('error');
        });
    });

    describe('edge cases', () => {
        it('handles empty findings array', () => {
            const sarif = toSarif([]);

            expect(sarif.runs[0].results).toHaveLength(0);
            expect(sarif.runs[0].tool.driver.rules).toHaveLength(0);
        });

        it('handles findings with special characters in payload', () => {
            const sarif = toSarif([makeFinding({
                payload: { sql: "'; DROP TABLE users; --", xss: '<script>alert(1)</script>' },
            })]);

            const result = sarif.runs[0].results[0];
            expect(result.properties.payload.sql).toBe("'; DROP TABLE users; --");
            expect(result.properties.payload.xss).toBe('<script>alert(1)</script>');
        });

        it('handles findings with unicode payload', () => {
            const sarif = toSarif([makeFinding({
                payload: { name: '\u0000\uFFFF\uD800' },
            })]);

            const output = JSON.stringify(toSarif([makeFinding({ payload: { emoji: '🔥💀' } })]));
            expect(output).toContain('🔥💀');
        });

        it('handles large number of findings', () => {
            const statuses = [500, 501, 502, 503, 504, 200, 400, 408, 0, 418];
            const findings = Array.from({ length: 1000 }, (_, i) => {
                const status = statuses[i % statuses.length];
                return makeFinding({
                    id: `f-${i}`,
                    status,
                    ruleId: status === 0 ? 'swazz/timeout' : `swazz/status-${status}`,
                });
            });
            const sarif = toSarif(findings);
            expect(sarif.runs[0].results).toHaveLength(1000);
            // Rules should be deduplicated (only 10 unique ruleIds)
            expect(sarif.runs[0].tool.driver.rules).toHaveLength(10);
        });

        it('message text for status 0 shows TIMEOUT', () => {
            const sarif = toSarif([makeFinding({ status: 0, error: 'timed out' })]);
            const msg = sarif.runs[0].results[0].message.text;
            expect(msg).toContain('TIMEOUT');
            expect(msg).not.toContain(' 0 ');
        });

        it('SARIF output is valid JSON (serializable)', () => {
            const sarif = toSarif([
                makeFinding(),
                makeFinding({ id: 'f-2', ruleId: 'swazz/timeout', status: 0, error: 'timeout' }),
            ]);
            const json = JSON.stringify(sarif);
            const parsed = JSON.parse(json);
            expect(parsed.version).toBe('2.1.0');
            expect(parsed.runs[0].results).toHaveLength(2);
        });

        it('rule shortDescription varies by status type', () => {
            const findings = [
                makeFinding({ ruleId: 'swazz/status-500', status: 500, id: 'f1' }),
                makeFinding({ ruleId: 'swazz/status-200', status: 200, id: 'f2', level: 'warning' }),
                makeFinding({ ruleId: 'swazz/status-400', status: 400, id: 'f3' }),
                makeFinding({ ruleId: 'swazz/timeout', status: 0, id: 'f4' }),
                makeFinding({ ruleId: 'swazz/network-error', status: 0, id: 'f5' }),
            ];
            const sarif = toSarif(findings);
            const rules = sarif.runs[0].tool.driver.rules;
            const descriptions = rules.map((r: any) => r.shortDescription.text);

            // Each rule type should have a distinct description
            expect(new Set(descriptions).size).toBe(5);
        });
    });
});
