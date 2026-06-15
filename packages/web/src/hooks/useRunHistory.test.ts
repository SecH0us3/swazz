import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunHistory } from './useRunHistory.js';
import type { ResultSummary } from './useRunner.js';

describe('useRunHistory', () => {
    const mockRuns = [
        {
            id: 'run-1',
            startedAt: 1718000000000,
            completedAt: 1718000005000,
            baseUrl: 'http://example.com',
            stats: {
                totalRequests: 10,
                progress: { totalEndpoints: 2 }
            }
        }
    ];

    const mockGetRunResults = vi.fn();
    const mockDeleteRun = vi.fn();
    const mockShowToast = vi.fn();
    const mockOnRunLoaded = vi.fn();
    const mockQueryResults = vi.fn();

    // Mock DOM API
    const mockClick = vi.fn();
    const mockAnchor = {
        href: '',
        download: '',
        click: mockClick
    };

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock URL.createObjectURL and revokeObjectURL
        window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        window.URL.revokeObjectURL = vi.fn();

        const originalCreateElement = Document.prototype.createElement;
        // Mock document.createElement
        vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
            if (tagName === 'a') {
                return mockAnchor as any;
            }
            return originalCreateElement.call(document, tagName);
        });
    });

    it('loads a run correctly', async () => {
        const { result } = renderHook(() => useRunHistory({
            runs: mockRuns,
            queryResults: mockQueryResults,
            getRunResults: mockGetRunResults,
            deleteRun: mockDeleteRun,
            showToast: mockShowToast,
            onRunLoaded: mockOnRunLoaded
        }));

        await act(async () => {
            await result.current.handleLoadRun('run-1');
        });

        expect(mockOnRunLoaded).toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('Loaded run from history', 'success');
    });

    it('deletes a run correctly', async () => {
        const { result } = renderHook(() => useRunHistory({
            runs: mockRuns,
            queryResults: mockQueryResults,
            getRunResults: mockGetRunResults,
            deleteRun: mockDeleteRun,
            showToast: mockShowToast,
            onRunLoaded: mockOnRunLoaded
        }));

        await act(async () => {
            await result.current.handleDeleteRun('run-1');
        });

        expect(mockDeleteRun).toHaveBeenCalledWith('run-1');
        expect(mockShowToast).toHaveBeenCalledWith('Run deleted', 'success');
    });

    it('exports JSON report correctly', async () => {
        const mockRows: ResultSummary[] = [
            {
                id: 'res-1',
                timestamp: 1718000000000,
                method: 'GET',
                endpoint: '/users',
                resolvedPath: 'http://example.com/users',
                status: 200,
                profile: 'RANDOM',
                duration: 50,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: '{}',
                responseSize: 2
            }
        ];
        mockGetRunResults.mockResolvedValueOnce(mockRows);

        const { result } = renderHook(() => useRunHistory({
            runs: mockRuns,
            queryResults: mockQueryResults,
            getRunResults: mockGetRunResults,
            deleteRun: mockDeleteRun,
            showToast: mockShowToast,
            onRunLoaded: mockOnRunLoaded
        }));

        await act(async () => {
            await result.current.handleExport('run-1', 'http://example.com');
        });

        expect(mockGetRunResults).toHaveBeenCalledWith('run-1');
        expect(window.URL.createObjectURL).toHaveBeenCalled();
        expect(mockClick).toHaveBeenCalled();
        expect(mockAnchor.download).toContain('swazz-results-');
        expect(mockAnchor.download).toContain('.json');
        expect(mockShowToast).toHaveBeenCalledWith('Exported 1 results', 'success');
    });

    it('exports HTML report client-side correctly', async () => {
        const mockRows: ResultSummary[] = [
            {
                id: 'res-1',
                timestamp: 1718000000000,
                method: 'GET',
                endpoint: '/users',
                resolvedPath: 'http://example.com/users',
                status: 500, // Error finding
                profile: 'RANDOM',
                duration: 120,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal server error',
                responseSize: 21
            }
        ];
        mockGetRunResults.mockResolvedValueOnce(mockRows);

        const { result } = renderHook(() => useRunHistory({
            runs: mockRuns,
            queryResults: mockQueryResults,
            getRunResults: mockGetRunResults,
            deleteRun: mockDeleteRun,
            showToast: mockShowToast,
            onRunLoaded: mockOnRunLoaded
        }));

        let mockBlobConstructor = vi.spyOn(window, 'Blob');

        await act(async () => {
            await result.current.handleExportHTML('run-1');
        });

        expect(mockGetRunResults).toHaveBeenCalledWith('run-1');
        expect(mockBlobConstructor).toHaveBeenCalled();
        const htmlContent = mockBlobConstructor.mock.calls[0]?.[0]?.[0] || '';
        expect(htmlContent).toContain('<!DOCTYPE html>');
        expect(htmlContent).toContain('level-error');
        expect(htmlContent).toContain('HTTP 500');
        expect(htmlContent).toContain('profile-RANDOM');
        expect(htmlContent).toContain('/users');

        expect(window.URL.createObjectURL).toHaveBeenCalled();
        expect(mockClick).toHaveBeenCalled();
        expect(mockAnchor.download).toContain('swazz-report-');
        expect(mockAnchor.download).toContain('.html');
        expect(mockShowToast).toHaveBeenCalledWith('Report downloaded', 'success');
    });

    it('exports MD report client-side correctly', async () => {
        const mockRows: ResultSummary[] = [
            {
                id: 'res-1',
                timestamp: 1718000000000,
                method: 'GET',
                endpoint: '/users',
                resolvedPath: 'http://example.com/users',
                status: 500, // Error finding
                profile: 'RANDOM',
                duration: 120,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal server error',
                responseSize: 21,
                analyzerFindings: [
                    {
                        ruleId: 'swazz/crlf-injection',
                        level: 'error',
                        message: 'CRLF injection vulnerability detected',
                        evidence: 'evidence'
                    }
                ]
            }
        ];
        mockGetRunResults.mockResolvedValueOnce(mockRows);

        const { result } = renderHook(() => useRunHistory({
            runs: mockRuns,
            queryResults: mockQueryResults,
            getRunResults: mockGetRunResults,
            deleteRun: mockDeleteRun,
            showToast: mockShowToast,
            onRunLoaded: mockOnRunLoaded
        }));

        let mockBlobConstructor = vi.spyOn(window, 'Blob');

        await act(async () => {
            await result.current.handleExportMD('run-1');
        });

        expect(mockGetRunResults).toHaveBeenCalledWith('run-1');
        expect(mockBlobConstructor).toHaveBeenCalled();
        const mdContent = mockBlobConstructor.mock.calls[0]?.[0]?.[0] || '';
        expect(mdContent).toContain('# 🛡️ Swazz API Fuzzer Report');
        expect(mdContent).toContain('CRLF injection vulnerability detected');
        expect(mdContent).toContain('### /users');

        expect(window.URL.createObjectURL).toHaveBeenCalled();
        expect(mockClick).toHaveBeenCalled();
        expect(mockAnchor.download).toContain('swazz-report-');
        expect(mockAnchor.download).toContain('.md');
        expect(mockShowToast).toHaveBeenCalledWith('Markdown downloaded', 'success');
    });
});
