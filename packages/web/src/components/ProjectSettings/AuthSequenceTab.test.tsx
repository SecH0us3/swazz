// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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

    it('updates request step fields (method, url, body)', () => {
        currentConfig = {
            auth_sequence: [{
                type: 'request',
                method: 'POST',
                url: 'https://example.com/login',
                body: '{"user":"admin"}'
            }]
        };

        render(<AuthSequenceTab />);

        const methodSelect = screen.getByDisplayValue('POST');
        fireEvent.change(methodSelect, { target: { value: 'PUT' } });
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [expect.objectContaining({ method: 'PUT' })]
        });

        const urlInput = screen.getByPlaceholderText('https://api.example.com/login');
        fireEvent.change(urlInput, { target: { value: 'https://example.com/api/v2' } });
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [expect.objectContaining({ url: 'https://example.com/api/v2' })]
        });

        const bodyInput = screen.getByPlaceholderText('{"username": "admin", "password": "password"}');
        fireEvent.change(bodyInput, { target: { value: '{"token":"xyz"}' } });
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [expect.objectContaining({ body: '{"token":"xyz"}' })]
        });
    });

    it('updates totp step fields (secret, variable)', () => {
        currentConfig = {
            auth_sequence: [{
                type: 'totp',
                totp_secret: 'JBSWY3DPEHPK3PXP',
                totp_variable: 'totp_code'
            }]
        };

        render(<AuthSequenceTab />);

        const secretInput = screen.getByPlaceholderText('JBSWY3DPEHPK3PXP');
        fireEvent.change(secretInput, { target: { value: 'NEWSECRET' } });
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [expect.objectContaining({ totp_secret: 'NEWSECRET' })]
        });

        const varInput = screen.getByPlaceholderText('totp_code');
        fireEvent.change(varInput, { target: { value: 'custom_code' } });
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [expect.objectContaining({ totp_variable: 'custom_code' })]
        });
    });

    it('converts step between request and totp type', () => {
        currentConfig = {
            auth_sequence: [{
                type: 'request',
                method: 'POST',
                url: 'https://example.com/login',
                body: '{}'
            }]
        };

        render(<AuthSequenceTab />);

        const select = screen.getByDisplayValue('HTTP Request');
        // Switch to TOTP: should strip request fields
        fireEvent.change(select, { target: { value: 'totp' } });
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [{
                type: 'totp'
            }]
        });

        // Now test switching from TOTP to request
        currentConfig = {
            auth_sequence: [{
                type: 'totp',
                totp_secret: 'SECRET',
                totp_variable: 'VAR'
            }]
        };

        const { rerender } = render(<AuthSequenceTab />);
        rerender(<AuthSequenceTab />);
        const totpSelect = screen.getByDisplayValue('TOTP Generator');
        fireEvent.change(totpSelect, { target: { value: 'request' } });
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            auth_sequence: [{
                type: 'request',
                method: 'POST'
            }]
        });
    });
});
