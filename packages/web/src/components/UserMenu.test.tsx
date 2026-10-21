// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { UserMenu } from './UserMenu.js';
import { useAppStore } from '../store/appStore.js';

describe('UserMenu', () => {
    afterEach(() => {
        useAppStore.setState({ userProfile: null } as any);
    });

    it('offers documentation, GitHub and blog links that open in a new tab', () => {
        useAppStore.setState({ userProfile: { username: 'alice' } as any });
        render(<UserMenu onLogout={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /alice/i }));

        const expected: Array<[RegExp, string]> = [
            [/Documentation/, 'https://sech0us3.github.io/swazz/'],
            [/GitHub/, 'https://github.com/SecH0us3/swazz'],
            [/Blog/, 'https://yoursec.substack.com/t/swazz'],
            [/Report an issue/, 'https://github.com/SecH0us3/swazz/issues'],
        ];
        for (const [name, href] of expected) {
            const link = screen.getByRole('link', { name });
            expect(link).toHaveAttribute('href', href);
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }

        fireEvent.click(screen.getByRole('link', { name: /Documentation/ }));
        expect(screen.queryByRole('link', { name: /Blog/ })).toBeNull();
    });
});
