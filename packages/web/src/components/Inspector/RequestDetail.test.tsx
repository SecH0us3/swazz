// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { RequestDetail } from './RequestDetail.js';
import type { FuzzResult, AnalysisFinding, SwazzConfig } from '../../types.js';

describe('RequestDetail Component', () => {
    const mockOnClose = vi.fn();
    const mockOnTriage = vi.fn();

    const sampleFindings: AnalysisFinding[] = [
        {
            ruleId: 'swazz/sqli',
            level: 'error',
            message: 'SQL Injection detected in query parameter',
            ai_status: 'completed',
            ai_relevance: true,
            ai_confidence: 95,
            ai_explanation: 'Input directly concatenated into query',
            ai_remediation: 'Use parameterized queries',
            owasp_category: 'A03:2021 Injection',
            cwe_ids: ['CWE-89']
        } as any
    ];

    const mockResult: any = {
        id: 'res-123',
        endpoint: '/api/v1/users/{id}',
        resolvedPath: '/api/v1/users/42',
        method: 'GET',
        profile: 'RANDOM',
        status: 200,
        duration: 85,
        payloadSize: 120,
        payload: { id: 42, role: 'admin' },
        timestamp: Date.now(),
        retries: 0,
        requestHeaders: { 'Authorization': 'Bearer test-token', 'Content-Type': 'application/json' },
        responseHeaders: { 'Content-Type': ['application/json'], 'X-Powered-By': ['Express'] } as any,
        responseBody: '{"id":42,"username":"alice","role":"admin"}',
        analyzerFindings: sampleFindings,
        oob_interaction: {
            protocol: 'http',
            timestamp: Date.now(),
            remote_addr: '1.2.3.4'
        } as any
    };

    const mockConfig: any = {
        base_url: 'https://api.example.com',
        endpoints: [
            {
                method: 'GET',
                path: '/api/v1/users/{id}',
                schema: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        username: { type: 'string' }
                    }
                }
            }
        ]
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Mock clipboard API
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined)
            }
        });
    });

    it('renders request and response details by default', () => {
        render(
            <RequestDetail
                result={mockResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{ 'X-App-Client': 'Swazz' }}
                globalCookies={{ 'session_id': 'abc123' }}
                config={mockConfig}
                onTriage={mockOnTriage}
            />
        );

        expect(screen.getByText('GET')).toBeTruthy();
        expect(screen.getByText('/api/v1/users/{id}')).toBeTruthy();
        expect(screen.getByText('200')).toBeTruthy();
        expect(screen.getByText('RANDOM')).toBeTruthy();
    });

    it('renders response body and copies it to clipboard', async () => {
        render(
            <RequestDetail
                result={mockResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
                config={mockConfig}
                onTriage={mockOnTriage}
            />
        );

        const copyResponseBtn = screen.getByRole('button', { name: 'Copy' });
        fireEvent.click(copyResponseBtn);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            expect.stringContaining('alice')
        );
    });

    it('switches to Alerts & Findings tab and allows triaging', () => {
        render(
            <RequestDetail
                result={mockResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
                config={mockConfig}
                onTriage={mockOnTriage}
            />
        );

        const findingsTab = screen.getByRole('tab', { name: /Alerts & Findings/i });
        fireEvent.click(findingsTab);

        expect(screen.getByText('SQL Injection detected in query parameter')).toBeTruthy();
        expect(screen.getByText('✨ AI Insights')).toBeTruthy();
        expect(screen.getByText('True Positive')).toBeTruthy();
        expect(screen.getByText('95% confidence')).toBeTruthy();

        // Triage action select dropdown
        const triageSelect = screen.getByRole('combobox');
        fireEvent.change(triageSelect, { target: { value: 'false_positive' } });

        expect(mockOnTriage).toHaveBeenCalledWith('res-123', 'false_positive');
    });

    it('switches between Mutation Diff and Raw Request views', () => {
        render(
            <RequestDetail
                result={mockResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
                config={mockConfig}
                onTriage={mockOnTriage}
            />
        );

        expect(screen.getByText('Diff Legend:')).toBeTruthy();

        const rawReqBtn = screen.getByRole('button', { name: 'Raw Request' });
        fireEvent.click(rawReqBtn);

        expect(screen.getByText('Payload')).toBeTruthy();
        expect(screen.getByDisplayValue(/"role": "admin"/i)).toBeTruthy();
    });

    it('calls onClose when close button is clicked', () => {
        render(
            <RequestDetail
                result={mockResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
            />
        );

        const closeBtn = screen.getByRole('button', { name: /✕|Close/i });
        fireEvent.click(closeBtn);

        expect(mockOnClose).toHaveBeenCalled();
    });
});
