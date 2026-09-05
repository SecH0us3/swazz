// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WafPatchViewer } from './WafPatchViewer.js';
import type { WAFPatchReport } from '../../types.js';

describe('WafPatchViewer Component', () => {
    const mockReport: WAFPatchReport = {
        targetUrl: 'https://example.com',
        generatedAt: '2026-09-04T12:00:00.000Z',
        totalBypasses: 2,
        bundles: {
            cloudflare: {
                vendor: 'cloudflare',
                native: 'http.request.uri.query contains "1\' OR \'1\'=\'1"',
                terraform: 'resource "cloudflare_ruleset" "waf_patch" {}',
                ruleCount: 1,
            },
            aws: {
                vendor: 'aws',
                native: 'aws-waf-rule-definition',
                ruleCount: 1,
            },
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    it('renders nothing when report is null or undefined', () => {
        const { container: c1 } = render(<WafPatchViewer report={null} />);
        expect(c1.firstChild).toBeNull();

        const { container: c2 } = render(<WafPatchViewer report={undefined} />);
        expect(c2.firstChild).toBeNull();
    });

    it('renders nothing when bundles is empty', () => {
        const { container } = render(<WafPatchViewer report={{ ...mockReport, bundles: {} }} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders report with vendor tabs, native rule, and terraform block', () => {
        render(<WafPatchViewer report={mockReport} />);

        expect(screen.getByTestId('waf-patch-viewer')).toBeInTheDocument();
        expect(screen.getByText(/WAF Mitigation Rules/)).toBeInTheDocument();
        expect(screen.getByText(/Generated virtual patch rules for 2 bypasses/)).toBeInTheDocument();

        // Vendor tabs with cloudflare and aws
        const cfTab = screen.getByTestId('waf-vendor-tab-cloudflare');
        expect(cfTab).toHaveClass('active');
        expect(screen.getByTestId('waf-vendor-tab-aws')).not.toHaveClass('active');

        // Cloudflare rules displayed
        const nativePre = screen.getByTestId('waf-patch-native');
        expect(nativePre.textContent).toContain('http.request.uri.query contains');

        const tfPre = screen.getByTestId('waf-patch-terraform');
        expect(tfPre.textContent).toContain('cloudflare_ruleset');
    });

    it('switches vendor via tabs', () => {
        render(<WafPatchViewer report={mockReport} />);

        const awsTab = screen.getByTestId('waf-vendor-tab-aws');
        fireEvent.click(awsTab);

        expect(awsTab).toHaveClass('active');
        expect(screen.getByTestId('waf-vendor-tab-cloudflare')).not.toHaveClass('active');

        const nativePre = screen.getByTestId('waf-patch-native');
        expect(nativePre.textContent).toBe('aws-waf-rule-definition');

        // AWS has no terraform block in mockReport
        expect(screen.queryByTestId('waf-patch-terraform')).not.toBeInTheDocument();
    });

    it('copies native rule to clipboard on button click', async () => {
        render(<WafPatchViewer report={mockReport} />);

        const copyBtn = screen.getByTestId('copy-native-btn');
        fireEvent.click(copyBtn);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockReport.bundles.cloudflare.native);
        expect(await screen.findByText('✓ Copied')).toBeInTheDocument();
    });

    it('copies terraform HCL to clipboard on button click', async () => {
        render(<WafPatchViewer report={mockReport} />);

        const copyTfBtn = screen.getByTestId('copy-terraform-btn');
        fireEvent.click(copyTfBtn);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockReport.bundles.cloudflare.terraform);
        expect(await screen.findByText('✓ Copied')).toBeInTheDocument();
    });
});
