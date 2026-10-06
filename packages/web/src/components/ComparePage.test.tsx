// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComparePage } from './ComparePage.js';
import { useAppStore } from '../store/appStore.js';
import type { ScanRun } from '../hooks/useDb.js';

function scanRun(id: string): ScanRun {
    return { id, startedAt: 1_000_000, completedAt: 1_060_000, baseUrl: 'https://api.test', stats: {} as any };
}

function result(id: string, method: string, endpoint: string, ruleId: string): any {
    return {
        id, method, endpoint, status: 200, duration: 5,
        analyzerFindings: [{ ruleId, level: 'error', message: `${ruleId} message` }],
    };
}

describe('ComparePage', () => {
    beforeEach(() => {
        useAppStore.setState({ compareRunIdA: null, compareRunIdB: null } as any);
    });

    it('shows the "No Scans Selected" placeholder when fewer than two runs are selected', () => {
        render(<ComparePage runs={[]} queryResults={vi.fn()} onSelectResult={vi.fn()} />);
        expect(screen.getByText('No Scans Selected')).toBeInTheDocument();
    });

    it('loads both runs, diffs them, and surfaces a finding new in B', async () => {
        useAppStore.setState({ compareRunIdA: 'A', compareRunIdB: 'B' } as any);
        const common = result('c', 'GET', '/shared', 'swazz/common');
        const rowsA = [common];
        const rowsB = [common, result('n', 'POST', '/new', 'swazz/new-xss')];
        const queryResults = vi.fn(async (opts: any) => ({
            rows: opts.runId === 'A' ? rowsA : rowsB,
            total: opts.runId === 'A' ? rowsA.length : rowsB.length,
        }));
        const onSelectResult = vi.fn();

        render(<ComparePage runs={[scanRun('A'), scanRun('B')]} queryResults={queryResults as any} onSelectResult={onSelectResult} />);

        // both runs are queried
        await waitFor(() => expect(queryResults).toHaveBeenCalledTimes(2));
        expect(queryResults).toHaveBeenCalledWith(expect.objectContaining({ runId: 'A' }));
        expect(queryResults).toHaveBeenCalledWith(expect.objectContaining({ runId: 'B' }));

        // the placeholder is gone and the new finding (only in B) shows on the default "new" tab
        await waitFor(() => expect(screen.queryByText('No Scans Selected')).not.toBeInTheDocument());
        await waitFor(() => expect(screen.getByText('Rule: swazz/new-xss')).toBeInTheDocument());

        // clicking "View in Inspector" forwards the underlying result
        fireEvent.click(screen.getByText('View in Inspector'));
        expect(onSelectResult).toHaveBeenCalledWith(expect.objectContaining({ endpoint: '/new', method: 'POST' }));
    });
});
