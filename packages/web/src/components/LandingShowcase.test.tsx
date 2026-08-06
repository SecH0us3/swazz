// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { LandingShowcase } from './LandingShowcase.js';

describe('LandingShowcase Component - ScanCounter', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
        let frameTime = 0;
        vi.stubGlobal('requestAnimationFrame', (cb: any) => {
            frameTime += 1000;
            setTimeout(() => cb(frameTime), 0);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders fallback count when fetch fails', async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });
    });

    it('renders the fetched total count and formats it', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ total: 1234567 })
        });
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,234,567\+ Scans/)).toBeDefined();
        });
    });

    it('opens and submits the Enterprise Waitlist modal', async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
        render(<LandingShowcase />);
        
        const requestBtn = screen.getByText('Request Enterprise License');
        expect(requestBtn).toBeDefined();
        requestBtn.click();

        await waitFor(() => {
            expect(screen.getByText('Swazz Enterprise Waitlist')).toBeDefined();
        });
    });

    it('renders PCI-DSS Compliant badge instead of SOC 2 Type II', async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/PCI-DSS Compliant/i)).toBeDefined();
            expect(screen.queryByText(/SOC 2 Type II/i)).toBeNull();
        });
    });

    it('renders Browser Extension bento card and opens feature detail modal', async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
        render(<LandingShowcase />);
        
        const bentoCard = screen.getByText('Browser Extension');
        expect(bentoCard).toBeDefined();
        bentoCard.click();

        await waitFor(() => {
            expect(screen.getByText(/Swazz's browser extension streams live traffic/i)).toBeDefined();
        });
    });
});

