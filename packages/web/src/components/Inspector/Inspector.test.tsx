import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Inspector } from './Inspector.js';
import type { ResultSummary } from '../../hooks/useRunner.js';

// Mock react-virtuoso for stable rendering in JSDOM environment
vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: any) => (
        <div data-testid="virtuoso-container">
            {data.map((item: any, index: number) => (
                <div key={index}>{itemContent(index, item)}</div>
            ))}
        </div>
    )
}));

describe('Inspector Component', () => {
    const mockQueryResults = vi.fn();

    const createMockResults = (count: number): ResultSummary[] => {
        return Array.from({ length: count }, (_, i) => ({
            id: String(i + 1),
            timestamp: Date.now() - i * 1000,
            method: 'GET',
            endpoint: `/users/${i}`,
            resolvedPath: `/users/${i}`,
            status: 500,
            profile: 'RANDOM',
            duration: 10,
            payloadSize: 0,
            retries: 0,
            payloadPreview: '',
            responsePreview: 'Internal Server Error',
            responseSize: 100,
        }));
    };

    it('renders normal request log list in non-findingsOnly mode', async () => {
        const rows = createMockResults(3);
        mockQueryResults.mockResolvedValue({
            rows,
            total: 3
        });

        render(
            <Inspector
                runId="run-123"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={() => {}}
                findingsOnly={false}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('virtuoso-container')).toBeTruthy();
        });

        expect(screen.getByText('/users/0')).toBeTruthy();
        expect(screen.getByText('/users/1')).toBeTruthy();
        expect(screen.getByText('/users/2')).toBeTruthy();
    });

    it('groups errors and supports expanding groups', async () => {
        const rows = createMockResults(2);
        mockQueryResults.mockResolvedValue({
            rows,
            total: 2
        });

        const onSelectSpy = vi.fn();

        render(
            <Inspector
                runId="run-123"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={onSelectSpy}
                onExport={() => {}}
                findingsOnly={true}
            />
        );

        // Group title is based on HTTP status error
        const groupHeader = await screen.findByText('HTTP 500 Error');
        expect(groupHeader).toBeTruthy();

        // Initially, the group is collapsed, so items should not be visible
        expect(screen.queryByText('/users/0')).toBeNull();

        // Click to expand group
        fireEvent.click(groupHeader.closest('.findings-group-header')!);

        // Item should be visible now
        const item = await screen.findByText('/users/0');
        expect(item).toBeTruthy();

        // Click on the item
        fireEvent.click(item.closest('.finding-item')!);
        expect(onSelectSpy).toHaveBeenCalledWith(rows[0]);
    });

    it('limits group list to 50 items and shows more on button click', async () => {
        const rows = createMockResults(60);
        mockQueryResults.mockResolvedValue({
            rows,
            total: 60
        });

        render(
            <Inspector
                runId="run-123"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={() => {}}
                findingsOnly={true}
            />
        );

        const groupHeader = await screen.findByText('HTTP 500 Error');
        fireEvent.click(groupHeader.closest('.findings-group-header')!);

        // The first 50 items should be rendered
        expect(await screen.findByText('/users/0')).toBeTruthy();
        expect(screen.getByText('/users/49')).toBeTruthy();
        // Item 50 should NOT be rendered (as it's the 51st item, 0-indexed)
        expect(screen.queryByText('/users/50')).toBeNull();

        // "Show More (+10)" button should be rendered
        const showMoreBtn = screen.getByRole('button', { name: /Show More \(\+10\)/i });
        expect(showMoreBtn).toBeTruthy();

        // Click "Show More"
        fireEvent.click(showMoreBtn);

        // Now item 50 and others up to 59 should be visible
        expect(await screen.findByText('/users/50')).toBeTruthy();
        expect(screen.getByText('/users/59')).toBeTruthy();
        // The button should be gone now since all items are shown
        expect(screen.queryByRole('button', { name: /Show More/i })).toBeNull();
    });
});
