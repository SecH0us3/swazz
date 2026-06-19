import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
});

