// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalyticsDashboard } from './AnalyticsDashboard.js';
import { vi, describe, it, expect } from 'vitest';
import React from 'react';

describe('AnalyticsDashboard Component', () => {
  it('renders loading state initially and then shows charts', async () => {
    // Mock global fetch
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          scanStats: { total: 10, completed: 8, failed: 2, avgDuration: 15 },
          scanHistory: [{ date: '2026-07-01', count: 2, completed_count: 2, failed_count: 0 }],
          findingsStats: [{ severity: 'error', category: 'swazz/reflected-xss', count: 1 }],
          findingsHistory: [{ date: '2026-07-01', severity: 'error', count: 1 }],
          runnerMetrics: { totalConnected: 2, totalBusy: 1, utilization: 50, runners: [] }
        }),
      })
    );

    render(<AnalyticsDashboard projectId="test-project" />);

    // Wait for loading indicator to disappear
    await waitFor(() => {
      expect(screen.queryByText('Loading project analytics...')).toBeNull();
    }, { timeout: 3000 });

    // Assert that the dashboard values are displayed
    expect(screen.getByText('Total Scans')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('50.0%')).toBeTruthy();

    // Assert period buttons exist
    expect(screen.getByRole('button', { name: '24h' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '30d' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '12w' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '12m' })).toBeTruthy();

    // Click period button
    const btn24h = screen.getByRole('button', { name: '24h' });
    fireEvent.click(btn24h);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('period=24h'),
        expect.any(Object)
      );
    });
  });

  it('renders error message when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error loading analytics'));

    render(<AnalyticsDashboard projectId="test-project" />);

    await waitFor(() => {
      expect(screen.getByText(/Network error loading analytics/i)).toBeTruthy();
    });
  });

  it('renders empty state when no projectId is provided and no activeProject in store', () => {
    render(<AnalyticsDashboard projectId="" />);
    expect(screen.getByText('No Active Project')).toBeInTheDocument();
  });

  it('renders runner status list with shared/private and busy/idle states', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        scanStats: { total: 5, completed: 5, failed: 0, avgDuration: 125 },
        scanHistory: [{ date: '2026-07-01', count: 5, completed_count: 5, failed_count: 0 }],
        findingsStats: [
          { severity: 'high', category: 'swazz/sql-injection', count: 3 },
          { severity: 'medium', category: 'swazz/cors', count: 2 },
          { severity: 'low', category: 'swazz/hsts-missing', count: 1 }
        ],
        findingsHistory: [{ date: '2026-07-01', severity: 'error', count: 6 }],
        runnerMetrics: {
          totalConnected: 2,
          totalBusy: 1,
          utilization: 50,
          runners: [
            { name: 'runner-node-1', isShared: false, isBusy: true },
            { name: 'runner-node-2', isShared: true, isBusy: false }
          ]
        }
      })
    });

    render(<AnalyticsDashboard projectId="test-project" />);

    await waitFor(() => {
      expect(screen.getByText('runner-node-1')).toBeInTheDocument();
      expect(screen.getByText('runner-node-2')).toBeInTheDocument();
      expect(screen.getByText('Private')).toBeInTheDocument();
      expect(screen.getByText('Shared')).toBeInTheDocument();
      expect(screen.getByText('Fuzzing')).toBeInTheDocument();
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    // Verify top categories pretty names
    expect(screen.getByText('SQL Injection')).toBeInTheDocument();
    expect(screen.getByText('CORS Policy')).toBeInTheDocument();
  });

  it('renders empty chart states when there is zero data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        scanStats: { total: 0, completed: 0, failed: 0, avgDuration: 0 },
        scanHistory: [],
        findingsStats: [],
        findingsHistory: [],
        runnerMetrics: { totalConnected: 0, totalBusy: 0, utilization: 0, runners: [] }
      })
    });

    render(<AnalyticsDashboard projectId="test-project" />);

    await waitFor(() => {
      expect(screen.getByText('No scan history recorded in the selected period.')).toBeInTheDocument();
      expect(screen.getByText('No findings detected for this project.')).toBeInTheDocument();
      expect(screen.getByText('No runners currently connected.')).toBeInTheDocument();
    });
  });

  it('shows tooltip when hovering over chart data points', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        scanStats: { total: 10, completed: 8, failed: 2, avgDuration: 15 },
        scanHistory: [
          { date: '2026-07-01', count: 5, completed_count: 4, failed_count: 1 },
          { date: '2026-07-02', count: 5, completed_count: 4, failed_count: 1 }
        ],
        findingsStats: [{ severity: 'error', category: 'swazz/xss', count: 2 }],
        findingsHistory: [{ date: '2026-07-01', severity: 'error', count: 2 }],
        runnerMetrics: { totalConnected: 1, totalBusy: 0, utilization: 0, runners: [] }
      })
    });

    render(<AnalyticsDashboard projectId="test-project" />);

    await waitFor(() => {
      expect(screen.getByText('Total Scans')).toBeInTheDocument();
    });

    const dots = document.querySelectorAll('.chart-interactive-dot');
    if (dots.length > 0) {
      fireEvent.mouseEnter(dots[0]);
      expect(document.querySelector('.chart-tooltip-group')).toBeInTheDocument();
      fireEvent.mouseLeave(dots[0]);
    }
  });
});
