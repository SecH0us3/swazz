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

describe('PerformanceTab evasion settings', () => {
    let mockUpdateSettings: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockUpdateSettings = vi.fn();
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                settings: {
                    proxyList: [],
                    randomizeUserAgent: false,
                    enableAdaptiveRateLimit: false
                }
            },
            updateSettings: mockUpdateSettings
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders and updates evasion settings', () => {
        render(<PerformanceTab />);
        
        // Test Proxy List
        const proxyInput = screen.getByLabelText(/Proxy List/i);
        fireEvent.change(proxyInput, { target: { value: 'http://proxy1\nhttp://proxy2' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            proxyList: ['http://proxy1', 'http://proxy2']
        }));

        // Test User Agent Toggle
        const uaToggle = screen.getByLabelText(/Randomize User-Agent/i);
        fireEvent.click(uaToggle);
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            randomizeUserAgent: true
        }));
        
        // Test Adaptive Rate Limit Toggle
        const rateLimitToggle = screen.getByLabelText(/Enable Adaptive Rate Limiting/i);
        fireEvent.click(rateLimitToggle);
        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({
            enableAdaptiveRateLimit: true
        }));
    });
});
