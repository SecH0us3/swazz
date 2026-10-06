// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { ChainingRulesEditor } from './ChainingRulesEditor.js';
import type { ChainingRule } from '../../types.js';

describe('ChainingRulesEditor Component', () => {
    const mockRules: ChainingRule[] = [
        {
            source_endpoint: 'POST /api/auth/login',
            extract_type: 'json',
            extract_path: 'data.token',
            variable_name: 'TOKEN',
        },
        {
            source_endpoint: 'GET /api/session',
            extract_type: 'header',
            extract_path: 'Set-Cookie',
            variable_name: 'SESSION_ID',
        },
    ];

    it('renders existing rules correctly', () => {
        const onChange = vi.fn();
        render(<ChainingRulesEditor rules={mockRules} onChange={onChange} />);

        expect(screen.getByText('Rule 1')).toBeInTheDocument();
        expect(screen.getByText('Rule 2')).toBeInTheDocument();
        expect(screen.getByDisplayValue('POST /api/auth/login')).toBeInTheDocument();
        expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument();
        expect(screen.getByDisplayValue('data.token')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Set-Cookie')).toBeInTheDocument();
    });

    it('adds a new empty rule when "+ Add Rule" is clicked', () => {
        const onChange = vi.fn();
        render(<ChainingRulesEditor rules={mockRules} onChange={onChange} />);

        const addBtn = screen.getByRole('button', { name: /\+ Add Rule/i });
        fireEvent.click(addBtn);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith([
            ...mockRules,
            {
                source_endpoint: '',
                extract_type: 'json',
                extract_path: '',
                variable_name: '',
            },
        ]);
    });

    it('updates rule fields when changed', () => {
        const onChange = vi.fn();
        render(<ChainingRulesEditor rules={mockRules} onChange={onChange} />);

        // Update source endpoint
        const sourceInput = screen.getByDisplayValue('POST /api/auth/login');
        fireEvent.change(sourceInput, { target: { value: 'POST /api/v2/auth' } });
        expect(onChange).toHaveBeenCalledWith([
            { ...mockRules[0], source_endpoint: 'POST /api/v2/auth' },
            mockRules[1],
        ]);

        // Update variable name
        const varInput = screen.getByDisplayValue('TOKEN');
        fireEvent.change(varInput, { target: { value: 'AUTH_KEY' } });
        expect(onChange).toHaveBeenCalledWith([
            { ...mockRules[0], variable_name: 'AUTH_KEY' },
            mockRules[1],
        ]);

        // Update extract path
        const pathInput = screen.getByDisplayValue('data.token');
        fireEvent.change(pathInput, { target: { value: 'access_token' } });
        expect(onChange).toHaveBeenCalledWith([
            { ...mockRules[0], extract_path: 'access_token' },
            mockRules[1],
        ]);
    });

    it('switches extract type between json, header, and regex', () => {
        const onChange = vi.fn();
        render(<ChainingRulesEditor rules={mockRules} onChange={onChange} />);

        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[0], { target: { value: 'regex' } });

        expect(onChange).toHaveBeenCalledWith([
            { ...mockRules[0], extract_type: 'regex' },
            mockRules[1],
        ]);
    });

    it('deletes a rule when the delete button is clicked', () => {
        const onChange = vi.fn();
        render(<ChainingRulesEditor rules={mockRules} onChange={onChange} />);

        const deleteButtons = screen.getAllByTitle('Delete Rule');
        expect(deleteButtons).toHaveLength(2);

        fireEvent.click(deleteButtons[0]);
        expect(onChange).toHaveBeenCalledWith([mockRules[1]]);
    });

    it('displays appropriate placeholders for different extract types', () => {
        const regexRule: ChainingRule[] = [
            {
                source_endpoint: 'GET /page',
                extract_type: 'regex',
                extract_path: '',
                variable_name: 'CSRF',
            },
        ];
        render(<ChainingRulesEditor rules={regexRule} onChange={vi.fn()} />);

        expect(screen.getByPlaceholderText('e.g. token=([a-z0-9]+)')).toBeInTheDocument();
    });
});
