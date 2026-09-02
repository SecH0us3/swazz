// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { FindingItem } from './FindingItem.js';
import type { ResultSummary } from '../../hooks/useRunner.js';

describe('FindingItem Component', () => {
    const baseResult: ResultSummary = {
        id: 'res-1',
        endpoint: '/api/v1/users',
        resolvedPath: '/api/v1/users',
        method: 'GET',
        status: 200,
        duration: 45,
        timestamp: Date.now(),
        profile: 'RANDOM',
        payloadSize: 10,
        responseSize: 100,
        error: '',
        retries: 0,
        payloadPreview: '',
        responsePreview: '',
    };

    it('renders basic finding item and handles click', () => {
        const onSelect = vi.fn();
        render(
            <FindingItem
                item={{ result: baseResult }}
                groupColor="#ff0000"
                onSelect={onSelect}
            />
        );

        expect(screen.getByText('GET')).toBeTruthy();
        expect(screen.getByText('/api/v1/users')).toBeTruthy();
        expect(screen.getByText('200')).toBeTruthy();

        fireEvent.click(screen.getByText('/api/v1/users'));
        expect(onSelect).toHaveBeenCalledWith(baseResult);
    });

    it('renders triage badges (FP, Ignored, Ack)', () => {
        const fpResult = { ...baseResult, triage: 'false_positive' as const };
        const { rerender } = render(
            <FindingItem item={{ result: fpResult }} groupColor="#ff0000" onSelect={vi.fn()} />
        );
        expect(screen.getByText('FP')).toBeTruthy();

        const ignoredResult = { ...baseResult, triage: 'ignored' as const };
        rerender(<FindingItem item={{ result: ignoredResult }} groupColor="#ff0000" onSelect={vi.fn()} />);
        expect(screen.getByText('Ignored')).toBeTruthy();

        const ackResult = { ...baseResult, triage: 'acknowledged' as const };
        rerender(<FindingItem item={{ result: ackResult }} groupColor="#ff0000" onSelect={vi.fn()} />);
        expect(screen.getByText('Ack')).toBeTruthy();
    });

    it('renders OWASP category, CWE IDs, message, evidence, and count badge', () => {
        const finding: any = {
            ruleId: 'swazz/sqli',
            level: 'error',
            message: 'SQL Injection detected',
            evidence: 'SELECT * FROM users WHERE id = 1',
            owaspApiCategory: ['API3:2023 Injection'],
            cweIds: ['CWE-89'],
        };

        render(
            <FindingItem
                item={{
                    result: baseResult,
                    finding,
                    count: 5,
                }}
                groupColor="#3b82f6"
                onSelect={vi.fn()}
            />
        );

        expect(screen.getByText('API3:2023')).toBeTruthy();
        expect(screen.getByText('CWE-89')).toBeTruthy();
        expect(screen.getByText('SQL Injection detected')).toBeTruthy();
        expect(screen.getByText(/SELECT \* FROM users/)).toBeTruthy();
        expect(screen.getByText('×5')).toBeTruthy();
    });

    it('renders timeout infinity badge when status is 0', () => {
        const timeoutResult: ResultSummary = {
            ...baseResult,
            status: 0,
        };

        render(
            <FindingItem
                item={{ result: timeoutResult }}
                groupColor="#ef4444"
                onSelect={vi.fn()}
            />
        );

        expect(screen.getByTitle('Infinity (Timeout / Network Error)')).toBeTruthy();
    });

    it('renders MCP tool error with parsed JSON content', () => {
        const mcpResult: ResultSummary = {
            ...baseResult,
            method: 'CALL',
            endpoint: 'mcp://tool/fetch_data',
            status: 200,
            responsePreview: JSON.stringify({
                isError: true,
                content: [{ type: 'text', text: { message: 'Failed to access remote target' } }]
            }),
        };

        render(
            <FindingItem
                item={{ result: mcpResult }}
                groupColor="#f59e0b"
                onSelect={vi.fn()}
            />
        );

        // Status 200 on isError displays -400
        expect(screen.getByText('-400')).toBeTruthy();
        expect(screen.getByText(/Failed to access remote target/)).toBeTruthy();
    });

    it('renders MCP tool error with string text and status 500', () => {
        const mcpResult: ResultSummary = {
            ...baseResult,
            method: 'MCP',
            status: 500,
            responsePreview: JSON.stringify({
                isError: true,
                content: [{ type: 'text', text: 'MCP timeout' }]
            }),
        };

        render(
            <FindingItem
                item={{ result: mcpResult }}
                groupColor="#ef4444"
                onSelect={vi.fn()}
            />
        );

        expect(screen.getByText('-500')).toBeTruthy();
        expect(screen.getByText(/MCP timeout/)).toBeTruthy();
    });

    it('renders server error status message when status >= 400 and no finding', () => {
        const errResult: ResultSummary = {
            ...baseResult,
            status: 503,
        };

        render(
            <FindingItem
                item={{ result: errResult }}
                groupColor="#ef4444"
                onSelect={vi.fn()}
            />
        );

        expect(screen.getByText('Server returned error status 503')).toBeTruthy();
    });
});
