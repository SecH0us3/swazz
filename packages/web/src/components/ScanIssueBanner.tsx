// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useAppStore } from '../store/appStore.js';
import { dismissScanIssue } from '../utils/scheduledFailures.js';
import { DOCS } from '../utils/docsLinks.js';
import { DocsLink } from './Shared/DocsLink.js';
import './ScanIssueBanner.css';

/**
 * Why the last scan failed, or what it warned about, with what to change: stays until dismissed
 * or a new scan starts, unlike a toast, so a failure cannot go unnoticed.
 */
export function ScanIssueBanner() {
    const issue = useAppStore(state => state.scanIssue);
    if (!issue) return null;

    const dismiss = () => {
        if (issue.scanId) dismissScanIssue(issue.scanId);
        useAppStore.setState({ scanIssue: null });
    };
    // An issue about a past (scheduled) scan points to History; one about the live scan to its log.
    const logsAction = issue.scanId
        ? { label: 'Open History', tab: 'history' as const }
        : { label: 'Open runner logs', tab: 'runner_logs' as const };

    return (
        <div className={`scan-issue-banner scan-issue-${issue.level}`} role={issue.level === 'error' ? 'alert' : 'status'}>
            <div className="scan-issue-icon" aria-hidden="true">{issue.level === 'error' ? '✕' : '!'}</div>
            <div className="scan-issue-body">
                <div className="scan-issue-title">{issue.title}</div>
                {issue.details.length > 0 && (
                    <ul className="scan-issue-details">
                        {issue.details.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                )}
                {issue.hint && <div className="scan-issue-hint">{issue.hint.text}</div>}
                <div className="scan-issue-actions">
                    {issue.hint?.action && (
                        <button className="btn btn-secondary btn-sm" onClick={() => useAppStore.setState({ activeTab: issue.hint!.action!.tab })}>
                            {issue.hint.action.label}
                        </button>
                    )}
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => useAppStore.setState({ activeTab: logsAction.tab, ...(logsAction.tab === 'runner_logs' ? { loadedRunId: null } : {}) })}
                    >
                        {logsAction.label}
                    </button>
                    <DocsLink href={DOCS.activeRunners} label="Runners & scans docs" />
                </div>
            </div>
            <button className="scan-issue-dismiss" aria-label="Dismiss" onClick={dismiss}>×</button>
        </div>
    );
}
