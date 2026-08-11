// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TipsOffNotice } from './TipsOffNotice.js';

describe('TipsOffNotice', () => {
    it('renders the notice text', () => {
        render(<TipsOffNotice onOpenSettings={() => {}} />);
        expect(screen.getByText(/Tips are off/i)).toBeTruthy();
    });

    it('calls onOpenSettings when the Settings action is clicked', () => {
        const onOpenSettings = vi.fn();
        render(<TipsOffNotice onOpenSettings={onOpenSettings} />);
        fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });
});
