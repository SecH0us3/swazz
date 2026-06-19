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

    it('correctly maps rule IDs to OWASP 2025 categories during HTML/MD exports', async () => {
        const mockRows: ResultSummary[] = [
            {
                id: 'res-bola',
                timestamp: 1718000000000,
                method: 'GET',
                endpoint: '/bola',
                resolvedPath: 'http://example.com/bola',
                status: 400,
                profile: 'RANDOM',
                duration: 50,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'error',
                responseSize: 5,
                analyzerFindings: [
                    {
                        ruleId: 'swazz/bola-idor',
                        level: 'error',
                        message: 'BOLA vulnerability',
                        evidence: 'evidence'
                    }
                ]
            },
            {
                id: 'res-rate-limit',
                timestamp: 1718000000000,
                method: 'POST',
                endpoint: '/rate-limit',
                resolvedPath: 'http://example.com/rate-limit',
                status: 429,
                profile: 'RANDOM',
                duration: 50,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'error',
                responseSize: 5,
                analyzerFindings: [
                    {
                        ruleId: 'swazz/no-rate-limit',
                        level: 'warning',
                        message: 'Rate limit vulnerability',
                        evidence: 'evidence'
                    }
                ]
            },
            {
                id: 'res-status-500',
                timestamp: 1718000000000,
                method: 'GET',
                endpoint: '/server-error',
                resolvedPath: 'http://example.com/server-error',
                status: 500,
                profile: 'RANDOM',
                duration: 50,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal Server Error',
                responseSize: 21
            },
            {
                id: 'res-time-based-sqli',
                timestamp: 1718000000000,
                method: 'GET',
                endpoint: '/time-based-sqli',
                resolvedPath: 'http://example.com/time-based-sqli',
                status: 200,
                profile: 'RANDOM',
                duration: 50,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'success',
                responseSize: 7,
                analyzerFindings: [
                    {
                        ruleId: 'swazz/time-based-sqli',
                        level: 'error',
                        message: 'Time-based SQLi vulnerability',
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

        const mdContent = mockBlobConstructor.mock.calls[0]?.[0]?.[0] || '';
        expect(mdContent).toContain('**OWASP Category:** A01:2025 Broken Access Control');
        expect(mdContent).toContain('**OWASP Category:** A06:2025 Insecure Design');
        expect(mdContent).toContain('**OWASP Category:** A10:2025 Mishandling of Exceptional Conditions');
        expect(mdContent).toContain('**OWASP Category:** A05:2025 Injection');
    });
});
