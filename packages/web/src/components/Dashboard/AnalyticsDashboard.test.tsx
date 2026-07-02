import { render, screen, waitFor } from '@testing-library/react';
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
  });
});
