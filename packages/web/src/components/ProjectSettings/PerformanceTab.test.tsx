/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { PerformanceTab } from './PerformanceTab';
import { useConfig } from '../../hooks/useConfig.js';

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: vi.fn()
}));

describe('PerformanceTab horizontal sub-tabs navigation', () => {
    let mockUpdateSettings: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockUpdateSettings = vi.fn();
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                settings: {
                    concurrency: 5,
                    timeout_ms: 2000,
                    delay_between_requests_ms: 100,
                    max_scan_duration_min: 30,
                    iterations_per_profile: 10,
                    active_parameter_fuzzing: false,
                    rate_limit_check: true,
                    rate_limit_burst_size: 50,
                    proxy_list: [],
                    randomize_user_agent: false,
                    enable_adaptive_rate_limit: false,
                    har_domain_filter: 'api.example.com',
                    enable_semantic_mutation: true,
                    use_llm_prepass: true,
                    ai_gateway_url: 'https://gateway.example.com',
                    cf_aig_token: 'secret-token'
                }
            },
            updateSettings: mockUpdateSettings
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders horizontal sub-tab buttons and defaults to Concurrency & Rate Limits with correct ARIA states', () => {
        render(<PerformanceTab />);
        
        const concurrencyTab = screen.getByRole('tab', { name: /Concurrency & Rate Limits/i });
        const fuzzingTab = screen.getByRole('tab', { name: /Fuzzing & Intensity/i });
        const timeoutTab = screen.getByRole('tab', { name: /Timeout & Duration/i });
        const evasionTab = screen.getByRole('tab', { name: /WAF Evasion & AI/i });

        expect(concurrencyTab.getAttribute('aria-selected')).toBe('true');
        expect(concurrencyTab.getAttribute('aria-controls')).toBe('subtabpanel-concurrency');

        expect(fuzzingTab.getAttribute('aria-selected')).toBe('false');
        expect(timeoutTab.getAttribute('aria-selected')).toBe('false');
        expect(evasionTab.getAttribute('aria-selected')).toBe('false');

        // Default tab content (Concurrency)
        expect(screen.getByLabelText(/Request Concurrency Worker Count/i)).toBeTruthy();
        expect(screen.getByLabelText(/Delay Between Requests/i)).toBeTruthy();
        expect(screen.getByLabelText(/Enable Rate Limit Detection/i)).toBeTruthy();
        expect(screen.getByLabelText(/Burst Size/i)).toBeTruthy();
    });

    it('switches between sub-tabs with click', () => {
        render(<PerformanceTab />);

        const fuzzingTab = screen.getByRole('tab', { name: /Fuzzing & Intensity/i });
        fireEvent.click(fuzzingTab);

        expect(fuzzingTab.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByLabelText(/Fuzzing Intensity/i)).toBeTruthy();

        // Switch with click to Timeout & Duration
        const timeoutTab = screen.getByRole('tab', { name: /Timeout & Duration/i });
        fireEvent.click(timeoutTab);

        expect(timeoutTab.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByLabelText(/Individual Request Timeout/i)).toBeTruthy();
    });

    it('updates multiline proxy list without stripping newlines until blur', () => {
        render(<PerformanceTab />);
        fireEvent.click(screen.getByRole('tab', { name: /WAF Evasion & AI/i }));

        const proxyInput = screen.getByLabelText(/Proxy List/i);

        // Typing a proxy and pressing Enter (producing trailing empty line)
        fireEvent.change(proxyInput, { target: { value: 'http://proxy1\n' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            proxy_list: ['http://proxy1', '']
        }));

        // Blur filters out empty lines
        fireEvent.blur(proxyInput, { target: { value: 'http://proxy1\n' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            proxy_list: ['http://proxy1']
        }));
    });
});
