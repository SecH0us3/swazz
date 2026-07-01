import type { ResultSummary } from '../hooks/useRunner.js';

export interface ComparisonResult {
    newFindings: ResultSummary[];
    fixedFindings: ResultSummary[];
    commonFindings: ResultSummary[];
}

export function compareScans(runA: ResultSummary[], runB: ResultSummary[]): ComparisonResult {
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

    findingsB.forEach((res, key) => {
        if (!findingsA.has(key)) {
            newFindings.push(res);
        } else {
            commonFindings.push(res);
        }
    });

    findingsA.forEach((res, key) => {
        if (!findingsB.has(key)) {
            fixedFindings.push(res);
        }
    });

    return { newFindings, fixedFindings, commonFindings };
}
