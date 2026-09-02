// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Section, KVEditor } from './Shared.js';

describe('Sidebar Shared Components', () => {
    describe('Section', () => {
        it('renders with default open state and toggles on click and keyboard', () => {
            render(
                <Section title="Headers" count={3} action={<button>Action</button>}>
                    <div>Section Body</div>
                </Section>
            );

            expect(screen.getByText('Headers')).toBeTruthy();
            expect(screen.getByText('3')).toBeTruthy();
            expect(screen.getByText('Action')).toBeTruthy();
            expect(screen.getByText('▼')).toBeTruthy();

            const header = screen.getByRole('button', { name: /Headers/i });
            expect(header.getAttribute('aria-expanded')).toBe('true');

            // Click to collapse
            fireEvent.click(header);
            expect(header.getAttribute('aria-expanded')).toBe('false');
            expect(screen.getByText('▶')).toBeTruthy();

            // Keyboard Enter to expand
            fireEvent.keyDown(header, { key: 'Enter' });
            expect(header.getAttribute('aria-expanded')).toBe('true');

            // Keyboard Space to collapse
            fireEvent.keyDown(header, { key: ' ' });
            expect(header.getAttribute('aria-expanded')).toBe('false');

            // Other keys do not toggle
            fireEvent.keyDown(header, { key: 'Tab' });
            expect(header.getAttribute('aria-expanded')).toBe('false');
        });

        it('supports defaultOpen=false', () => {
            render(
                <Section title="Collapsed" defaultOpen={false}>
                    <div>Hidden Body</div>
                </Section>
            );

            const header = screen.getByRole('button');
            expect(header.getAttribute('aria-expanded')).toBe('false');
            expect(screen.getByText('▶')).toBeTruthy();
        });
    });

    describe('KVEditor', () => {
        it('updates key and value in entries', () => {
            const handleChange = vi.fn();
            render(
                <KVEditor
                    entries={{ Authorization: 'Bearer 123' }}
                    onChange={handleChange}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                />
            );

            const keyInput = screen.getByDisplayValue('Authorization');
            fireEvent.change(keyInput, { target: { value: 'Auth' } });
            expect(handleChange).toHaveBeenCalledWith({ Auth: 'Bearer 123' });

            const valInput = screen.getByDisplayValue('Bearer 123');
            fireEvent.change(valInput, { target: { value: 'Bearer 456' } });
            expect(handleChange).toHaveBeenCalledWith({ Authorization: 'Bearer 456' });
        });

        it('deletes an entry', () => {
            const handleChange = vi.fn();
            render(
                <KVEditor
                    entries={{ key1: 'val1', key2: 'val2' }}
                    onChange={handleChange}
                />
            );

            const deleteBtns = screen.getAllByTitle('Delete');
            fireEvent.click(deleteBtns[0]);
            expect(handleChange).toHaveBeenCalledWith({ key2: 'val2' });
        });

        it('adds a new entry', () => {
            const handleChange = vi.fn();
            render(
                <KVEditor
                    entries={{ key1: 'val1' }}
                    onChange={handleChange}
                    keyPlaceholder="Cookie"
                />
            );

            const addBtn = screen.getByText('+ Add Cookie');
            fireEvent.click(addBtn);
            expect(handleChange).toHaveBeenCalledWith(
                expect.objectContaining({ key1: 'val1' })
            );
        });

        it('toggles auth key status', () => {
            const handleToggle = vi.fn();
            const handleChange = vi.fn();

            render(
                <KVEditor
                    entries={{ 'X-API-Key': 'secret' }}
                    onChange={handleChange}
                    authKeys={['X-API-Key']}
                    onToggleAuthKey={handleToggle}
                />
            );

            const lockBtn = screen.getByRole('button', { name: '🔒' });
            fireEvent.click(lockBtn);
            expect(handleToggle).toHaveBeenCalledWith('X-API-Key');
        });
    });
});
