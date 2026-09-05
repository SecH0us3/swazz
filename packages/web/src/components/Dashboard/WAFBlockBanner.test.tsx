// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { WAFBlockBanner } from './WAFBlockBanner';
import type { RunStats } from '../../types';

function makeStats(over: Partial<RunStats>): RunStats {
    return {
        totalRequests: 0,
        totalPlanned: 0,
        requestsPerSecond: 0,
        statusCounts: {},
        profileCounts: {} as any,
        endpointCounts: {},
        startTime: 0,
        isRunning: false,
        totalResponseBytes: 0,
        maxResponseSize: 0,
        totalDurationMs: 0,
        progress: { completedEndpoints: 0, totalEndpoints: 0, currentEndpoint: '', currentProfile: '' },
        ...over,
    } as RunStats;
}

const detectedCloudflare = { detected: true, wafType: 'Cloudflare', confidence: 95, evidence: [], suggestedBypassTechniques: [] };
const wafCheck = (detected = true) => ({
    detection: { ...detectedCloudflare, detected },
    bypassOpportunities: {} as any,
    timestamp: '',
});

describe('WAFBlockBanner', () => {
    it('attributes blocking to the WAF when attack traffic is blocked far more than baseline', () => {
        const stats = makeStats({
            totalRequests: 200,
            wafCheck: wafCheck(),
            statusByProfile: {
                MALICIOUS: { 200: 10, 403: 90 }, // 90% blocked
                RANDOM: { 200: 95, 403: 5 }, // 5% blocked — benign gets through
            },
        });
        render(<WAFBlockBanner stats={stats} />);
        const banner = screen.getByTestId('waf-block-banner');
        expect(banner).toHaveTextContent("Cloudflare is blocking 90% of this scan's attack traffic");
        expect(banner).toHaveTextContent('versus 5% of benign baseline traffic');
    });

    it('does NOT fire when baseline is blocked just as much (auth, not the WAF)', () => {
        const stats = makeStats({
            totalRequests: 200,
            wafCheck: wafCheck(),
            statusByProfile: {
                MALICIOUS: { 403: 90, 200: 10 }, // 90%
                RANDOM: { 403: 88, 200: 12 }, // 88% — everything is 403'd, looks like auth
            },
        });
        render(<WAFBlockBanner stats={stats} />);
        expect(screen.queryByTestId('waf-block-banner')).not.toBeInTheDocument();
    });

    it('fires on attack threshold alone when there is no baseline profile', () => {
        const stats = makeStats({
            totalRequests: 100,
            wafCheck: wafCheck(),
            statusByProfile: { MALICIOUS: { 403: 70, 200: 30 } }, // 70%, no RANDOM present
        });
        render(<WAFBlockBanner stats={stats} />);
        expect(screen.getByTestId('waf-block-banner')).toHaveTextContent("blocking 70% of this scan's attack traffic");
    });

    it('does not fire when no WAF was detected, even with heavy attack blocking', () => {
        const stats = makeStats({
            totalRequests: 100,
            wafCheck: wafCheck(false),
            statusByProfile: { MALICIOUS: { 403: 90, 200: 10 }, RANDOM: { 200: 100 } },
        });
        render(<WAFBlockBanner stats={stats} />);
        expect(screen.queryByTestId('waf-block-banner')).not.toBeInTheDocument();
    });

    it('does not fire when attack block rate is below threshold', () => {
        const stats = makeStats({
            totalRequests: 100,
            wafCheck: wafCheck(),
            statusByProfile: { MALICIOUS: { 200: 80, 403: 20 }, RANDOM: { 200: 100 } }, // 20% < 40%
        });
        render(<WAFBlockBanner stats={stats} />);
        expect(screen.queryByTestId('waf-block-banner')).not.toBeInTheDocument();
    });

    it('renders nothing when statusByProfile is absent', () => {
        const stats = makeStats({ totalRequests: 100, wafCheck: wafCheck(), statusCounts: { 403: 90 } });
        const { container } = render(<WAFBlockBanner stats={stats} />);
        expect(container).toBeEmptyDOMElement();
    });
});
