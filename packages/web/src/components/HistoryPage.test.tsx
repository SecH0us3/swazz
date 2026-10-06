// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../hooks/useToast.js', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../hooks/useFeatureGate.js', () => ({ useFeatureGate: () => ({ unlocked: true }) }));

import { HistoryPage } from './HistoryPage.js';
import { useAppStore } from '../store/appStore.js';
import type { ScanRun } from '../hooks/useDb.js';

function run(id: string, over: Partial<ScanRun> = {}): ScanRun {
    return {
        id,
        startedAt: 1_000_000,
        completedAt: 1_060_000, // completed, 60s, no 5xx -> "completed"
        baseUrl: 'https://api.test',
        stats: { statusCounts: { '200': 10 } } as any,
        ...over,
    };
}

function mountProps() {
    return {
        runs: [] as ScanRun[],
        onLoadRun: vi.fn(),
        onDeleteRun: vi.fn(),
        onImportRun: vi.fn(),
        onExport: vi.fn(),
        onExportHTML: vi.fn(),
        onExportMD: vi.fn(),
    };
}

describe('HistoryPage', () => {
    beforeEach(() => {
        useAppStore.setState({ loadedRunId: null, liveRunId: null } as any);
    });
    afterEach(() => vi.clearAllMocks());

    it('shows the empty state when there are no runs', () => {
        render(<HistoryPage {...mountProps()} />);
        expect(screen.getByText('No scan history yet')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Import JSON Report/i })).toBeInTheDocument();
    });

    it('renders a row and the tab counts for the runs', () => {
        const p = { ...mountProps(), runs: [run('r1'), run('r2')] };
        render(<HistoryPage {...p} />);
        // All tab badge shows 2
        const allTab = screen.getByRole('button', { name: /^All/ });
        expect(within(allTab).getByText('2')).toBeInTheDocument();
        // two "Load Run" buttons (one per row)
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(2);
    });

    it('calls onLoadRun and marks the already-loaded run as disabled', () => {
        const p = { ...mountProps(), runs: [run('r1')] };
        useAppStore.setState({ loadedRunId: null } as any);
        const { rerender } = render(<HistoryPage {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Load Run' }));
        expect(p.onLoadRun).toHaveBeenCalledWith('r1');

        useAppStore.setState({ loadedRunId: 'r1' } as any);
        rerender(<HistoryPage {...p} />);
        const loaded = screen.getByRole('button', { name: /Loaded/ });
        expect(loaded).toBeDisabled();
    });

    it('deletes only after confirmation', () => {
        const p = { ...mountProps(), runs: [run('r1')] };
        render(<HistoryPage {...p} />);
        const del = screen.getByTitle('Delete Scan Run');

        vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
        fireEvent.click(del);
        expect(p.onDeleteRun).not.toHaveBeenCalled();

        vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
        fireEvent.click(del);
        expect(p.onDeleteRun).toHaveBeenCalledWith('r1');
    });

    it('shows the empty-category message when a tab has no runs', () => {
        // a single completed run -> the "Failed" tab is empty
        const p = { ...mountProps(), runs: [run('r1')] };
        render(<HistoryPage {...p} />);
        fireEvent.click(screen.getByRole('button', { name: /^Failed/ }));
        expect(screen.getByText('No scans found in this category')).toBeInTheDocument();
    });

    it('classifies a run with 5xx responses under the Failed tab', () => {
        const failed = run('bad', { stats: { statusCounts: { '200': 1, '500': 3 } } as any });
        const p = { ...mountProps(), runs: [failed] };
        render(<HistoryPage {...p} />);
        const failedTab = screen.getByRole('button', { name: /^Failed/ });
        expect(within(failedTab).getByText('1')).toBeInTheDocument();
        // it is absent from the Completed tab
        fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
        expect(screen.getByText('No scans found in this category')).toBeInTheDocument();
    });
});
