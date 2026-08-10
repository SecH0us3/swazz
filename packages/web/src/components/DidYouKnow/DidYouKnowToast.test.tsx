// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DidYouKnowToast } from './DidYouKnowToast.js';
import { TIPS } from '../../data/tips.js';

describe('DidYouKnowToast', () => {
    it('renders the tip title and summary', () => {
        const tip = TIPS[0];
        render(<DidYouKnowToast tip={tip} onDismiss={() => {}} />);
        expect(screen.getByText(/Did you know/i)).toBeTruthy();
        expect(screen.getByText(tip.title)).toBeTruthy();
        expect(screen.getByText(tip.summary)).toBeTruthy();
    });

    it('renders a documentation link opening in a new tab', () => {
        const tip = TIPS[0];
        render(<DidYouKnowToast tip={tip} onDismiss={() => {}} />);
        const link = screen.getByRole('link', { name: 'Documentation' });
        expect(link.getAttribute('href')).toBe(tip.docsUrl);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
    });

    it('calls onDismiss when the button is clicked', () => {
        const onDismiss = vi.fn();
        render(<DidYouKnowToast tip={TIPS[0]} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByRole('button', { name: /Понятно/i }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('omits the documentation link when no docsUrl is set', () => {
        const tip = { id: 'no-docs', title: 'T', summary: 'S' };
        render(<DidYouKnowToast tip={tip} onDismiss={() => {}} />);
        expect(screen.queryByRole('link', { name: 'Documentation' })).toBeNull();
    });
});
