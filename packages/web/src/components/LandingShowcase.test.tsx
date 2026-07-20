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
            expect(screen.getByText(/1M\+ Scans/)).toBeDefined();
        });
    });

    it('renders the fetched total count and formats it', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            json: async () => ({ total: 1234567 })
        });
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,234,567\+ Scans/)).toBeDefined();
        });
    });
});
