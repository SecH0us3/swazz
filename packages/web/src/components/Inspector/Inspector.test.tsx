// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Inspector } from './Inspector.js';
import type { ResultSummary } from '../../hooks/useRunner.js';
import * as findingsExport from '../../utils/findingsExport.js';

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

    it('persists status filter exclusions in localStorage', async () => {
        localStorage.clear();

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

        const { unmount } = render(
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

        // Open dropdown and uncheck 500
        const dropdownBtn = await screen.findByRole('button', { name: /Statuses/i });
        fireEvent.click(dropdownBtn);
        const checkbox500 = screen.getByLabelText('500') as HTMLInputElement;
        fireEvent.click(checkbox500);

        // Expect 500 to be saved to localStorage as excluded
        await waitFor(() => {
            const saved = localStorage.getItem('swazz_excluded_statuses');
            expect(saved).toBeTruthy();
            expect(JSON.parse(saved!)).toContain(500);
        });

        // Unmount component
        unmount();

        // Render again - should load from localStorage and hide 500 automatically
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

        // Group 500 should be gone from the start
        await waitFor(() => {
            expect(screen.queryByText('HTTP 500 Error')).toBeNull();
        });
        expect(screen.getByText('HTTP 400 Error')).toBeTruthy();
        expect(screen.getByText('1 finding')).toBeTruthy();
    });

    it('propagates triage status across deduplicated findings in the same cluster', async () => {
        localStorage.clear();
        const rows = [
            {
                id: '1',
                timestamp: 2000,
                method: 'GET',
                endpoint: '/api/v1/resource',
                resolvedPath: '/api/v1/resource',
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
                timestamp: 1000,
                method: 'GET',
                endpoint: '/api/v1/resource',
                resolvedPath: '/api/v1/resource',
                status: 500,
                profile: 'RANDOM',
                duration: 12,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal Server Error',
                responseSize: 100,
                triage: 'ignored',
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

        // Click Expand All to render finding items
        const expandAllBtn = await screen.findByRole('button', { name: /Expand All/i });
        fireEvent.click(expandAllBtn);

        // Should show Ignored badge even though the first row in rows array had no triage
        await waitFor(() => {
            expect(screen.getByText('Ignored')).toBeTruthy();
        });
    });

    it('filters findings by search query and calls onSelectResult when clicking a finding', async () => {
        const onSelectResultMock = vi.fn();
        const onExportMock = vi.fn();

        const rows = [
            {
                id: 'res-alpha',
                timestamp: 2000,
                method: 'GET',
                endpoint: '/api/v1/alpha',
                resolvedPath: '/api/v1/alpha',
                status: 500,
                profile: 'RANDOM',
                duration: 10,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Alpha error',
                responseSize: 100,
            },
            {
                id: 'res-beta',
                timestamp: 1000,
                method: 'POST',
                endpoint: '/api/v1/beta',
                resolvedPath: '/api/v1/beta',
                status: 400,
                profile: 'RANDOM',
                duration: 12,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Beta error',
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
                onSelectResult={onSelectResultMock}
                onExport={onExportMock}
                findingsOnly={false}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('2 reqs')).toBeTruthy();
            expect(screen.getByText('/api/v1/alpha')).toBeTruthy();
            expect(screen.getByText('/api/v1/beta')).toBeTruthy();
        });

        // Search for 'beta'
        const searchInput = screen.getByPlaceholderText(/Filter by path…/i);
        fireEvent.change(searchInput, { target: { value: 'beta' } });

        // Click Export button
        const exportBtn = screen.getByRole('button', { name: /Export/i });
        fireEvent.click(exportBtn);
        expect(onExportMock).toHaveBeenCalled();
    });

    it('renders WAF patch report viewer when findingsOnly is true and report is present', async () => {
        mockQueryResults.mockResolvedValue({ rows: [], total: 0 });
        const report = {
            targetUrl: 'https://example.com',
            generatedAt: '2026-09-04T12:00:00.000Z',
            totalBypasses: 1,
            bundles: {
                cloudflare: { vendor: 'cloudflare', native: 'rule-cf', ruleCount: 1 }
            }
        };

        const { rerender } = render(
            <Inspector
                runId="run-123"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={() => {}}
                findingsOnly={true}
                wafPatchReport={report}
            />
        );

        expect(screen.getByTestId('waf-patch-viewer')).toBeInTheDocument();
        expect(screen.getByText('rule-cf')).toBeInTheDocument();

        // When wafPatchReport is absent, viewer is not rendered
        rerender(
            <Inspector
                runId="run-123"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={() => {}}
                findingsOnly={true}
                wafPatchReport={null}
            />
        );
        expect(screen.queryByTestId('waf-patch-viewer')).not.toBeInTheDocument();
    });

    it('supports Expand All and Collapse All in findingsOnly mode', async () => {
        const rows: ResultSummary[] = [
            {
                id: '1',
                timestamp: Date.now(),
                method: 'GET',
                endpoint: '/api/v1/user/1',
                resolvedPath: '/api/v1/user/1',
                status: 500,
                profile: 'AUTH',
                duration: 20,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal Server Error',
                responseSize: 50,
            },
            {
                id: '2',
                timestamp: Date.now(),
                method: 'GET',
                endpoint: '/api/v1/admin',
                resolvedPath: '/api/v1/admin',
                status: 403,
                profile: 'AUTH',
                duration: 25,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Forbidden',
                responseSize: 30,
            }
        ];
        mockQueryResults.mockResolvedValue({ rows, total: 2 });

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
            expect(screen.getByText('Expand All')).toBeInTheDocument();
        });

        // Click Expand All
        fireEvent.click(screen.getByText('Expand All'));
        expect(screen.getByText('/api/v1/user/1')).toBeInTheDocument();
        expect(screen.getByText('/api/v1/admin')).toBeInTheDocument();

        // Click Collapse All
        fireEvent.click(screen.getByText('Collapse All'));
        expect(screen.queryByText('/api/v1/user/1')).toBeNull();
        expect(screen.queryByText('/api/v1/admin')).toBeNull();
    });

    it('handles search input clear button and show all button for pagination', async () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({
            id: String(i + 1),
            timestamp: Date.now() - i * 1000,
            method: 'GET',
            endpoint: `/items/${i}`,
            resolvedPath: `/items/${i}`,
            status: 200,
            profile: 'DEFAULT',
            duration: 15,
            payloadSize: 0,
            retries: 0,
            payloadPreview: '',
            responsePreview: 'OK',
            responseSize: 20,
        }));
        mockQueryResults.mockResolvedValue({ rows, total: 1500 });

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
            expect(screen.getByText('show all')).toBeInTheDocument();
        });

        // Click show all
        fireEvent.click(screen.getByText('show all'));
        expect(mockQueryResults).toHaveBeenCalledWith(expect.objectContaining({ limit: 1500 }));

        // Type in search, then click clear search ✕
        const searchInput = screen.getByPlaceholderText(/Filter by path…/i);
        fireEvent.change(searchInput, { target: { value: 'items' } });
        const clearBtn = screen.getByRole('button', { name: /Clear search/i });
        fireEvent.click(clearBtn);
        expect((searchInput as HTMLInputElement).value).toBe('');
    });

    it('renders empty state when runId is not provided', async () => {
        mockQueryResults.mockResolvedValue({ rows: [], total: 0 });
        render(
            <Inspector
                runId=""
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={() => {}}
                findingsOnly={false}
            />
        );

        expect(screen.getByText('Waiting for requests')).toBeInTheDocument();
        expect(screen.getByText(/Start a fuzz test to see results appear here in real time/i)).toBeInTheDocument();
    });

    it('renders compact grouped export dropdown in findingsOnly mode and supports JSON, Markdown, and Full Log', async () => {
        const downloadSpy = vi.spyOn(findingsExport, 'downloadTextFile').mockImplementation(() => {});
        const onExport = vi.fn();

        const findingRows: ResultSummary[] = [
            {
                id: 'f1',
                timestamp: 1700000000000,
                method: 'POST',
                endpoint: '/api/render',
                resolvedPath: '/api/render',
                status: 200,
                profile: 'MALICIOUS',
                duration: 25,
                payloadSize: 18,
                retries: 0,
                payloadPreview: '{"tpl":"{{7*7}}"}',
                responsePreview: '49',
                responseSize: 2,
                analyzerFindings: [{ ruleId: 'ssti', level: 'error', message: 'SSTI detected' }],
            },
            {
                id: 'f2',
                timestamp: 1700000001000,
                method: 'POST',
                endpoint: '/api/render',
                resolvedPath: '/api/render',
                status: 200,
                profile: 'MALICIOUS',
                duration: 28,
                payloadSize: 18,
                retries: 0,
                payloadPreview: '{"tpl":"${7*7}"}',
                responsePreview: '49',
                responseSize: 2,
                analyzerFindings: [{ ruleId: 'ssti', level: 'error', message: 'SSTI detected' }],
            },
            {
                id: 'f3',
                timestamp: 1700000002000,
                method: 'POST',
                endpoint: '/api/render',
                resolvedPath: '/api/render',
                status: 200,
                profile: 'MALICIOUS',
                duration: 30,
                payloadSize: 18,
                retries: 0,
                payloadPreview: '{"tpl":"#{7*7}"}',
                responsePreview: '49',
                responseSize: 2,
                analyzerFindings: [{ ruleId: 'ssti', level: 'error', message: 'SSTI detected' }],
            },
        ];
        mockQueryResults.mockResolvedValue({ rows: findingRows, total: findingRows.length });

        render(
            <Inspector
                runId="run-exp"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={onExport}
                findingsOnly={true}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
        });

        // Clicking Export opens the dropdown instead of calling onExport immediately
        fireEvent.click(screen.getByRole('button', { name: /Export/i }));
        expect(onExport).not.toHaveBeenCalled();
        expect(screen.getByRole('menu')).toBeInTheDocument();

        // Switch examples per finding to 1 and export Grouped Findings (JSON)
        const btn1 = screen.getByRole('button', { name: '1' });
        const btn2 = screen.getByRole('button', { name: '2' });
        expect(btn2).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(btn1);
        expect(btn1).toHaveAttribute('aria-pressed', 'true');
        expect(btn2).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByRole('menuitem', { name: /Grouped Findings \(JSON\)/i }));

        expect(downloadSpy).toHaveBeenCalledTimes(1);
        const [jsonName, jsonContent, jsonMime] = downloadSpy.mock.calls[0];
        expect(jsonName).toMatch(/^swazz-findings-grouped-.*\.json$/);
        expect(jsonMime).toBe('application/json');
        const parsed = JSON.parse(jsonContent);
        expect(parsed.maxExamplesPerFinding).toBe(1);
        expect(parsed.securityVulnerabilities[0].targets[0].count).toBe(3);
        expect(parsed.securityVulnerabilities[0].targets[0].examples).toHaveLength(1);

        // Re-open, switch to 2 examples, export Grouped Findings (Markdown)
        fireEvent.click(screen.getByRole('button', { name: /Export/i }));
        fireEvent.click(screen.getByRole('button', { name: '2' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /Grouped Findings \(Markdown\)/i }));

        expect(downloadSpy).toHaveBeenCalledTimes(2);
        const [mdName, mdContent, mdMime] = downloadSpy.mock.calls[1];
        expect(mdName).toMatch(/^swazz-findings-grouped-.*\.md$/);
        expect(mdMime).toContain('text/markdown');
        expect(mdContent).toContain('# Swazz Grouped Findings Report');
        expect(mdContent).toContain('Example 2/2');

        // Re-open and click Full Scan Log (JSON) -> calls onExport
        fireEvent.click(screen.getByRole('button', { name: /Export/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /Full Scan Log \(JSON\)/i }));
        expect(onExport).toHaveBeenCalledTimes(1);

        downloadSpy.mockRestore();
    });

    it('disables grouped export items when there are no findings while keeping Full Scan Log enabled', async () => {
        mockQueryResults.mockResolvedValue({ rows: [], total: 0 });
        render(
            <Inspector
                runId="run-empty"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={() => {}}
                findingsOnly={true}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /Export/i }));
        expect(screen.getByRole('menuitem', { name: /Grouped Findings \(JSON\)/i })).toBeDisabled();
        expect(screen.getByRole('menuitem', { name: /Grouped Findings \(Markdown\)/i })).toBeDisabled();
        expect(screen.getByRole('menuitem', { name: /Full Scan Log \(JSON\)/i })).toBeEnabled();
        expect(screen.getByRole('separator')).toBeInTheDocument();

        // Disabled items are skipped during keyboard navigation
        const menu = screen.getByRole('menu');
        const fullItem = screen.getByRole('menuitem', { name: /Full Scan Log \(JSON\)/i });
        fireEvent.keyDown(menu, { key: 'Home' });
        expect(document.activeElement).toBe(fullItem);
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(fullItem);
    });

    it('supports keyboard navigation (ArrowDown, End, Home, Escape) on the findings export menu', async () => {
        mockQueryResults.mockResolvedValue({
            rows: [
                {
                    id: 'k1',
                    timestamp: 1700000000000,
                    method: 'GET',
                    endpoint: '/api/err',
                    resolvedPath: '/api/err',
                    status: 500,
                    profile: 'MALICIOUS',
                    duration: 15,
                    payloadSize: 0,
                    retries: 0,
                    payloadPreview: '',
                    responsePreview: 'Internal Server Error',
                    responseSize: 21,
                },
            ],
            total: 1,
        });

        render(
            <Inspector
                runId="run-kbd"
                queryResults={mockQueryResults}
                heatmapFilter={null}
                onClearHeatmapFilter={() => {}}
                onSelectResult={() => {}}
                onExport={() => {}}
                findingsOnly={true}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
        });

        const trigger = screen.getByRole('button', { name: /Export/i });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });

        const menu = screen.getByRole('menu');
        const jsonItem = screen.getByRole('menuitem', { name: /Grouped Findings \(JSON\)/i });
        const mdItem = screen.getByRole('menuitem', { name: /Grouped Findings \(Markdown\)/i });
        const fullItem = screen.getByRole('menuitem', { name: /Full Scan Log \(JSON\)/i });

        expect(menu).toBeInTheDocument();
        expect(document.activeElement).toBe(jsonItem);

        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(mdItem);

        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(fullItem);

        // Wrap-around ArrowDown from last to first
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(jsonItem);

        // Wrap-around ArrowUp from first to last
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(fullItem);

        // ArrowDown on already-open trigger focuses first enabled item
        trigger.focus();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(jsonItem);

        fireEvent.keyDown(menu, { key: 'End' });
        expect(document.activeElement).toBe(fullItem);

        fireEvent.keyDown(menu, { key: 'Home' });
        expect(document.activeElement).toBe(jsonItem);

        fireEvent.keyDown(menu, { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(trigger);

        // Outside mousedown closes menu; inside mousedown keeps it open
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).toBeInTheDocument();
        fireEvent.mouseDown(screen.getByRole('menu'));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        // Focus moving outside closes menu
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).toBeInTheDocument();
        const outsideBtn = document.createElement('button');
        document.body.appendChild(outsideBtn);
        fireEvent.focusIn(outsideBtn);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        document.body.removeChild(outsideBtn);
    });
});


