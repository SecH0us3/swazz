import React from 'react';
import type { ResultSummary } from '../../hooks/useRunner.js';
import type { AnalysisFinding } from '../../types.js';
import { getBadgeClass } from './utils.js';

interface FindingItemProps {
    item: { result: ResultSummary; finding?: AnalysisFinding };
    groupColor: string;
    onSelect: (row: ResultSummary) => void;
}

export const FindingItem: React.FC<FindingItemProps> = React.memo(({ item, groupColor, onSelect }) => {
    const triageBadge = (() => {
        if (!item.result.triage || item.result.triage === 'none') return null;
        const labels: Record<string, string> = {
            false_positive: 'FP',
            ignored: 'Ignored',
            acknowledged: 'Ack'
        };
        const classes: Record<string, string> = {
            false_positive: 'badge badge-warning',
            ignored: 'badge',
            acknowledged: 'badge badge-success'
        };
        return (
            <span className={classes[item.result.triage]} style={{ marginLeft: 'var(--space-2)' }}>
                {labels[item.result.triage]}
            </span>
        );
    })();

    const isIgnoredOrFp = item.result.triage === 'ignored' || item.result.triage === 'false_positive';

    return (
        <div 
            className="finding-item" 
            onClick={() => onSelect(item.result)}
            style={{ 
                borderLeft: `3px solid ${groupColor}`,
                opacity: isIgnoredOrFp ? 0.6 : 1
            }}
        >
            <div className="finding-item-row">
                <div className="finding-item-endpoint">
                    <span className={`method method-${item.result.method.toLowerCase()}`}>{item.result.method}</span>
                    <span className="finding-item-path">{item.result.endpoint}</span>
                    {triageBadge}
                </div>
                <span className={getBadgeClass(item.result.status)}>
                    {item.result.status === 0 ? <span title="Infinity (Timeout / Network Error)">∞</span> : (item.result.status || 'ERR')}
                </span>
            </div>
            {item.finding?.message && (
                <div className="finding-item-message">
                    {item.finding.message}
                </div>
            )}
            {item.result.status >= 500 && !item.finding && (
                <div className="finding-item-message">
                    Server returned unhandled error status {item.result.status}
                </div>
            )}
            {item.finding?.evidence && (
                <div className="finding-item-evidence" title={item.finding.evidence}>
                    <strong>Evidence:</strong> {item.finding.evidence}
                </div>
            )}
        </div>
    );
});
