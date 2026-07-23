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
        expect(fuzzingTab.getAttribute('aria-selected')).toBe('false');
        expect(timeoutTab.getAttribute('aria-selected')).toBe('false');
        expect(evasionTab.getAttribute('aria-selected')).toBe('false');

        // Default tab content (Concurrency)
        expect(screen.getByLabelText(/Request Concurrency Worker Count/i)).toBeTruthy();
        expect(screen.getByLabelText(/Delay Between Requests/i)).toBeTruthy();
        expect(screen.getByLabelText(/Enable Rate Limit Detection/i)).toBeTruthy();
        expect(screen.getByLabelText(/Burst Size/i)).toBeTruthy();
    });

    it('switches between sub-tabs and updates aria-selected attributes', () => {
        render(<PerformanceTab />);

        const fuzzingTab = screen.getByRole('tab', { name: /Fuzzing & Intensity/i });
        fireEvent.click(fuzzingTab);

        expect(fuzzingTab.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByLabelText(/Fuzzing Intensity/i)).toBeTruthy();
        expect(screen.getByLabelText(/Active Parameter Fuzzing/i)).toBeTruthy();
        expect(screen.getByLabelText(/HAR Domain Filter/i)).toBeTruthy();

        const timeoutTab = screen.getByRole('tab', { name: /Timeout & Duration/i });
        fireEvent.click(timeoutTab);

        expect(timeoutTab.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByLabelText(/Individual Request Timeout/i)).toBeTruthy();
        expect(screen.getByLabelText(/Maximum Scan Duration/i)).toBeTruthy();

        const evasionTab = screen.getByRole('tab', { name: /WAF Evasion & AI/i });
        fireEvent.click(evasionTab);

        expect(evasionTab.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByLabelText(/Proxy List/i)).toBeTruthy();
        expect(screen.getByLabelText(/Randomize User-Agent/i)).toBeTruthy();
        expect(screen.getByLabelText(/Semantic Format Wrappers/i)).toBeTruthy();
        expect(screen.getByLabelText(/AI Gateway \/ OpenAI Proxy URL/i)).toBeTruthy();
        expect(screen.getByLabelText(/Cloudflare AI Gateway Token/i)).toBeTruthy();
    });

    it('updates concurrency, rate limit burst, and delay in Concurrency & Rate Limits sub-tab', () => {
        render(<PerformanceTab />);

        // Concurrency worker number input
        const concurrencyInput = screen.getByLabelText(/Request Concurrency Worker Count/i);
        fireEvent.change(concurrencyInput, { target: { value: '8' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 8 }));

        // Rate limit burst size
        const burstInput = screen.getByLabelText(/Burst Size/i);
        fireEvent.change(burstInput, { target: { value: '100' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ rate_limit_burst_size: 100 }));

        // Delay between requests
        const delayInput = screen.getByLabelText(/Delay Between Requests/i);
        fireEvent.change(delayInput, { target: { value: '250' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ delay_between_requests_ms: 250 }));
    });

    it('updates fuzzing intensity, active parameter fuzzing, and HAR domain filter in Fuzzing & Intensity sub-tab', () => {
        render(<PerformanceTab />);
        fireEvent.click(screen.getByRole('tab', { name: /Fuzzing & Intensity/i }));

        const intensityInput = screen.getByLabelText(/Fuzzing Intensity/i);
        fireEvent.change(intensityInput, { target: { value: '25' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ iterations_per_profile: 25 }));

        const harFilterInput = screen.getByLabelText(/HAR Domain Filter/i);
        fireEvent.change(harFilterInput, { target: { value: 'sub.domain.com' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ har_domain_filter: 'sub.domain.com' }));
    });

    it('updates timeout and max scan duration in Timeout & Duration sub-tab', () => {
        render(<PerformanceTab />);
        fireEvent.click(screen.getByRole('tab', { name: /Timeout & Duration/i }));

        const timeoutInput = screen.getByLabelText(/Individual Request Timeout/i);
        fireEvent.change(timeoutInput, { target: { value: '3500' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ timeout_ms: 3500 }));

        const durationInput = screen.getByLabelText(/Maximum Scan Duration/i);
        fireEvent.change(durationInput, { target: { value: '60' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ max_scan_duration_min: 60 }));
    });

    it('updates evasion, proxy URL, and AI token settings in WAF Evasion & AI sub-tab', () => {
        render(<PerformanceTab />);
        fireEvent.click(screen.getByRole('tab', { name: /WAF Evasion & AI/i }));

        const proxyInput = screen.getByLabelText(/Proxy List/i);
        fireEvent.change(proxyInput, { target: { value: 'http://proxy1\nhttp://proxy2' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            proxy_list: ['http://proxy1', 'http://proxy2']
        }));

        const gatewayUrlInput = screen.getByLabelText(/AI Gateway \/ OpenAI Proxy URL/i);
        fireEvent.change(gatewayUrlInput, { target: { value: 'https://new-gateway.ai.com' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            ai_gateway_url: 'https://new-gateway.ai.com'
        }));

        const tokenInput = screen.getByLabelText(/Cloudflare AI Gateway Token/i);
        fireEvent.change(tokenInput, { target: { value: 'new-bearer-token' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            cf_aig_token: 'new-bearer-token'
        }));
    });
});
