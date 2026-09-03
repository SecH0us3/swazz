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

    it('calls onClose when close button is clicked or Escape is pressed', () => {
        const { unmount } = render(
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
        expect(mockOnClose).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(mockOnClose).toHaveBeenCalledTimes(2);

        unmount();
    });

    it('generates and copies PoC code in cURL, Python, TypeScript, and Go', async () => {
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

        const pocTab = screen.getByRole('tab', { name: /Live Replay & PoC Export/i });
        fireEvent.click(pocTab);

        expect(screen.getByRole('button', { name: 'cURL' })).toBeTruthy();

        // Python
        fireEvent.click(screen.getByRole('button', { name: 'Python' }));
        expect(screen.getByText(/import requests/i)).toBeTruthy();

        // TypeScript
        fireEvent.click(screen.getByRole('button', { name: 'TypeScript' }));
        expect(screen.getByText(/fetch\(/i)).toBeTruthy();

        // Go
        fireEvent.click(screen.getByRole('button', { name: 'Go' }));
        expect(screen.getByText(/http\.NewRequest/i)).toBeTruthy();

        // Copy Exploit Script
        const copyScriptBtn = screen.getByRole('button', { name: /Copy Exploit Script/i });
        fireEvent.click(copyScriptBtn);
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('handles replay request successfully and updates live response', async () => {
        const mockReplay = vi.fn().mockResolvedValue({
            status: 201,
            body: { success: true },
            headers: { 'X-Custom-Res': 'yes' }
        });

        render(
            <RequestDetail
                result={mockResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                onReplay={mockReplay}
                globalHeaders={{ 'X-Auth': 'secret' }}
                globalCookies={{ 'sid': '123' }}
                config={mockConfig}
            />
        );

        const replayBtn = screen.getByRole('button', { name: /Replay/i });
        fireEvent.click(replayBtn);

        await screen.findByText('201');
        expect(mockReplay).toHaveBeenCalledWith(expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ 'X-Auth': 'secret' }),
            cookies: expect.objectContaining({ 'sid': '123' })
        }));
    });

    it('handles replay request error and malformed raw body', async () => {
        const mockReplay = vi.fn().mockRejectedValue(new Error('Network connection refused'));

        render(
            <RequestDetail
                result={mockResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                onReplay={mockReplay}
                globalHeaders={{}}
                globalCookies={{}}
                config={mockConfig}
            />
        );

        // Switch to raw request and enter invalid JSON
        fireEvent.click(screen.getByRole('button', { name: 'Raw Request' }));
        const textarea = screen.getByDisplayValue(/"role": "admin"/i);
        fireEvent.change(textarea, { target: { value: '{ not valid json }' } });

        const replayBtn = screen.getByRole('button', { name: /Replay/i });
        fireEvent.click(replayBtn);

        await screen.findByText(/Network connection refused/i);
    });

    it('switches between Mutation Diff subtabs (Query, Headers, Body)', () => {
        const resultWithQuery: any = {
            ...mockResult,
            resolvedPath: '/api/v1/users/42?filter=active&sort=desc',
            payload: undefined // No body, triggers query default
        };

        render(
            <RequestDetail
                result={resultWithQuery}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
                config={mockConfig}
            />
        );

        expect(screen.getByRole('button', { name: 'Query Parameters Diff' })).toBeTruthy();
        
        // Switch to Request Headers subtab
        const headersSubTab = screen.getByRole('button', { name: 'Request Headers' });
        fireEvent.click(headersSubTab);
        expect(screen.getByText('Authorization:')).toBeTruthy();
    });

    it('highlights CRLF and CORS injected headers in response', () => {
        const crlfResult: any = {
            ...mockResult,
            responseHeaders: {
                'Set-Cookie': ['admin=true; Path=/'],
                'Access-Control-Allow-Origin': ['https://evil.com']
            },
            analyzerFindings: [
                {
                    ruleId: 'swazz/crlf-injection',
                    level: 'error',
                    message: "CRLF injection via 'set-cookie:'",
                    evidence: '— set-cookie: admin=true'
                },
                {
                    ruleId: 'swazz/cors-misconfig',
                    level: 'warning',
                    message: 'Overly permissive CORS origin',
                    evidence: 'https://evil.com'
                }
            ]
        };

        render(
            <RequestDetail
                result={crlfResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
                config={mockConfig}
            />
        );

        expect(screen.getAllByText('INJECTED').length).toBeGreaterThan(0);
    });

    it('displays MCP error negative status and multi-identity badge', () => {
        const mcpResult: any = {
            ...mockResult,
            method: 'CALL',
            status: 200,
            identity: 'Anonymous',
            responseBody: JSON.stringify({ isError: true, message: 'MCP tool failed' }),
            payload: 'truncated payload…'
        };

        const configWithBola: any = {
            ...mockConfig,
            settings: {
                bola_testing: true
            }
        };

        render(
            <RequestDetail
                result={mcpResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
                config={configWithBola}
            />
        );

        // Status 200 with isError: true displays -400
        expect(screen.getByText('-400')).toBeTruthy();
        expect(screen.getByText('Anonymous')).toBeTruthy();

        // Switch to raw request and verify preview note
        fireEvent.click(screen.getByRole('button', { name: 'Raw Request' }));
        expect(screen.getByText(/preview — full payload not stored/i)).toBeTruthy();

        // Copy raw payload
        const copyPayloadBtn = screen.getAllByRole('button', { name: 'Copy' })[0];
        fireEvent.click(copyPayloadBtn);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('truncated payload…');
    });

    it('handles embedded JSON in response body string', () => {
        const embeddedResult: any = {
            ...mockResult,
            responseBody: 'Internal Server Error: {"errorCode": 50012, "detail": "DB fail"}'
        };

        render(
            <RequestDetail
                result={embeddedResult}
                baseUrl="https://api.example.com"
                onClose={mockOnClose}
                globalHeaders={{}}
                globalCookies={{}}
            />
        );

        expect(screen.getByText(/errorCode/i)).toBeTruthy();
    });
});
