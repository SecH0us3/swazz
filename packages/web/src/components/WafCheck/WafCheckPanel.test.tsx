// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { WafCheckPanel } from './WafCheckPanel';
import { useConfig } from '../../hooks/useConfig.js';
import { useAppStore } from '../../store/appStore.js';

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: vi.fn(),
}));

describe('WafCheckPanel Component', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                base_url: 'https://example.com',
                settings: {
                    waf_check_enabled: true,
                },
            },
        });

        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);
        useAppStore.setState({ csrfToken: 'test-csrf-token' });
        if (typeof localStorage !== 'undefined' && localStorage) {
            localStorage.clear();
        }
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders toolbar with Run button and editable target input initialized from config.base_url', () => {
        render(<WafCheckPanel />);

        expect(screen.getByTestId('waf-check-panel')).toBeInTheDocument();
        const runBtn = screen.getByTestId('run-waf-check-btn');
        expect(runBtn).toBeInTheDocument();
        expect(runBtn).toBeEnabled();
        expect(runBtn).toHaveTextContent('Run WAF Check');

        const input = screen.getByTestId('waf-target-input') as HTMLInputElement;
        expect(input.value).toBe('https://example.com');
    });

    it('uses targetUrl prop when provided, overriding config.base_url', () => {
        render(<WafCheckPanel targetUrl="https://override.example.com" />);

        const input = screen.getByTestId('waf-target-input') as HTMLInputElement;
        expect(input.value).toBe('https://override.example.com');
    });

    it('disables Run button and keeps input empty when no target URL is available', () => {
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                base_url: '',
            },
        });

        render(<WafCheckPanel targetUrl="" />);

        const runBtn = screen.getByTestId('run-waf-check-btn');
        expect(runBtn).toBeDisabled();

        const input = screen.getByTestId('waf-target-input') as HTMLInputElement;
        expect(input.value).toBe('');
    });

    it('allows editing target URL locally without modifying config.base_url and uses edited value', async () => {
        const mockConfig = {
            base_url: 'https://example.com',
            settings: { waf_check_enabled: true },
        };
        const mockUpdateSettings = vi.fn();
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: mockConfig,
            updateSettings: mockUpdateSettings,
        });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                detection: { detected: false, wafType: 'None', confidence: 0, evidence: [] },
                recommendation: 'No WAF detected for edited domain',
            }),
        });

        render(<WafCheckPanel />);

        const input = screen.getByTestId('waf-target-input');
        fireEvent.change(input, { target: { value: 'https://custom-target.org' } });

        // Confirm config was NOT mutated
        expect(mockConfig.base_url).toBe('https://example.com');
        expect(mockUpdateSettings).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('run-waf-check-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('waf-check-recommendation')).toBeInTheDocument();
        });

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/waf-check'),
            expect.objectContaining({
                body: JSON.stringify({ url: 'https://custom-target.org' }),
            })
        );
    });

    it('triggers check when pressing Enter inside target input', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                detection: { detected: false, wafType: 'None', confidence: 0, evidence: [] },
                recommendation: 'Checked via Enter key',
            }),
        });

        render(<WafCheckPanel />);
        const input = screen.getByTestId('waf-target-input');
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(screen.getByTestId('waf-check-recommendation')).toBeInTheDocument();
        });

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/waf-check'),
            expect.objectContaining({
                body: JSON.stringify({ url: 'https://example.com' }),
            })
        );
    });

    it('sends POST /api/waf-check with target url and CSRF / Auth tokens', async () => {
        if (typeof localStorage !== 'undefined' && localStorage) {
            localStorage.setItem('swazz_token', 'jwt-token-xyz');
        }

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                detection: { detected: false, wafType: 'None', confidence: 0, evidence: [] },
                recommendation: 'No WAF detected for this target',
            }),
        });

        render(<WafCheckPanel />);
        fireEvent.click(screen.getByTestId('run-waf-check-btn'));

        expect(screen.getByTestId('waf-check-loading')).toBeInTheDocument();
        expect(screen.getByText(/Detecting WAF vendor/i)).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByTestId('waf-check-recommendation')).toBeInTheDocument();
        });

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/waf-check'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer jwt-token-xyz',
                    'X-CSRF-Token': 'test-csrf-token',
                }),
                body: JSON.stringify({ url: 'https://example.com' }),
            })
        );
    });

    it('renders error card when WAF check request fails', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 502,
            json: async () => ({ error: 'WAF service unreachable' }),
        });

        render(<WafCheckPanel />);
        fireEvent.click(screen.getByTestId('run-waf-check-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('waf-check-error')).toBeInTheDocument();
        });

        expect(screen.getByText('Check Failed')).toBeInTheDocument();
        expect(screen.getByText('WAF service unreachable')).toBeInTheDocument();
    });

    it('renders No WAF Detected card with recommendation and vendor chips', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                detection: { detected: false, wafType: 'None', confidence: 0, evidence: [] },
                recommendation: 'This target has no Web Application Firewall protecting it. Consider enabling one.',
            }),
        });

        render(<WafCheckPanel />);
        fireEvent.click(screen.getByTestId('run-waf-check-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('waf-check-recommendation')).toBeInTheDocument();
        });

        expect(screen.getByText('No WAF Detected')).toBeInTheDocument();
        expect(screen.getByText(/This target has no Web Application Firewall protecting it/i)).toBeInTheDocument();
        expect(screen.getByText('Cloudflare')).toBeInTheDocument();
        expect(screen.getByText('AWS WAF')).toBeInTheDocument();
        expect(screen.getByText('ModSecurity')).toBeInTheDocument();

        expect(screen.queryByTestId('waf-stats-row')).not.toBeInTheDocument();
        expect(screen.queryByTestId('waf-sensitive-files-table')).not.toBeInTheDocument();
    });

    it('renders full WAF detected view with confidence ring, evidence toggle, stats row, table, and patches', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                detection: {
                    detected: true,
                    wafType: 'Cloudflare',
                    confidence: 95,
                    evidence: ['cf-ray: 88ab1234', 'server: cloudflare'],
                },
                sensitiveFiles: {
                    total: 3,
                    results: [
                        { category: 'Sensitive Files', method: 'GET', status: 200, payload: '.env', durationMs: 112 },
                        { category: 'Sensitive Files', method: 'GET', status: 404, payload: 'composer.json', durationMs: 56 },
                        { category: 'Sensitive Files', method: 'GET', status: 403, payload: '.git/HEAD', durationMs: 45 },
                    ],
                },
                patches: {
                    targetUrl: 'https://example.com',
                    generatedAt: '2026-09-04T12:00:00Z',
                    totalBypasses: 2,
                    bundles: {
                        cloudflare: {
                            vendor: 'cloudflare',
                            native: 'http.request.uri.path contains "composer.json"',
                            terraform: 'resource "cloudflare_ruleset" "waf" {}',
                            ruleCount: 1,
                        },
                    },
                },
            }),
        });

        render(<WafCheckPanel />);
        fireEvent.click(screen.getByTestId('run-waf-check-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('waf-check-detected')).toBeInTheDocument();
        });

        // WAF detected title and vendor
        const titleEl = screen.getByText(/Protected by/i);
        expect(titleEl).toBeInTheDocument();
        expect(titleEl).toHaveTextContent('Cloudflare');
        expect(screen.getByTestId('waf-vendor-tab-cloudflare')).toBeInTheDocument();

        // Confidence ring displaying 95%
        const ring = screen.getByTestId('waf-confidence-ring');
        expect(ring).toHaveTextContent('95%');
        expect(ring.getAttribute('style')).toContain('--pct: 95');

        // Evidence toggle
        const evidenceBtn = screen.getByTestId('waf-evidence-toggle-btn');
        expect(evidenceBtn).toHaveTextContent('Show evidence (2)');
        expect(screen.queryByTestId('waf-evidence-list')).not.toBeInTheDocument();

        fireEvent.click(evidenceBtn);
        expect(screen.getByTestId('waf-evidence-list')).toBeInTheDocument();
        expect(screen.getByText('cf-ray: 88ab1234')).toBeInTheDocument();
        expect(screen.getByText('server: cloudflare')).toBeInTheDocument();

        fireEvent.click(evidenceBtn);
        expect(screen.queryByTestId('waf-evidence-list')).not.toBeInTheDocument();

        // Stats row: 3 checked, 2 not blocked by the WAF (200 + 404), 1 blocked (403).
        // The header badge separately reports that only 1 of those is an actual leak.
        const statsRow = screen.getByTestId('waf-stats-row');
        expect(statsRow).toBeInTheDocument();
        expect(statsRow).toHaveTextContent('3Paths Checked');
        expect(statsRow).toHaveTextContent('2Not Blocked');
        expect(statsRow).toHaveTextContent('1Blocked');
        expect(screen.getByTestId('waf-files-section-toggle')).toHaveTextContent('1 exposed');

        // Sensitive files section is collapsed by default
        expect(screen.getByTestId('waf-sensitive-files-table')).toBeInTheDocument();
        expect(screen.queryByText('.env')).not.toBeInTheDocument();

        // Expand it — defaults to not-blocked (status 200 and 404 visible, 403 hidden)
        fireEvent.click(screen.getByTestId('waf-files-section-toggle'));
        expect(screen.getByText('.env')).toBeInTheDocument();
        expect(screen.getByText('composer.json')).toBeInTheDocument();
        expect(screen.queryByText('.git/HEAD')).not.toBeInTheDocument();

        // Toggle to show all paths
        const toggleFilesBtn = screen.getByTestId('waf-files-toggle-btn');
        expect(toggleFilesBtn).toHaveTextContent('Show all 3 checked paths →');

        fireEvent.click(toggleFilesBtn);
        expect(screen.getByText('.git/HEAD')).toBeInTheDocument();
        expect(screen.getByText('403')).toBeInTheDocument();
        expect(toggleFilesBtn).toHaveTextContent('Show not blocked only');

        // Re-collapse
        fireEvent.click(toggleFilesBtn);
        expect(screen.queryByText('.git/HEAD')).not.toBeInTheDocument();

        // WafPatchViewer integration
        expect(screen.getByTestId('waf-patch-viewer')).toBeInTheDocument();
        expect(screen.getByText('WAF Mitigation Rules')).toBeInTheDocument();
        expect(screen.getByTestId('waf-patch-native')).toHaveTextContent('http.request.uri.path contains "composer.json"');
    });

    it('counts 404s as a WAF coverage gap but not as an exposed file', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                detection: { detected: true, wafType: 'Cloudflare', confidence: 95, evidence: [] },
                sensitiveFiles: {
                    total: 2,
                    results: [
                        { category: 'Sensitive Files', method: 'GET', status: 404, payload: '.env' },
                        { category: 'Sensitive Files', method: 'GET', status: 404, payload: '.git/HEAD' },
                    ],
                },
            }),
        });

        render(<WafCheckPanel />);
        fireEvent.click(screen.getByTestId('run-waf-check-btn'));

        await waitFor(() => expect(screen.getByTestId('waf-stats-row')).toBeInTheDocument());

        // The WAF let both requests through (a real coverage gap), but neither file exists,
        // so nothing is actually leaking — the two signals must be reported separately.
        const statsRow = screen.getByTestId('waf-stats-row');
        expect(statsRow).toHaveTextContent('2Paths Checked');
        expect(statsRow).toHaveTextContent('2Not Blocked');
        expect(statsRow).toHaveTextContent('0Blocked');
        expect(screen.getByTestId('waf-files-section-toggle')).toHaveTextContent('0 exposed');
    });
});
