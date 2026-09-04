// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { MainWorkspace } from './MainWorkspace.js';
import { useAppStore } from '../store/appStore.js';

vi.mock('../hooks/useToast.js', () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../hooks/useFeatureGate.js', () => ({
    useFeatureGate: () => ({ unlocked: true, gateType: 'open', lockMessage: '' }),
}));

vi.mock('./WafCheck/WafCheckPanel.js', () => ({
    WafCheckPanel: ({ targetUrl }: { targetUrl?: string }) => (
        <div data-testid="mock-waf-check-panel">
            <span>Mock WafCheckPanel: {targetUrl}</span>
        </div>
    ),
}));

describe('MainWorkspace Component — WAF Check Tab', () => {
    const defaultProps = {
        config: {
            base_url: 'https://api.example.com',
            endpoints: [],
            settings: {
                analyze_response_body: true,
            },
        },
        handleStart: vi.fn(),
        handleSelectResult: vi.fn(),
        handleExport: vi.fn(),
        handleExportHTML: vi.fn(),
        handleExportMD: vi.fn(),
        handleLoadRun: vi.fn(),
        handleDeleteRun: vi.fn(),
        queryResults: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
        runs: [],
        onImportRun: vi.fn(),
        baseUrl: 'https://api.example.com',
        onChangeBaseUrl: vi.fn(),
        onStart: vi.fn(),
        onStop: vi.fn(),
        onPause: vi.fn(),
        onResume: vi.fn(),
        onToggleConfig: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            activeTab: 'heatmap',
            liveRunId: null,
            loadedRunId: null,
            stats: null,
            liveCount: 0,
        });
    });

    it('renders the WAF Check tab button in the tab-bar', () => {
        render(<MainWorkspace {...defaultProps} />);

        const wafTabBtn = screen.getByTestId('tab-waf');
        expect(wafTabBtn).toBeInTheDocument();
        expect(wafTabBtn).toHaveTextContent('WAF Check');
    });

    it('activates the WAF tab and renders WafCheckPanel when clicked', () => {
        render(<MainWorkspace {...defaultProps} />);

        const wafTabBtn = screen.getByTestId('tab-waf');
        fireEvent.click(wafTabBtn);

        expect(useAppStore.getState().activeTab).toBe('waf');
        expect(screen.getByTestId('mock-waf-check-panel')).toBeInTheDocument();
        expect(screen.getByText('Mock WafCheckPanel: https://api.example.com')).toBeInTheDocument();
    });

    it('renders WafCheckPanel directly when activeTab is waf initially', () => {
        useAppStore.setState({ activeTab: 'waf' });

        render(<MainWorkspace {...defaultProps} />);

        expect(screen.getByTestId('mock-waf-check-panel')).toBeInTheDocument();
        const wafTabBtn = screen.getByTestId('tab-waf');
        expect(wafTabBtn).toHaveClass('active');
    });
});
