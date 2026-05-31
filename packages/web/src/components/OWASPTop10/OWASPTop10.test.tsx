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
            owaspCategory: ['API8:2023 Security Misconfiguration'],
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
                    owaspCategory: ['API1:2023 Broken Object Level Authorization'],
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
        expect(await screen.findByText(/2 Findings Detected/)).toBeTruthy();

        // Verify category titles are rendered
        expect(screen.getAllByText(/Broken Object Level Authorization/)).toBeTruthy();
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
        const accordionHeader = await screen.findByText(/API1:2023 Broken Object Level Authorization \(1\)/);
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
});
