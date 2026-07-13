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

    it('displays findings count text in findingsOnly mode', async () => {
        const rows = createMockResults(5);
        mockQueryResults.mockResolvedValue({
            rows,
            total: 5
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

        await waitFor(() => {
            expect(screen.getByText('5 findings')).toBeTruthy();
        });
    });

    it('supports filtering grouped errors by status code via dropdown list', async () => {
        const rows = [
            {
                id: '1',
                timestamp: Date.now(),
                method: 'GET',
                endpoint: '/users/1',
                resolvedPath: '/users/1',
                status: 500,
                profile: 'RANDOM',
                duration: 10,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal Server Error',
                responseSize: 100,
            },
            {
                id: '2',
                timestamp: Date.now() - 1000,
                method: 'POST',
                endpoint: '/users/2',
                resolvedPath: '/users/2',
                status: 400,
                profile: 'RANDOM',
                duration: 12,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Bad Request',
                responseSize: 100,
            }
        ] as ResultSummary[];
        mockQueryResults.mockResolvedValue({
            rows,
            total: 2
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

        // Expect to see both group headers initially
        const group500 = await screen.findByText('HTTP 500 Error');
        const group400 = await screen.findByText('HTTP 400 Error');
        expect(group500).toBeTruthy();
        expect(group400).toBeTruthy();
        expect(screen.getByText('2 findings')).toBeTruthy();

        // Click the Statuses dropdown button to open it
        const dropdownBtn = screen.getByRole('button', { name: /Statuses/i });
        fireEvent.click(dropdownBtn);

        // Find checkbox for 500 status and uncheck it
        const checkbox500 = screen.getByLabelText('500') as HTMLInputElement;
        expect(checkbox500.checked).toBe(true);
        fireEvent.click(checkbox500);
        expect(checkbox500.checked).toBe(false);

        // 500 group should be filtered out, so it should be gone
        await waitFor(() => {
            expect(screen.queryByText('HTTP 500 Error')).toBeNull();
        });
        expect(screen.getByText('HTTP 400 Error')).toBeTruthy();
        expect(screen.getByText('1 finding')).toBeTruthy();

        // Click "Select All" button to restore all
        const selectAllBtn = screen.getByRole('button', { name: /Select All/i });
        fireEvent.click(selectAllBtn);

        // Both groups should be back
        await waitFor(() => {
            expect(screen.getByText('HTTP 500 Error')).toBeTruthy();
        });
        expect(screen.getByText('HTTP 400 Error')).toBeTruthy();
        expect(screen.getByText('2 findings')).toBeTruthy();

        // Click "Clear All" button to hide all
        const clearAllBtn = screen.getByRole('button', { name: /Clear All/i });
        fireEvent.click(clearAllBtn);

        // No groups should be visible
        await waitFor(() => {
            expect(screen.queryByText('HTTP 500 Error')).toBeNull();
        });
        expect(screen.queryByText('HTTP 400 Error')).toBeNull();
        expect(screen.getByText('0 findings')).toBeTruthy();
    });
});


