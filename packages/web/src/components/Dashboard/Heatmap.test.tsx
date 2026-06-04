import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Heatmap } from './Heatmap.js';
import type { RunStats } from '../../types.js';

describe('Heatmap Component', () => {
    const mockStats: RunStats = {
        totalRequests: 10,
        totalPlanned: 100,
        requestsPerSecond: 2.5,
        statusCounts: { 200: 5, 404: 3, 500: 2 },
        profileCounts: { RANDOM: 10, BOUNDARY: 0, MALICIOUS: 0 },
        endpointCounts: {
            'GET /users': { 200: 5, 404: 2 },
            'POST /users': { 500: 2 },
            'GET /posts': { 404: 1 }
        },
        startTime: Date.now(),
        isRunning: false,
        totalResponseBytes: 1000,
        maxResponseSize: 200,
        totalDurationMs: 1000,
        progress: {
            completedEndpoints: 2,
            totalEndpoints: 3,
            currentEndpoint: 'GET /posts',
            currentProfile: 'RANDOM'
        }
    };

    const endpointKeys = ['GET /users', 'POST /users', 'GET /posts'];

    it('renders endpoints and their cells', () => {
        render(
            <Heatmap
                stats={mockStats}
                endpointKeys={endpointKeys}
                activeFilter={null}
                onCellClick={() => {}}
            />
        );

        // Verify title is rendered
        expect(screen.getByText('Endpoint × Status Heatmap')).toBeTruthy();

        // Verify endpoints are rendered
        expect(screen.getAllByText('GET').length).toBe(2);
        expect(screen.getAllByText('/users').length).toBe(2);
        expect(screen.getByText('POST')).toBeTruthy();
        expect(screen.getByText('/posts')).toBeTruthy();
    });

    it('filters endpoints by search text', () => {
        render(
            <Heatmap
                stats={mockStats}
                endpointKeys={endpointKeys}
                activeFilter={null}
                onCellClick={() => {}}
            />
        );

        const searchInput = screen.getByPlaceholderText('Filter endpoints…');
        fireEvent.change(searchInput, { target: { value: 'posts' } });

        // /posts should be visible
        expect(screen.getByText('/posts')).toBeTruthy();

        // /users should NOT be visible
        expect(screen.queryByText('/users')).toBeNull();
    });

    it('filters status codes and endpoints by status buckets', () => {
        render(
            <Heatmap
                stats={mockStats}
                endpointKeys={endpointKeys}
                activeFilter={null}
                onCellClick={() => {}}
            />
        );

        // Click on '5xx' bucket
        const btn5xx = screen.getByRole('button', { name: '5xx' });
        fireEvent.click(btn5xx);

        // Only POST /users (which has a 500 response) should be shown, GET /users has 200 and 404 but no 500, so it's filtered out
        expect(screen.getByText('POST')).toBeTruthy();
        expect(screen.queryByText('GET')).toBeNull();
    });

    it('calls onCellClick when a clickable cell is clicked', () => {
        const onCellClickSpy = vi.fn();
        render(
            <Heatmap
                stats={mockStats}
                endpointKeys={endpointKeys}
                activeFilter={null}
                onCellClick={onCellClickSpy}
            />
        );

        const row = screen.getByTitle('GET /users').closest('.heatmap-row')!;
        const cells = row.querySelectorAll('.heatmap-cell');
        
        // click 200 cell (index 0 since sorted status codes are [200, 404, 500])
        fireEvent.click(cells[0]);
        expect(onCellClickSpy).toHaveBeenCalledWith({
            method: 'GET',
            path: '/users',
            status: 200
        });
    });

    it('clears active filter when clicking the already active cell', () => {
        const onCellClickSpy = vi.fn();
        render(
            <Heatmap
                stats={mockStats}
                endpointKeys={endpointKeys}
                activeFilter={{ method: 'GET', path: '/users', status: 200 }}
                onCellClick={onCellClickSpy}
            />
        );

        const row = screen.getByTitle('GET /users').closest('.heatmap-row')!;
        const cells = row.querySelectorAll('.heatmap-cell');
        
        // click the active cell (200 cell at index 0)
        fireEvent.click(cells[0]);
        expect(onCellClickSpy).toHaveBeenCalledWith(null);
    });

    it('does not trigger click action for cells with 0 counts', () => {
        const onCellClickSpy = vi.fn();
        render(
            <Heatmap
                stats={mockStats}
                endpointKeys={endpointKeys}
                activeFilter={null}
                onCellClick={onCellClickSpy}
            />
        );

        const row = screen.getByTitle('POST /users').closest('.heatmap-row')!;
        const cells = row.querySelectorAll('.heatmap-cell');
        // POST /users only has 500 status (index 2). 200 (index 0) has 0 count.
        fireEvent.click(cells[0]);
        expect(onCellClickSpy).not.toHaveBeenCalled();
    });
});
