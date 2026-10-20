// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeEach } from 'vitest';
import { scheduledFailureIssue, dismissScanIssue, readDismissedScanIssues, SCHEDULED_FAILURE_MAX_AGE_MS } from './scheduledFailures.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const scan = (id: string, status: string, createdAt: string, extra: Record<string, unknown> = {}) =>
    ({ id, status, created_at: createdAt, trigger_type: 'scheduled', ...extra });

describe('scheduledFailureIssue', () => {
    beforeEach(() => localStorage.clear());

    it('says when the latest scheduled scan failed, and why', () => {
        const issue = scheduledFailureIssue([
            scan('ok', 'completed', '2026-10-19 00:00:00'),
            scan('bad', 'failed', '2026-10-20 00:00:00', { failure_reason: 'could not connect to the MCP server: status 401' }),
        ], NOW, new Set());
        expect(issue).toMatchObject({ level: 'error', title: 'The last scheduled scan failed', scanId: 'bad' });
        expect(issue?.details).toEqual(['could not connect to the MCP server: status 401']);
        expect(issue?.hint?.action?.tab).toBe('project_settings');
    });

    it('counts failures in a row', () => {
        const issue = scheduledFailureIssue([
            scan('a', 'failed', '2026-10-18 00:00:00'),
            scan('b', 'failed', '2026-10-19 00:00:00'),
            scan('c', 'failed', '2026-10-20 00:00:00'),
            scan('old-ok', 'completed', '2026-10-17 00:00:00'),
        ], NOW, new Set());
        expect(issue?.title).toBe('The last 3 scheduled scans failed');
    });

    it('stays quiet when the latest one succeeded, for manual or running scans, and for old news', () => {
        expect(scheduledFailureIssue([scan('a', 'failed', '2026-10-19 00:00:00'), scan('b', 'completed', '2026-10-20 00:00:00')], NOW, new Set())).toBeNull();
        expect(scheduledFailureIssue([scan('m', 'failed', '2026-10-20 00:00:00', { trigger_type: 'manual' })], NOW, new Set())).toBeNull();
        expect(scheduledFailureIssue([scan('r', 'dispatched', '2026-10-20 00:00:00')], NOW, new Set())).toBeNull();
        const old = new Date(NOW - SCHEDULED_FAILURE_MAX_AGE_MS - 60_000).toISOString().replace('T', ' ').slice(0, 19);
        expect(scheduledFailureIssue([scan('o', 'failed', old)], NOW, new Set())).toBeNull();
        expect(scheduledFailureIssue(undefined as any, NOW, new Set())).toBeNull();
    });

    it('does not come back once dismissed', () => {
        const scans = [scan('bad', 'failed', '2026-10-20 00:00:00')];
        dismissScanIssue('bad');
        expect(readDismissedScanIssues().has('bad')).toBe(true);
        expect(scheduledFailureIssue(scans, NOW)).toBeNull();
    });

    it('uses a generic reason when the scan reported none', () => {
        expect(scheduledFailureIssue([scan('x', 'failed', '2026-10-20 00:00:00')], NOW, new Set())?.details)
            .toEqual(['The scan failed without an error message.']);
    });
});
