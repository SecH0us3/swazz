// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
            owaspApiCategory: ['API10:2023 Unsafe Consumption of APIs'],
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
                    owaspApiCategory: ['API1:2023 Broken Object Level Authorization'],
                    owaspCategory: ['A01:2025 Broken Access Control'],
                    cweIds: ['CWE-639'],
                }
            ]
        }
    ];

    it('renders API Security 2023 categories by default and displays findings', async () => {
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

        // Verify API Security 2023 header is present by default
        expect(await screen.findByText(/OWASP API Security Top 10 \(2023\)/)).toBeTruthy();

        // Verify API categories are rendered
        expect(screen.getAllByText(/Broken Object Level Authorization/)).toBeTruthy();
        expect(screen.getAllByText(/Broken Authentication/)).toBeTruthy();
    });

    it('toggles between API Security (2023) and Web Top 10 (2025) standards', async () => {
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

        expect(await screen.findByText(/OWASP API Security Top 10 \(2023\)/)).toBeTruthy();

        // Click Web Top 10 button
        const webBtn = screen.getByRole('button', { name: /Web Top 10 \(2025\)/i });
        fireEvent.click(webBtn);

        expect(await screen.findByText(/OWASP Top 10 \(2025\)/)).toBeTruthy();
        expect(screen.getAllByText(/Broken Access Control/)).toBeTruthy();
    });

    it('renders sub-tab navigation buttons for Overview and Findings', async () => {
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

        expect(await screen.findByRole('button', { name: /Overview/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Findings/i })).toBeTruthy();
    });

    it('switches to Findings sub-tab and expands category accordion when clicking a category card with findings', async () => {
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

        // Wait for card
        const cardTitle = await screen.findByText('Broken Object Level Authorization');
        const card = cardTitle.closest('.owasp-card');
        expect(card).toBeTruthy();
        fireEvent.click(card!);

        // Findings sub-tab should now be active and accordion expanded showing finding message
        expect(await screen.findByText(/API1:2023 Broken Object Level Authorization \(1\)/)).toBeTruthy();
        expect(screen.getByText('BOLA vulnerability')).toBeTruthy();
        expect(screen.getByText('CWE-639')).toBeTruthy();
    });

    it('renders official learn more links for API categories', async () => {
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

        const learnMoreLinks = await screen.findAllByRole('link', { name: /Learn More ↗/i });
        const api1Link = learnMoreLinks.find(link => 
            link.getAttribute('href')?.includes('broken-object-level-authorization')
        );
        expect(api1Link).toBeTruthy();
        expect(api1Link?.getAttribute('target')).toBe('_blank');
        expect(api1Link?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('deduplicates identical findings by category, method, endpoint and defect', async () => {
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
                owaspApiCategory: ['API10:2023 Unsafe Consumption of APIs'],
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
                owaspApiCategory: ['API10:2023 Unsafe Consumption of APIs'],
            },
            {
                id: '3',
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
                        owaspApiCategory: ['API1:2023 Broken Object Level Authorization'],
                    }
                ]
            },
            {
                id: '4',
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
                        owaspApiCategory: ['API1:2023 Broken Object Level Authorization'],
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

        // 2 distinct findings after deduplication
        expect(await screen.findByRole('button', { name: /Findings \(2\)/i })).toBeTruthy();
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
    });
});
