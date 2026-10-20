// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanIssueBanner } from './ScanIssueBanner.js';
import { useAppStore } from '../store/appStore.js';
import { readDismissedScanIssues } from '../utils/scheduledFailures.js';

describe('ScanIssueBanner', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.setState({ scanIssue: null, activeTab: 'heatmap', loadedRunId: null });
    });

    it('renders nothing without an issue', () => {
        const { container } = render(<ScanIssueBanner />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows why the scan failed, what to change, and takes the user there', () => {
        useAppStore.setState({
            scanIssue: {
                level: 'error',
                title: 'The scan failed',
                details: ['could not connect to the MCP server: status 401'],
                hint: { text: 'Add the token in Global Headers.', action: { label: 'Open Project Settings', tab: 'project_settings' } },
            },
        });
        render(<ScanIssueBanner />);
        expect(screen.getByRole('alert')).toHaveTextContent('The scan failed');
        expect(screen.getByText('could not connect to the MCP server: status 401')).toBeInTheDocument();
        expect(screen.getByText('Add the token in Global Headers.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Open Project Settings' }));
        expect(useAppStore.getState().activeTab).toBe('project_settings');
        fireEvent.click(screen.getByRole('button', { name: 'Open runner logs' }));
        expect(useAppStore.getState().activeTab).toBe('runner_logs');
    });

    it('renders runner text as text, never as markup', () => {
        useAppStore.setState({ scanIssue: { level: 'error', title: 'The scan failed', details: ['<img src=x onerror=alert(1)>'], hint: null } });
        const { container } = render(<ScanIssueBanner />);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });

    it('is a status, not an alert, for warnings', () => {
        useAppStore.setState({ scanIssue: { level: 'warning', title: 'The scan completed with 2 warnings', details: [], hint: null } });
        render(<ScanIssueBanner />);
        expect(screen.getByRole('status')).toHaveTextContent('2 warnings');
    });

    it('remembers dismissing an issue about a scheduled scan, and points to History', () => {
        useAppStore.setState({ scanIssue: { level: 'error', title: 'The last scheduled scan failed', details: ['x'], hint: null, scanId: 'sched-1' } });
        render(<ScanIssueBanner />);
        fireEvent.click(screen.getByRole('button', { name: 'Open History' }));
        expect(useAppStore.getState().activeTab).toBe('history');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(useAppStore.getState().scanIssue).toBeNull();
        expect(readDismissedScanIssues().has('sched-1')).toBe(true);
    });
});
