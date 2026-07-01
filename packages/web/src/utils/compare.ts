import type { ResultSummary } from '../hooks/useRunner.js';

export interface ComparisonResult {
    newFindings: ResultSummary[];
    fixedFindings: ResultSummary[];
    commonFindings: ResultSummary[];
}

export function compareScans(runA: ResultSummary[], runB: ResultSummary[]): ComparisonResult {
    if (!Array.isArray(runA) || !Array.isArray(runB)) {
        throw new TypeError('compareScans expects two arrays of ResultSummary');
    }

    const getFindingKey = (r: ResultSummary, ruleId: string) => {
        return `${ruleId}|${r.method.toUpperCase()}|${r.endpoint}`;
    };

    const findingsA = new Map<string, ResultSummary>();
    const findingsB = new Map<string, ResultSummary>();

    for (const r of runA) {
        if (r.analyzerFindings) {
            for (const f of r.analyzerFindings) {
                findingsA.set(getFindingKey(r, f.ruleId), r);
            }
        }
    }

    for (const r of runB) {
        if (r.analyzerFindings) {
            for (const f of r.analyzerFindings) {
                findingsB.set(getFindingKey(r, f.ruleId), r);
            }
        }
    }

    const newFindings: ResultSummary[] = [];
    const fixedFindings: ResultSummary[] = [];
    const commonFindings: ResultSummary[] = [];

    const seenNew = new Set<string>();
    const seenCommon = new Set<string>();
    const seenFixed = new Set<string>();

    findingsB.forEach((res, key) => {
        if (!findingsA.has(key)) {
            if (!seenNew.has(res.id)) {
                seenNew.add(res.id);
                newFindings.push(res);
            }
        } else {
            if (!seenCommon.has(res.id)) {
                seenCommon.add(res.id);
                commonFindings.push(res);
            }
        }
    });

    findingsA.forEach((res, key) => {
        if (!findingsB.has(key)) {
            if (!seenFixed.has(res.id)) {
                seenFixed.add(res.id);
                fixedFindings.push(res);
            }
        }
    });

    return { newFindings, fixedFindings, commonFindings };
}
