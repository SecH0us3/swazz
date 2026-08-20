// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { RequestDetail } from './RequestDetail.js';
import type { FuzzResult, AnalysisFinding } from '../../types.js';

describe('RequestDetail Component - AI Insights & Findings', () => {
    const createMockResult = (findings: AnalysisFinding[]): FuzzResult => ({
        id: 'res-1',
        endpoint: '/api/v1/users',
        resolvedPath: '/api/v1/users',
        method: 'POST',
        profile: 'RANDOM',
        status: 500,
        duration: 45,
        payloadSize: 10,
        payload: { name: 'admin' },
        timestamp: Date.now(),
        retries: 0,
        analyzerFindings: findings,
        requestHeaders: { 'content-type': 'application/json' },
        responseBody: '{"error":"sql error"}'
    });

    it('renders True Positive badge with badge-error for boolean true', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/sqli',
            level: 'error',
            message: 'SQL Injection detected',
            ai_status: 'completed',
            ai_relevance: true,
            ai_confidence: 95,
            ai_explanation: 'Input directly concatenated into query',
            ai_remediation: 'Use parameterized queries'
        };

        render(
            <RequestDetail
                result={createMockResult([finding])}
                baseUrl="http://localhost"
                onClose={vi.fn()}
                globalHeaders={{}}
                globalCookies={{}}
            />
        );

        // Switch to findings tab
        const findingsTabBtn = screen.getByRole('tab', { name: /Alerts & Findings/i });
        fireEvent.click(findingsTabBtn);

        expect(screen.getByText('✨ AI Insights')).toBeTruthy();
        const badge = screen.getByText('True Positive');
        expect(badge).toBeTruthy();
        expect(badge.className).toContain('badge-error');
        expect(screen.getByText('95% confidence')).toBeTruthy();
        expect(screen.getByText('Explanation')).toBeTruthy();
        expect(screen.getByText('Input directly concatenated into query')).toBeTruthy();
    });

    it('renders False Positive badge with badge-success for boolean false', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/sqli',
            level: 'error',
            message: 'SQL Injection suspected',
            ai_status: 'completed',
            ai_relevance: false,
            ai_confidence: 85,
            ai_explanation: 'Standard database error message not exploitable'
        };

        render(
            <RequestDetail
                result={createMockResult([finding])}
                baseUrl="http://localhost"
                onClose={vi.fn()}
                globalHeaders={{}}
                globalCookies={{}}
            />
        );

        // Switch to findings tab
        const findingsTabBtn = screen.getByRole('tab', { name: /Alerts & Findings/i });
        fireEvent.click(findingsTabBtn);

        expect(screen.getByText('✨ AI Insights')).toBeTruthy();
        const badge = screen.getByText('False Positive');
        expect(badge).toBeTruthy();
        expect(badge.className).toContain('badge-success');
    });

    it('does not render relevance badge when ai_relevance is undefined/missing', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/sqli',
            level: 'error',
            message: 'SQL Injection suspected',
            ai_status: 'completed',
            ai_explanation: 'Evaluation in progress'
        };

        render(
            <RequestDetail
                result={createMockResult([finding])}
                baseUrl="http://localhost"
                onClose={vi.fn()}
                globalHeaders={{}}
                globalCookies={{}}
            />
        );

        const findingsTabBtn = screen.getByRole('tab', { name: /Alerts & Findings/i });
        fireEvent.click(findingsTabBtn);

        expect(screen.getByText('✨ AI Insights')).toBeTruthy();
        expect(screen.queryByText('True Positive')).toBeNull();
        expect(screen.queryByText('False Positive')).toBeNull();
    });
});
