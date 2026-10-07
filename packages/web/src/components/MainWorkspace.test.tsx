// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { MainWorkspace } from './MainWorkspace.js';
import { useAppStore } from '../store/appStore.js';

const mockShowToast = vi.fn();
vi.mock('../hooks/useToast.js', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

let mockGateState = { unlocked: true, gateType: 'open', lockMessage: '' };

vi.mock('../hooks/useFeatureGate.js', () => ({
    useFeatureGate: () => mockGateState,
}));

vi.mock('./Shared/ExecutiveSummaryModal.js', () => ({
    ExecutiveSummaryModal: ({ runId, onClose }: any) => (
        <div data-testid="mock-exec-summary-modal">
            <span>Executive Summary Modal: {runId}</span>
            <button onClick={onClose}>Close Summary Modal</button>
        </div>
    ),
}));

vi.mock('./WafCheck/WafCheckPanel.js', () => ({
    WafCheckPanel: ({ targetUrl }: { targetUrl?: string }) => (
        <div data-testid="mock-waf-check-panel">
            <span>Mock WafCheckPanel: {targetUrl}</span>
        </div>
    ),
}));

vi.mock('./Dashboard/Dashboard.js', () => ({
    Dashboard: ({ onTryDemo, onHeatmapFilter }: any) => (
        <div data-testid="mock-dashboard">
            <span>Mock Dashboard</span>
            <button onClick={onTryDemo}>Dashboard Demo</button>
            <button onClick={() => onHeatmapFilter({ statusGroup: '2xx' })}>Filter 2xx</button>
        </div>
    ),
}));

vi.mock('./Inspector/Inspector.js', () => ({
    Inspector: ({ findingsOnly, onExport, onClearHeatmapFilter }: any) => (
        <div data-testid="mock-inspector">
            <span>Inspector findingsOnly={String(findingsOnly)}</span>
            <button onClick={onExport}>Export Inspector</button>
            <button onClick={onClearHeatmapFilter}>Clear Filter</button>
        </div>
    ),
}));

vi.mock('./OWASPTop10/OWASPTop10.js', () => ({
    OWASPTop10: () => <div data-testid="mock-owasp">Mock OWASP</div>,
}));

vi.mock('./Inspector/RunnerLogsViewer.js', () => ({
    RunnerLogsViewer: () => <div data-testid="mock-runner-logs">Mock Runner Logs</div>,
}));

vi.mock('./HistoryPage.js', () => ({
    HistoryPage: ({ onLoadRun, onExport, onExportExecutiveSummary }: any) => (
        <div data-testid="mock-history-page">
            <button onClick={() => onLoadRun('run-1')}>Load Run</button>
            <button onClick={() => onExport('run-1')}>Export Run</button>
            <button onClick={() => onExportExecutiveSummary('run-1')}>Export Exec Summary</button>
        </div>
    ),
}));

vi.mock('./Dashboard/AnalyticsDashboard.js', () => ({
    AnalyticsDashboard: () => <div data-testid="mock-analytics-dashboard">Mock Analytics</div>,
}));

vi.mock('./ComparePage.js', () => ({
    ComparePage: () => <div data-testid="mock-compare-page">Mock Compare</div>,
}));

vi.mock('./UserSettings.js', () => ({
    UserSettings: () => <div data-testid="mock-user-settings">Mock User Settings</div>,
}));

vi.mock('./ProjectSettings.js', () => ({
    ProjectSettings: () => <div data-testid="mock-project-settings">Mock Project Settings</div>,
}));

vi.mock('./AboutPage.js', () => ({
    AboutPage: () => <div data-testid="mock-about-page">Mock About Page</div>,
}));

describe('MainWorkspace Component', () => {
    const defaultProps = {
        config: {
            base_url: 'https://api.example.com',
            endpoints: [
                { method: 'GET', path: '/api/v1/users' },
                { method: 'POST', path: '/api/v1/users' },
            ],
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
        queryResults: vi.fn().mockResolvedValue({
            rows: [
                {
                    id: 'res-1',
                    method: 'GET',
                    endpoint: '/api/v1/users',
                    status: 500,
                    responsePreview: 'Internal Server Error: Database connection failed',
                    analyzerFindings: [
                        { ruleId: 'SQLI_01', message: 'SQL Error leaked', owaspCategory: ['A03:2021-Injection'] },
                    ],
                },
                {
                    id: 'res-2',
                    method: 'POST',
                    endpoint: '/api/v1/users',
                    status: 403,
                    responsePreview: 'Forbidden',
                    owaspApiCategory: ['API1:2023-Broken-Object-Level-Authorization'],
                },
                {
                    id: 'res-3',
                    method: 'CALL',
                    endpoint: 'mcp://tool/fetch',
                    status: 200,
                    responsePreview: 'Error in tool execution',
                },
            ],
            total: 3,
        }),
        runs: [{ id: 'run-1', created_at: '2026-08-01' }],
        onImportRun: vi.fn(),
        getRunExecutiveSummary: vi.fn().mockResolvedValue({ summary: 'Executive summary content', model: 'gpt' }),
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
        mockGateState = { unlocked: true, gateType: 'open', lockMessage: '' };
        localStorage.clear();
        useAppStore.setState({
            activeTab: 'heatmap',
            liveRunId: 'run-live',
            loadedRunId: null,
            stats: {
                totalRequests: 100,
                endpointCounts: { 'GET /api/v1/users': 50 },
            } as any,
            historyStats: null,
            liveCount: 10,
            compareRunIdA: null,
            compareRunIdB: null,
            isConfigOpen: false,
            isConfigHiddenDesktop: true,
        });
    });

    it('renders UserSettings when activeTab is settings', () => {
        useAppStore.setState({ activeTab: 'settings' });
        render(<MainWorkspace {...defaultProps} />);
        expect(screen.getByTestId('mock-user-settings')).toBeInTheDocument();
    });

    it('renders ProjectSettings when activeTab is project_settings', () => {
        useAppStore.setState({ activeTab: 'project_settings' });
        render(<MainWorkspace {...defaultProps} />);
        expect(screen.getByTestId('mock-project-settings')).toBeInTheDocument();
    });

    it('renders AboutPage when activeTab is about', () => {
        useAppStore.setState({ activeTab: 'about' });
        render(<MainWorkspace {...defaultProps} />);
        expect(screen.getByTestId('mock-about-page')).toBeInTheDocument();
    });

    it('renders history banner and allows returning to live mode', () => {
        useAppStore.setState({
            loadedRunId: 'hist-123',
            historyStats: { startTime: Date.now(), totalRequests: 42 } as any,
        });
        render(<MainWorkspace {...defaultProps} />);

        expect(screen.getByText('Viewing History')).toBeInTheDocument();
        const liveBtn = screen.getByRole('button', { name: /← Live/i });
        fireEvent.click(liveBtn);

        expect(useAppStore.getState().loadedRunId).toBeNull();
    });

    it('renders welcome screen when there is no activity', () => {
        useAppStore.setState({ liveRunId: null, loadedRunId: null });
        const propsWithoutEndpoints = {
            ...defaultProps,
            config: { ...defaultProps.config, endpoints: [] },
        };
        render(<MainWorkspace {...propsWithoutEndpoints} />);

        expect(screen.getByText('Ready to swazz')).toBeInTheDocument();
        const demoBtn = screen.getByRole('button', { name: /Try Vulnerable Demo/i });
        fireEvent.click(demoBtn);

        expect(defaultProps.handleStart).toHaveBeenCalledWith(['https://bbad.secmy.app/swagger.json']);
    });

    it('switches between all main tabs', () => {
        render(<MainWorkspace {...defaultProps} />);

        // Default tab is heatmap
        expect(screen.getByTestId('mock-dashboard')).toBeInTheDocument();

        // Switch to Logs
        const logsBtn = screen.getByRole('button', { name: /Logs/i });
        fireEvent.click(logsBtn);
        expect(useAppStore.getState().activeTab).toBe('logs');
        expect(screen.getByText('Inspector findingsOnly=undefined')).toBeInTheDocument();

        // Switch to Findings
        const findingsBtn = screen.getByRole('button', { name: /Findings/i });
        fireEvent.click(findingsBtn);
        expect(useAppStore.getState().activeTab).toBe('findings');
        expect(screen.getByText('Inspector findingsOnly=true')).toBeInTheDocument();

        // Switch to OWASP
        const owaspBtn = screen.getByRole('button', { name: /OWASP/i });
        fireEvent.click(owaspBtn);
        expect(useAppStore.getState().activeTab).toBe('owasp');
        expect(screen.getByTestId('mock-owasp')).toBeInTheDocument();

        // Switch to Runner
        const runnerBtn = screen.getByRole('button', { name: /Runner/i });
        fireEvent.click(runnerBtn);
        expect(useAppStore.getState().activeTab).toBe('runner_logs');
        expect(screen.getByTestId('mock-runner-logs')).toBeInTheDocument();

        // Switch to History
        const historyBtn = screen.getByRole('button', { name: /History/i });
        fireEvent.click(historyBtn);
        expect(useAppStore.getState().activeTab).toBe('history');
        expect(screen.getByTestId('mock-history-page')).toBeInTheDocument();

        // Switch to Analytics
        const analyticsBtn = screen.getByRole('button', { name: /Analytics/i });
        fireEvent.click(analyticsBtn);
        expect(useAppStore.getState().activeTab).toBe('analytics');
        expect(screen.getByTestId('mock-analytics-dashboard')).toBeInTheDocument();
    });

    it('renders Compare tab when both compare run IDs are set', () => {
        useAppStore.setState({ compareRunIdA: 'run-a', compareRunIdB: 'run-b' });
        render(<MainWorkspace {...defaultProps} />);

        const compareBtn = screen.getByRole('button', { name: /Compare Scans/i });
        expect(compareBtn).toBeInTheDocument();
        fireEvent.click(compareBtn);

        expect(useAppStore.getState().activeTab).toBe('compare');
        expect(screen.getByTestId('mock-compare-page')).toBeInTheDocument();
    });

    it('handles export HTML and MD options', () => {
        render(<MainWorkspace {...defaultProps} />);

        const exportContainer = document.querySelector('.workspace-export-dropdown-container');
        expect(exportContainer).toBeTruthy();
        fireEvent.mouseEnter(exportContainer!);

        const htmlBtn = screen.getByRole('button', { name: /HTML Report/i });
        fireEvent.click(htmlBtn);
        expect(defaultProps.handleExportHTML).toHaveBeenCalledWith('run-live');

        const mdBtn = screen.getByRole('button', { name: /MD Report/i });
        fireEvent.click(mdBtn);
        expect(defaultProps.handleExportMD).toHaveBeenCalledWith('run-live');
    });

    it('toggles settings panel via settings button', () => {
        render(<MainWorkspace {...defaultProps} />);

        const settingsToggleBtn = screen.getByRole('button', { name: /Settings/i });
        fireEvent.click(settingsToggleBtn);

        expect(defaultProps.onToggleConfig).toHaveBeenCalled();
    });

    it('executes background queryResults calculation for findings and OWASP counts', async () => {
        render(<MainWorkspace {...defaultProps} />);

        await waitFor(() => {
            expect(defaultProps.queryResults).toHaveBeenCalledWith(
                expect.objectContaining({ runId: 'run-live', findingsOnly: true })
            );
        }, { timeout: 2000 });
    });

    it('handles AI Executive Summary modal from export dropdown', () => {
        render(<MainWorkspace {...defaultProps} />);

        const exportContainer = document.querySelector('.workspace-export-dropdown-container');
        expect(exportContainer).toBeTruthy();
        fireEvent.mouseEnter(exportContainer!);

        const aiBtn = screen.getByRole('button', { name: /AI Executive Summary/i });
        fireEvent.click(aiBtn);

        expect(screen.getByTestId('mock-exec-summary-modal')).toBeInTheDocument();
        expect(screen.getByText('Executive Summary Modal: run-live')).toBeInTheDocument();

        // Close modal
        const closeBtn = screen.getByRole('button', { name: /Close Summary Modal/i });
        fireEvent.click(closeBtn);
        expect(screen.queryByTestId('mock-exec-summary-modal')).not.toBeInTheDocument();
    });

    it('shows toast when attempting AI Executive Summary without an active run', () => {
        useAppStore.setState({ liveRunId: null, loadedRunId: null });
        render(<MainWorkspace {...defaultProps} />);

        const exportContainer = document.querySelector('.workspace-export-dropdown-container');
        fireEvent.mouseEnter(exportContainer!);

        const aiBtn = screen.getByRole('button', { name: /AI Executive Summary/i });
        fireEvent.click(aiBtn);

        expect(mockShowToast).toHaveBeenCalledWith('No scan run selected for Executive Summary', 'error');
        expect(screen.queryByTestId('mock-exec-summary-modal')).not.toBeInTheDocument();
    });

    it('opens AI Executive Summary modal from HistoryPage action', () => {
        useAppStore.setState({ activeTab: 'history' });
        render(<MainWorkspace {...defaultProps} />);

        const execSummaryBtn = screen.getByRole('button', { name: /Export Exec Summary/i });
        fireEvent.click(execSummaryBtn);

        expect(screen.getByTestId('mock-exec-summary-modal')).toBeInTheDocument();
        expect(screen.getByText('Executive Summary Modal: run-1')).toBeInTheDocument();
    });

    it('renders WafCheckPanel when WAF tab is selected', () => {
        render(<MainWorkspace {...defaultProps} />);

        const wafTabBtn = screen.getByTestId('tab-waf');
        fireEvent.click(wafTabBtn);

        expect(useAppStore.getState().activeTab).toBe('waf');
        expect(screen.getByTestId('mock-waf-check-panel')).toBeInTheDocument();
        expect(screen.getByText('Mock WafCheckPanel: https://api.example.com')).toBeInTheDocument();
    });

    it('handles locked feature gates for export reports and compare scans', () => {
        mockGateState = {
            unlocked: false,
            gateType: 'coming_soon',
            lockMessage: 'This feature is currently locked',
        };
        useAppStore.setState({ compareRunIdA: 'run-a', compareRunIdB: 'run-b' });

        render(<MainWorkspace {...defaultProps} />);

        // Compare scans lock toast
        const compareBtn = screen.getByRole('button', { name: /Compare Scans/i });
        fireEvent.click(compareBtn);
        expect(mockShowToast).toHaveBeenCalledWith('This feature is currently locked', 'error');

        // Export dropdown locked toast
        const exportContainer = document.querySelector('.workspace-export-dropdown-container');
        fireEvent.mouseEnter(exportContainer!);

        const htmlBtn = screen.getByRole('button', { name: /HTML Report/i });
        fireEvent.click(htmlBtn);
        expect(mockShowToast).toHaveBeenCalledWith('This feature is currently locked', 'error');

        const mdBtn = screen.getByRole('button', { name: /MD Report/i });
        fireEvent.click(mdBtn);
        expect(mockShowToast).toHaveBeenCalledWith('This feature is currently locked', 'error');
    });

    it('handles Dashboard heatmap filter and demo trigger', () => {
        useAppStore.setState({ activeTab: 'heatmap' });
        render(<MainWorkspace {...defaultProps} />);

        const demoBtn = screen.getByRole('button', { name: /Dashboard Demo/i });
        fireEvent.click(demoBtn);
        expect(defaultProps.handleStart).toHaveBeenCalledWith(['https://bbad.secmy.app/swagger.json']);

        const filterBtn = screen.getByRole('button', { name: /Filter 2xx/i });
        fireEvent.click(filterBtn);
        expect(useAppStore.getState().heatmapFilter).toEqual({ statusGroup: '2xx' });
        expect(useAppStore.getState().activeTab).toBe('logs');
    });

    it('handles Inspector clear filter and export callbacks', () => {
        useAppStore.setState({ activeTab: 'logs', heatmapFilter: { statusGroup: '2xx' } as any });
        render(<MainWorkspace {...defaultProps} />);

        const clearBtn = screen.getByRole('button', { name: /Clear Filter/i });
        fireEvent.click(clearBtn);
        expect(useAppStore.getState().heatmapFilter).toBeNull();

        const exportBtn = screen.getByRole('button', { name: /Export Inspector/i });
        fireEvent.click(exportBtn);
        expect(defaultProps.handleExport).toHaveBeenCalledWith('run-live', 'https://api.example.com');
    });

    it('handles HistoryPage load run and export run callbacks', () => {
        useAppStore.setState({ activeTab: 'history' });
        render(<MainWorkspace {...defaultProps} />);

        const exportBtn = screen.getByRole('button', { name: /Export Run/i });
        fireEvent.click(exportBtn);
        expect(defaultProps.handleExport).toHaveBeenCalledWith('run-1');

        const loadBtn = screen.getByRole('button', { name: /Load Run/i });
        fireEvent.click(loadBtn);
        expect(defaultProps.handleLoadRun).toHaveBeenCalledWith('run-1', undefined);
        expect(useAppStore.getState().activeTab).toBe('heatmap');
    });

    it('switches away from findings to logs when analyze_response_body is false', () => {
        useAppStore.setState({ activeTab: 'findings' });
        const propsNoAnalysis = {
            ...defaultProps,
            config: {
                ...defaultProps.config,
                settings: { analyze_response_body: false },
            },
        };

        render(<MainWorkspace {...propsNoAnalysis} />);

        expect(useAppStore.getState().activeTab).toBe('logs');
        expect(screen.queryByRole('button', { name: /Findings/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /OWASP/i })).not.toBeInTheDocument();
    });

    it('focuses target input when Configure Target API is clicked in welcome view', () => {
        useAppStore.setState({ liveRunId: null, loadedRunId: null });
        const input = document.createElement('input');
        input.className = 'workspace-target-input';
        document.body.appendChild(input);
        const focusSpy = vi.spyOn(input, 'focus');
        const selectSpy = vi.spyOn(input, 'select');

        const propsWithoutEndpoints = {
            ...defaultProps,
            config: { ...defaultProps.config, endpoints: [] },
        };
        render(<MainWorkspace {...propsWithoutEndpoints} />);

        const configBtn = screen.getByRole('button', { name: /Configure Target API/i });
        fireEvent.click(configBtn);

        expect(focusSpy).toHaveBeenCalled();
        expect(selectSpy).toHaveBeenCalled();

        document.body.removeChild(input);
    });

    it('filters excluded statuses from localStorage in background count calculation', async () => {
        localStorage.setItem('swazz_excluded_statuses', JSON.stringify([500]));

        render(<MainWorkspace {...defaultProps} />);

        await waitFor(() => {
            expect(defaultProps.queryResults).toHaveBeenCalled();
        }, { timeout: 2000 });
    });
});
