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

    const isMcpErr = (item.result.method === 'CALL' || item.result.method === 'MCP' || item.result.endpoint?.startsWith('mcp://tool/')) && 
                     item.result.responsePreview && 
                     (/"isError"\s*:\s*true/i.test(item.result.responsePreview.replace(/\\"/g, '"')));

    const displayStatus = isMcpErr ? (item.result.status === 200 ? 400 : item.result.status) : item.result.status;
    const badgeClass = isMcpErr ? (displayStatus >= 500 ? 'badge badge-error' : 'badge badge-warning') : getBadgeClass(item.result.status);

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
                <span className={badgeClass}>
                    {item.result.status === 0 ? <span title="Infinity (Timeout / Network Error)">∞</span> : (isMcpErr ? `-${displayStatus}` : item.result.status || 'ERR')}
                </span>
            </div>
            {item.finding?.message && (
                <div className="finding-item-message">
                    {item.finding.message}
                </div>
            )}
            {isMcpErr && !item.finding && (() => {
                let errMsg = '';
                try {
                    let parsed = JSON.parse(item.result.responsePreview);
                    while (typeof parsed === 'string') {
                        parsed = JSON.parse(parsed);
                    }
                    if (parsed && parsed.content && Array.isArray(parsed.content)) {
                        const txtContent = parsed.content.find((c: any) => c.type === 'text');
                        if (txtContent && txtContent.text) {
                            if (typeof txtContent.text === 'object') {
                                errMsg = txtContent.text.message || JSON.stringify(txtContent.text);
                            } else {
                                errMsg = txtContent.text;
                            }
                        }
                    }
                } catch {
                    errMsg = item.result.responsePreview || 'MCP tool invocation failed';
                }
                return (
                    <div className="finding-item-message">
                        <strong>MCP Error:</strong> {errMsg}
                    </div>
                );
            })()}
            {!isMcpErr && displayStatus >= 400 && !item.finding && (
                <div className="finding-item-message">
                    Server returned error status {displayStatus}
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
