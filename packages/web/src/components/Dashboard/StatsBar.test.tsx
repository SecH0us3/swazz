// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { StatsBar } from './StatsBar.js';
import type { RunStats } from '../../types.js';

describe('StatsBar Component', () => {
    const createMockStats = (overrides?: Partial<RunStats>): RunStats => ({
        requestsPerSecond: 125.4,
        totalRequests: 500,
        totalPlanned: 1000,
        totalDurationMs: 25000,
        totalResponseBytes: 1048576 * 2.5, // 2.5 MB
        maxResponseSize: 65536, // 64 KB
        statusCounts: {
            200: 300,
            204: 50,
            400: 30,
            404: 20,
            500: 10,
            502: 5,
        },
        profileCounts: {
            RANDOM: 200,
            BOUNDARY: 200,
            MALICIOUS: 100,
        },
        endpointCounts: {},
        startTime: Date.now() - 25000,
        isRunning: false,
        progress: {
            completedEndpoints: 5,
            totalEndpoints: 10,
            currentEndpoint: 'GET /api/users',
            currentProfile: 'MALICIOUS',
        },
        ...overrides,
    });

    it('renders basic request metrics accurately', () => {
        const stats = createMockStats();
        render(<StatsBar stats={stats} isRunning={false} />);

        // RPS (125.4)
        expect(screen.getByText('Req / sec')).toBeInTheDocument();
        expect(screen.getByText('125.4')).toBeInTheDocument();

        // Total requests (500)
        expect(screen.getByText('Total')).toBeInTheDocument();
        expect(screen.getByText('500')).toBeInTheDocument();

        // 2xx count (300 + 50 = 350)
        expect(screen.getByText('2xx Success')).toBeInTheDocument();
        expect(screen.getByText('350')).toBeInTheDocument();

        // 4xx count (30 + 20 = 50)
        expect(screen.getByText('4xx Client')).toBeInTheDocument();
        expect(screen.getByText('50')).toBeInTheDocument();

        // 5xx count (10 + 5 = 15) with CRASHES label and has-errors class
        expect(screen.getByText('5xx CRASHES')).toBeInTheDocument();
        expect(screen.getByText('15')).toBeInTheDocument();

        // Avg response (25000 / 500 = 50 ms)
        expect(screen.getByText('Avg Response')).toBeInTheDocument();
        expect(screen.getByText('50 ms')).toBeInTheDocument();

        // Data received formatting (2.5 MB)
        expect(screen.getByText('Data Received')).toBeInTheDocument();
        expect(screen.getByText('2.5 MB')).toBeInTheDocument();

        // Max response size (64 KB)
        expect(screen.getByText('Max Response')).toBeInTheDocument();
        expect(screen.getByText('64 KB')).toBeInTheDocument();
    });

    it('renders 5xx Errors label when no 5xx errors exist', () => {
        const stats = createMockStats({
            statusCounts: { '200': 100 },
        });
        render(<StatsBar stats={stats} isRunning={false} />);

        expect(screen.getByText('5xx Errors')).toBeInTheDocument();
        expect(screen.queryByText('5xx CRASHES')).not.toBeInTheDocument();
    });

    it('shows progress strip when isRunning is true and totalEndpoints > 0', () => {
        const stats = createMockStats({
            progress: {
                completedEndpoints: 3,
                totalEndpoints: 6,
                currentEndpoint: 'POST /api/login',
                currentProfile: 'BOUNDARY',
            },
        });
        render(<StatsBar stats={stats} isRunning={true} />);

        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('3/6 endpoints')).toBeInTheDocument();
        expect(screen.getByText('BOUNDARY')).toBeInTheDocument();
        expect(screen.getByText('POST /api/login')).toBeInTheDocument();
    });

    it('hides progress strip when isRunning is false', () => {
        const stats = createMockStats();
        render(<StatsBar stats={stats} isRunning={false} />);

        expect(screen.queryByText('5/10 endpoints')).not.toBeInTheDocument();
    });

    it('handles zero requests, zero duration, and zero bytes cleanly', () => {
        const stats = createMockStats({
            totalRequests: 0,
            totalDurationMs: 0,
            totalResponseBytes: 0,
            maxResponseSize: 0,
            statusCounts: {},
            progress: {
                completedEndpoints: 0,
                totalEndpoints: 0,
                currentEndpoint: '',
                currentProfile: '',
            },
        });
        render(<StatsBar stats={stats} isRunning={true} />);

        expect(screen.getByText('0 ms')).toBeInTheDocument();
        const zeroBytesEls = screen.getAllByText('0 B');
        expect(zeroBytesEls.length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('0/0 endpoints')).not.toBeInTheDocument();
    });
});
