// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { LandingShowcase } from './LandingShowcase.js';

describe('LandingShowcase Component', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ total: 1000000 })
            })
        );
        let frameTime = 0;
        vi.stubGlobal('requestAnimationFrame', (cb: any) => {
            frameTime += 2000;
            return setTimeout(() => cb(frameTime), 0);
        });
        vi.stubGlobal('cancelAnimationFrame', (id: any) => {
            clearTimeout(id);
        });
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined)
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders fallback count when telemetry fetch fails', async () => {
        (global.fetch as any).mockImplementationOnce(() => Promise.reject(new Error('Network error')));
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });
    });

    it('renders the fetched total count and formats it', async () => {
        (global.fetch as any).mockImplementationOnce(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ total: 1234567 })
            })
        );
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,234,567\+ Scans/)).toBeDefined();
        });
    });

    it('renders PCI-DSS Compliant and OWASP API Top 10 badges', async () => {
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });
        expect(screen.getByText(/PCI-DSS Compliant/i)).toBeDefined();
        expect(screen.getAllByText(/OWASP API Top 10/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/BSL 1.1 Licensed/i)).toBeDefined();
    });

    it('renders Live Fuzzing Simulator and allows switching scenarios', async () => {
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });

        // Default scenario: BOLA
        expect(screen.getByText('BOLA / ID Tampering')).toBeDefined();
        expect(screen.getByText('/api/v1/users/{id}/billing')).toBeDefined();
        expect(screen.getByText(/Broken Object Level Authorization Detected/i)).toBeDefined();

        // Switch to SQLi scenario
        const sqliTab = screen.getByText('JSON SQL Injection');
        act(() => {
            fireEvent.click(sqliTab);
        });

        await waitFor(() => {
            expect(screen.getByText('/api/v2/orders/search')).toBeDefined();
            expect(screen.getByText(/Unescaped SQL Query Execution/i)).toBeDefined();
        });

        // Switch to SSRF scenario
        const ssrfTab = screen.getByText('SSRF via Header Injection');
        act(() => {
            fireEvent.click(ssrfTab);
        });

        await waitFor(() => {
            expect(screen.getByText('/api/v1/integrations/webhook/test')).toBeDefined();
            expect(screen.getByText(/SSRF against Cloud Instance Metadata/i)).toBeDefined();
        });

        // Switch to Mass Assignment scenario
        const massAssignTab = screen.getByText('Privilege Mass Assignment');
        act(() => {
            fireEvent.click(massAssignTab);
        });

        await waitFor(() => {
            expect(screen.getByText('/api/v1/users/profile')).toBeDefined();
            expect(screen.getByText(/Privilege Escalation via Unrestricted Parameter Binding/i)).toBeDefined();
        });

        // Test running mutation button
        const runBtn = screen.getByRole('button', { name: /Re-run Mutation|Fuzzing AST/i });
        act(() => {
            fireEvent.click(runBtn);
        });
        expect(screen.getByText(/Fuzzing AST.../i)).toBeDefined();
    });

    it('renders Technical Benchmarks comparison matrix', async () => {
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });

        expect(screen.getByText('How Swazz Outperforms Legacy Scanners')).toBeDefined();
        expect(screen.getByText('Traditional DAST')).toBeDefined();
        expect(screen.getByText('Generic Fuzzers')).toBeDefined();
        expect(screen.getByText(/Deep AST parsing & smart mutation/i)).toBeDefined();
    });

    it('allows switching quickstart deployment tabs and copying commands', async () => {
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });

        expect(screen.getByText(/Run Instant CLI Scan against OpenAPI Spec/i)).toBeDefined();

        // Switch to Docker tab
        const dockerTab = screen.getByText('Docker');
        act(() => {
            fireEvent.click(dockerTab);
        });

        expect(screen.getByText(/Option A: Run Standalone Scanner \(CLI\)/i)).toBeDefined();

        // Click copy button
        const copyBtns = screen.getAllByText('Copy');
        expect(copyBtns.length).toBeGreaterThan(0);
        act(() => {
            fireEvent.click(copyBtns[0]);
        });

        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalled();
        });
    });

    it('renders Browser Extension bento card and opens feature detail modal', async () => {
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });
        
        const bentoCard = screen.getByText('Browser Extension');
        expect(bentoCard).toBeDefined();
        act(() => {
            fireEvent.click(bentoCard);
        });

        await waitFor(() => {
            expect(screen.getByText(/Swazz's browser extension streams live traffic/i)).toBeDefined();
        });

        // Close modal via escape
        act(() => {
            fireEvent.keyDown(window, { key: 'Escape' });
        });

        await waitFor(() => {
            expect(screen.queryByText(/Swazz's browser extension streams live traffic/i)).toBeNull();
        });
    });

    it('opens and submits the Enterprise Waitlist modal', async () => {
        render(<LandingShowcase />);
        await waitFor(() => {
            expect(screen.getByText(/1,000,000\+ Scans/)).toBeDefined();
        });
        
        const requestBtn = screen.getByText('Request Enterprise License');
        expect(requestBtn).toBeDefined();
        act(() => {
            fireEvent.click(requestBtn);
        });

        await waitFor(() => {
            expect(screen.getByText('Swazz Enterprise Waitlist')).toBeDefined();
        });

        const nameInput = screen.getByPlaceholderText('Alex Smith');
        const emailInput = screen.getByPlaceholderText('alex@company.com');
        const companyInput = screen.getByPlaceholderText('Acme Security Inc.');
        const submitBtn = screen.getByText('Submit Enterprise Access Request');

        act(() => {
            fireEvent.change(nameInput, { target: { value: 'Jane Doe' } });
            fireEvent.change(emailInput, { target: { value: 'jane@enterprise.com' } });
            fireEvent.change(companyInput, { target: { value: 'Enterprise Security LLC' } });
            fireEvent.click(submitBtn);
        });

        await waitFor(() => {
            expect(screen.getByText('Request Received!')).toBeDefined();
            expect(screen.getByText(/jane@enterprise.com/)).toBeDefined();
        });
    });
});
