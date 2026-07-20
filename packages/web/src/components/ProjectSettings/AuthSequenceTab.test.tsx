import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { AuthSequenceTab } from './AuthSequenceTab.js';

// Mock useConfig so we can control the state easily
const mockUpdateConfig = vi.fn();
let currentConfig: any = {};

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: () => ({
        config: currentConfig,
        updateConfig: mockUpdateConfig
    })
}));

describe('AuthSequenceTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        currentConfig = { auth_sequence: [] };
    });

    it('renders correctly with no steps initially', () => {
        render(<AuthSequenceTab />);
        expect(screen.getByText('Authentication Sequence')).toBeTruthy();
        expect(screen.getByText('+ Add Step')).toBeTruthy();
    });

    it('adds a step when + Add Step is clicked', () => {
        render(<AuthSequenceTab />);
        const addBtn = screen.getByText('+ Add Step');
        fireEvent.click(addBtn);

        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [{
                type: 'request',
                method: 'POST',
                url: '',
                headers: {},
                body: '',
                extract_variables: {}
            }]
        });
    });

    it('shows TOTP inputs when step type is set to totp', () => {
        // Pre-fill config with one TOTP step
        currentConfig = {
            auth_sequence: [{
                type: 'totp',
                totp_secret: 'MYSECRET',
                totp_variable: 'my_totp'
            }]
        };

        render(<AuthSequenceTab />);

        // The step type select should exist
        const select = screen.getByDisplayValue('TOTP Generator');
        expect(select).toBeTruthy();

        // The TOTP specific inputs should be present
        expect(screen.getByText('TOTP Secret / URI')).toBeTruthy();
        expect(screen.getByText('Variable Name')).toBeTruthy();
        
        // The values should be bound
        expect(screen.getByDisplayValue('MYSECRET')).toBeTruthy();
        expect(screen.getByDisplayValue('my_totp')).toBeTruthy();
        
        // HTTP fields should be hidden
        expect(screen.queryByText('Method')).toBeNull();
        expect(screen.queryByText('URL')).toBeNull();
        expect(screen.queryByText('Body (JSON)')).toBeNull();
    });

    it('shows HTTP inputs when step type is request', () => {
        // Pre-fill config with one HTTP step
        currentConfig = {
            auth_sequence: [{
                type: 'request',
                method: 'GET',
                url: 'https://example.com/api',
                body: '{"foo": "bar"}'
            }]
        };

        render(<AuthSequenceTab />);

        expect(screen.getByText('Method')).toBeTruthy();
        expect(screen.getByText('URL')).toBeTruthy();
        expect(screen.getByText('Body (JSON)')).toBeTruthy();

        expect(screen.getByDisplayValue('GET')).toBeTruthy();
        expect(screen.getByDisplayValue('https://example.com/api')).toBeTruthy();
        expect(screen.getByDisplayValue('{"foo": "bar"}')).toBeTruthy();

        // TOTP fields should be hidden
        expect(screen.queryByText('TOTP Secret / URI')).toBeNull();
    });

    it('deletes a step when Delete is clicked', () => {
        currentConfig = {
            auth_sequence: [{
                type: 'request',
                method: 'GET',
                url: 'https://example.com/api',
                body: '{}'
            }]
        };

        render(<AuthSequenceTab />);
        
        const deleteBtn = screen.getByTitle('Delete Step');
        fireEvent.click(deleteBtn);

        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: []
        });
    });
});
