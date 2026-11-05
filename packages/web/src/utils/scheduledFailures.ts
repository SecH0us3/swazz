// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Scheduled scans run while nobody watches the dashboard, so their failures need saying when the
// user comes back: the latest one failed, or the last several in a row did.

import type { ScanIssue } from '../store/appStore.js';
import { hintForRunnerMessage } from './runnerErrorHints.js';
import { UNKNOWN_FAILURE } from '../services/runStream.js';

const DISMISSED_KEY = 'swazz_dismissed_scan_issues';
const MAX_DISMISSED = 50;
/** Failures older than this are history, not news. */
export const SCHEDULED_FAILURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function createdAt(scan: any): number {
    // D1 stores UTC as "YYYY-MM-DD HH:MM:SS".
    const t = Date.parse(typeof scan?.created_at === 'string' ? `${scan.created_at.replace(' ', 'T')}Z` : '');
    return Number.isNaN(t) ? 0 : t;
}

export function readDismissedScanIssues(): Set<string> {
    try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        const ids = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(ids) ? ids.filter((id: unknown) => typeof id === 'string') : []);
    } catch {
        return new Set();
    }
}

/** Remembers that the user dismissed the issue about this scan, so it is not shown again. */
export function dismissScanIssue(scanId: string): void {
    try {
        const ids = [...readDismissedScanIssues(), scanId].slice(-MAX_DISMISSED);
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
    } catch {
        // Storage unavailable: the issue may show again next time, which is harmless.
    }
}

/** The issue to show about failed scheduled scans of a project, if any. */
export function scheduledFailureIssue(scans: any[], now: number = Date.now(), dismissed: Set<string> = readDismissedScanIssues()): ScanIssue | null {
    const finished = (Array.isArray(scans) ? scans : [])
        .filter(s => s?.trigger_type === 'scheduled' && (s.status === 'completed' || s.status === 'failed'))
        .sort((a, b) => createdAt(b) - createdAt(a));
    let streak = 0;
    while (streak < finished.length && finished[streak].status === 'failed') streak++;
    if (streak === 0) return null;

    const latest = finished[0];
    if (dismissed.has(latest.id) || now - createdAt(latest) > SCHEDULED_FAILURE_MAX_AGE_MS) return null;
    const reason = typeof latest.failure_reason === 'string' && latest.failure_reason ? latest.failure_reason : UNKNOWN_FAILURE;
    return {
        level: 'error',
        title: streak === 1 ? 'The last scheduled scan failed' : `The last ${streak} scheduled scans failed`,
        details: [reason],
        hint: hintForRunnerMessage(reason),
        scanId: latest.id,
    };
}
