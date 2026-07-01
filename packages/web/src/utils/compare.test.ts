import { describe, it, expect } from 'vitest';
import { compareScans } from './compare.js';
import type { ResultSummary } from '../hooks/useRunner.js';

describe('compareScans', () => {
    it('calculates diffs correctly', () => {
        const runA: Partial<ResultSummary>[] = [
            { id: '1', method: 'GET', endpoint: '/api/users', analyzerFindings: [{ ruleId: 'swazz/sql-error-leak', level: 'error', message: 'leak' }] }
        ];
        const runB: Partial<ResultSummary>[] = [
            { id: '2', method: 'GET', endpoint: '/api/users', analyzerFindings: [{ ruleId: 'swazz/sql-error-leak', level: 'error', message: 'leak' }] },
            { id: '3', method: 'POST', endpoint: '/api/users', analyzerFindings: [{ ruleId: 'swazz/reflected-xss', level: 'error', message: 'xss' }] }
        ];

        const diff = compareScans(runA as ResultSummary[], runB as ResultSummary[]);
        expect(diff.newFindings.length).toBe(1);
        expect(diff.newFindings[0].endpoint).toBe('/api/users');
        expect(diff.newFindings[0].method).toBe('POST');
        expect(diff.fixedFindings.length).toBe(0);
        expect(diff.commonFindings.length).toBe(1);
    });

    it('handles empty runs', () => {
        const diff = compareScans([], []);
        expect(diff.newFindings).toEqual([]);
        expect(diff.fixedFindings).toEqual([]);
        expect(diff.commonFindings).toEqual([]);
    });

    it('handles fixed findings when runB has none of A\'s findings', () => {
        const runA: Partial<ResultSummary>[] = [
            { id: '1', method: 'GET', endpoint: '/api/users', analyzerFindings: [{ ruleId: 'swazz/sql-error-leak', level: 'error', message: 'leak' }] }
        ];
        const runB: Partial<ResultSummary>[] = [];

        const diff = compareScans(runA as ResultSummary[], runB as ResultSummary[]);
        expect(diff.newFindings.length).toBe(0);
        expect(diff.fixedFindings.length).toBe(1);
        expect(diff.fixedFindings[0].endpoint).toBe('/api/users');
        expect(diff.commonFindings.length).toBe(0);
    });

    it('handles multiple analyzer findings in single ResultSummary', () => {
        const runA: Partial<ResultSummary>[] = [
            {
                id: '1',
                method: 'GET',
                endpoint: '/api/users',
                analyzerFindings: [
                    { ruleId: 'swazz/sql-error-leak', level: 'error', message: 'leak' },
                    { ruleId: 'swazz/reflected-xss', level: 'error', message: 'xss' }
                ]
            }
        ];
        const runB: Partial<ResultSummary>[] = [
            {
                id: '2',
                method: 'GET',
                endpoint: '/api/users',
                analyzerFindings: [
                    { ruleId: 'swazz/sql-error-leak', level: 'error', message: 'leak' }
                ]
            }
        ];

        const diff = compareScans(runA as ResultSummary[], runB as ResultSummary[]);
        // The xss finding from runA is not in runB, so it should be fixed.
        // The sql-leak finding is common to both.
        expect(diff.fixedFindings.length).toBe(1);
        expect(diff.fixedFindings[0].id).toBe('1');
        expect(diff.commonFindings.length).toBe(1);
        expect(diff.commonFindings[0].id).toBe('2');
        expect(diff.newFindings.length).toBe(0);
    });
});
