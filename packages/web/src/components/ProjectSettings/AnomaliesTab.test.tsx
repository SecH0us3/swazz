/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { AnomaliesTab } from './AnomaliesTab.js';

const mockUpdateConfig = vi.fn();
const mockUpdateSettings = vi.fn();
const mockShowToast = vi.fn();
let mockConfig: any = {};

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: () => ({
        config: mockConfig,
        updateConfig: mockUpdateConfig,
        updateSettings: mockUpdateSettings
    })
}));

vi.mock('../../hooks/useToast.js', () => ({
    useToast: () => ({
        showToast: mockShowToast
    })
}));

describe('AnomaliesTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('alert', vi.fn());
        mockConfig = {
            rules: {
                ignore: [404]
            },
            settings: {
                analyze_response_body: true,
                time_anomaly_threshold_ms: 4000,
                bola_testing: false
            },
            security: {
                allow_private_ips: false
            }
        };
    });

    it('renders with initial ignore codes', () => {
        render(<AnomaliesTab />);
        expect(screen.getByText('404')).toBeTruthy();
    });

    it('adds a valid ignore code', async () => {
        render(<AnomaliesTab />);
        const input = screen.getByPlaceholderText('e.g. 404');
        const addBtn = screen.getByText('Add Code');
        
        fireEvent.change(input, { target: { value: '500' } });
        fireEvent.click(addBtn);

        expect(mockUpdateConfig).toHaveBeenCalledWith({
            rules: {
                ignore: [404, 500]
            }
        });
    });

    it('shows error for invalid ignore code', async () => {
        render(<AnomaliesTab />);
        const input = screen.getByPlaceholderText('e.g. 404');
        const addBtn = screen.getByText('Add Code');
        
        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.click(addBtn);
        
        expect(mockShowToast).toHaveBeenCalledWith('Please enter a valid 3-digit HTTP status code (100-599).', 'error');
        expect(mockUpdateConfig).not.toHaveBeenCalled();
    });
    
    it('removes an ignore code', async () => {
        render(<AnomaliesTab />);
        const removeBtns = screen.getAllByText('✕');
        fireEvent.click(removeBtns[0]);
        
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            rules: {
                ignore: []
            }
        });
    });
});
    it('updates timeout anomalies threshold', async () => {
        render(<AnomaliesTab />);
        const input = screen.getByDisplayValue('4000');
        fireEvent.change(input, { target: { value: '5000' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith({ time_anomaly_threshold_ms: 5000 });
    });

    it('toggles SSRF protection', async () => {
        render(<AnomaliesTab />);
        const ssrfCheckbox = screen.getByLabelText(/Allow Scanner Private IP Scopes/i);
        fireEvent.click(ssrfCheckbox);
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            security: {
                allow_private_ips: true
            }
        });
    });

    it('toggles BOLA testing', async () => {
        render(<AnomaliesTab />);
        const bolaCheckbox = screen.getByLabelText(/Enable Broken Object Level Authorization/i);
        fireEvent.click(bolaCheckbox);
        expect(mockUpdateSettings).toHaveBeenCalledWith({
            bola_testing: true
        });
});
