import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OWASPTop10 } from './OWASPTop10.js';
import type { ResultSummary } from '../../hooks/useRunner.js';

describe('OWASPTop10 Component', () => {
    const mockQueryResults = vi.fn();

    const mockFindings: ResultSummary[] = [
        {
            id: '1',
            timestamp: Date.now(),
            method: 'GET',
            endpoint: '/users/{id}',
            resolvedPath: '/users/123',
            status: 500,
            profile: 'RANDOM',
            duration: 10,
            payloadSize: 0,
            retries: 0,
            payloadPreview: '',
            responsePreview: 'Internal Server Error',
            responseSize: 100,
            owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
        },
        {
            id: '2',
            timestamp: Date.now(),
            method: 'POST',
            endpoint: '/login',
            resolvedPath: '/login',
            status: 200,
            profile: 'MALICIOUS',
            duration: 12,
            payloadSize: 10,
            retries: 0,
            payloadPreview: '',
            responsePreview: '',
            responseSize: 50,
            analyzerFindings: [
                {
                    ruleId: 'swazz/bola-idor',
                    level: 'error',
                    message: 'BOLA vulnerability',
                    owaspCategory: ['A01:2025 Broken Access Control'],
                }
            ]
        }
    ];

    it('renders categories list and fetches findings', async () => {
        mockQueryResults.mockResolvedValue({
            rows: mockFindings,
            total: 2,
        });

        render(
            <OWASPTop10
                runId="run-123"
                queryResults={mockQueryResults}
                onSelectResult={() => {}}
            />
        );

        // Verify summary banner shows findings count
        expect(await screen.findByText(/2 Findings Detected/, {}, { timeout: 3000 })).toBeTruthy();

        // Verify category titles are rendered
        expect(screen.getAllByText(/Broken Access Control/)).toBeTruthy();
        expect(screen.getAllByText(/Security Misconfiguration/)).toBeTruthy();
    });

    it('allows expanding a category and selecting a finding', async () => {
        mockQueryResults.mockResolvedValue({
            rows: mockFindings,
            total: 2,
        });

        const selectSpy = vi.fn();

        render(
            <OWASPTop10
                runId="run-123"
                queryResults={mockQueryResults}
                onSelectResult={selectSpy}
            />
        );

        // Wait for the rows to load and accordion trigger to be visible
        const accordionHeader = await screen.findByText(/A01:2025 Broken Access Control \(1\)/, {}, { timeout: 3000 });
        expect(accordionHeader).toBeTruthy();

        // Click to expand
        fireEvent.click(accordionHeader);

        // Verify finding inside the category is displayed
        const pathSpan = await screen.findByText('/login');
        expect(pathSpan).toBeTruthy();

        // Click the row and verify select handler was called
        fireEvent.click(pathSpan.closest('.owasp-finding-row')!);
        expect(selectSpy).toHaveBeenCalledWith(mockFindings[1]);
    });

    it('limits category findings to 50 items and shows more on button click', async () => {
        const largeFindingsList = Array.from({ length: 60 }, (_, i) => ({
            id: `id-${i}`,
            timestamp: Date.now() - i * 1000,
            method: 'GET',
            endpoint: `/users/${i}`,
            resolvedPath: `/users/${i}`,
            status: 500,
            profile: 'RANDOM' as const,
            duration: 10,
            payloadSize: 0,
            retries: 0,
            payloadPreview: '',
            responsePreview: 'Internal Server Error',
            responseSize: 100,
            owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
        }));

        mockQueryResults.mockResolvedValue({
            rows: largeFindingsList,
            total: 60,
        });

        render(
            <OWASPTop10
                runId="run-123"
                queryResults={mockQueryResults}
                onSelectResult={() => {}}
            />
        );

        // Wait for the rows to load and accordion trigger to be visible
        const accordionHeader = await screen.findByText(/A10:2025 Mishandling of Exceptional Conditions \(60\)/, {}, { timeout: 3000 });
        expect(accordionHeader).toBeTruthy();

        // Click to expand
        fireEvent.click(accordionHeader);

        // First 50 items should be rendered
        expect(await screen.findByText('/users/0')).toBeTruthy();
        expect(screen.getByText('/users/49')).toBeTruthy();
        expect(screen.queryByText('/users/50')).toBeNull();

        // "Show More (+10)" button should be rendered
        const showMoreBtn = screen.getByRole('button', { name: /Show More \(\+10\)/i });
        expect(showMoreBtn).toBeTruthy();

        // Click "Show More"
        fireEvent.click(showMoreBtn);

        // Now item 50 should be visible
        expect(await screen.findByText('/users/50')).toBeTruthy();
        expect(screen.getByText('/users/59')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Show More/i })).toBeNull();
    });

    it('deduplicates findings within categories', async () => {
        const duplicateFindings: ResultSummary[] = [
            {
                id: '1',
                timestamp: Date.now(),
                method: 'GET',
                endpoint: '/users/{id}',
                resolvedPath: '/users/123',
                status: 500,
                profile: 'RANDOM',
                duration: 10,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal Server Error',
                responseSize: 100,
                owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
            },
            {
                id: '2',
                timestamp: Date.now(),
                method: 'GET',
                endpoint: '/users/{id}',
                resolvedPath: '/users/123',
                status: 500,
                profile: 'RANDOM',
                duration: 10,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal Server Error',
                responseSize: 100,
                owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
            },
            {
                id: '3',
                timestamp: Date.now(),
                method: 'GET',
                endpoint: '/users/123',
                resolvedPath: '',
                status: 500,
                profile: 'RANDOM',
                duration: 10,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Internal Server Error',
                responseSize: 100,
                owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
            },
            {
                id: '4',
                timestamp: Date.now(),
                method: 'GET',
                endpoint: '/users/{id}',
                resolvedPath: '/users/123',
                status: 400,
                profile: 'RANDOM',
                duration: 10,
                payloadSize: 0,
                retries: 0,
                payloadPreview: '',
                responsePreview: 'Bad Request',
                responseSize: 100,
                owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
            },
            {
                id: '5',
                timestamp: Date.now(),
                method: 'POST',
                endpoint: '/login',
                resolvedPath: '/login',
                status: 200,
                profile: 'MALICIOUS',
                duration: 12,
                payloadSize: 10,
                retries: 0,
                payloadPreview: '',
                responsePreview: '',
                responseSize: 50,
                analyzerFindings: [
                    {
                        ruleId: 'swazz/bola-idor',
                        level: 'error',
                        message: 'BOLA vulnerability',
                        owaspCategory: ['A01:2025 Broken Access Control'],
                    }
                ]
            },
            {
                id: '6',
                timestamp: Date.now(),
                method: 'POST',
                endpoint: '/login',
                resolvedPath: '/login',
                status: 200,
                profile: 'MALICIOUS',
                duration: 12,
                payloadSize: 10,
                retries: 0,
                payloadPreview: '',
                responsePreview: '',
                responseSize: 50,
                analyzerFindings: [
                    {
                        ruleId: 'swazz/bola-idor',
                        level: 'error',
                        message: 'BOLA vulnerability',
                        owaspCategory: ['A01:2025 Broken Access Control'],
                    }
                ]
            },
            {
                id: '7',
                timestamp: Date.now(),
                method: 'POST',
                endpoint: '/login',
                resolvedPath: '/login',
                status: 200,
                profile: 'MALICIOUS',
                duration: 12,
                payloadSize: 10,
                retries: 0,
                payloadPreview: '',
                responsePreview: '',
                responseSize: 50,
                analyzerFindings: [
                    {
                        ruleId: 'swazz/xss',
                        level: 'error',
                        message: 'XSS vulnerability',
                        owaspCategory: ['A01:2025 Broken Access Control', 'A02:2025 Cryptographic Failures'],
                    }
                ]
            }
        ];

        mockQueryResults.mockResolvedValue({
            rows: duplicateFindings,
            total: duplicateFindings.length,
        });

        render(
            <OWASPTop10
                runId="run-123"
                queryResults={mockQueryResults}
                onSelectResult={() => {}}
            />
        );

        expect(await screen.findByText(/5 Findings Detected/, {}, { timeout: 3000 })).toBeTruthy();
    });

    describe('Polling Logic', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            mockQueryResults.mockClear();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.clearAllMocks();
        });

        it('does not poll when isRunning is false', async () => {
            mockQueryResults.mockResolvedValue({ rows: [], total: 0 });

            await act(async () => {
                render(
                    <OWASPTop10
                        runId="run-123"
                        queryResults={mockQueryResults}
                        isRunning={false}
                        onSelectResult={() => {}}
                    />
                );
            });

            // Initial query should be triggered
            expect(mockQueryResults).toHaveBeenCalledTimes(1);

            // Advance timers by 10 seconds
            await act(async () => {
                vi.advanceTimersByTime(10000);
            });

            // Should still only be 1 call
            expect(mockQueryResults).toHaveBeenCalledTimes(1);
        });

        it('polls every 3 seconds when isRunning is true', async () => {
            mockQueryResults.mockResolvedValue({ rows: [], total: 0 });

            await act(async () => {
                render(
                    <OWASPTop10
                        runId="run-123"
                        queryResults={mockQueryResults}
                        isRunning={true}
                        onSelectResult={() => {}}
                    />
                );
            });

            // Initial query triggered
            expect(mockQueryResults).toHaveBeenCalledTimes(1);

            // Advance by 3 seconds -> 2nd call
            await act(async () => {
                await vi.advanceTimersByTimeAsync(3000);
            });
            expect(mockQueryResults).toHaveBeenCalledTimes(2);

            // Advance by another 3 seconds -> 3rd call
            await act(async () => {
                await vi.advanceTimersByTimeAsync(3000);
            });
            expect(mockQueryResults).toHaveBeenCalledTimes(3);
        });

        it('performs a final query immediately and stops polling when isRunning transitions to false', async () => {
            mockQueryResults.mockResolvedValue({ rows: [], total: 0 });

            let rerenderFn: any;
            await act(async () => {
                const { rerender } = render(
                    <OWASPTop10
                        runId="run-123"
                        queryResults={mockQueryResults}
                        isRunning={true}
                        onSelectResult={() => {}}
                    />
                );
                rerenderFn = rerender;
            });

            // Initial query
            expect(mockQueryResults).toHaveBeenCalledTimes(1);

            // Advance 3s -> 2nd call
            await act(async () => {
                await vi.advanceTimersByTimeAsync(3000);
            });
            expect(mockQueryResults).toHaveBeenCalledTimes(2);

            // Transition isRunning to false
            await act(async () => {
                rerenderFn(
                    <OWASPTop10
                        runId="run-123"
                        queryResults={mockQueryResults}
                        isRunning={false}
                        onSelectResult={() => {}}
                    />
                );
            });

            // Transitioning to false should run a final query immediately (so 3rd call)
            expect(mockQueryResults).toHaveBeenCalledTimes(3);

            // Advance 10s -> should NOT make any more calls
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10000);
            });
            expect(mockQueryResults).toHaveBeenCalledTimes(3);
        });
    });
});

