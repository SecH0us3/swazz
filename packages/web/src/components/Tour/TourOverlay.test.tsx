// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TourOverlay } from './TourOverlay.js';
import { TOURS } from '../../data/tours.js';

function stubRect() {
    const proto = HTMLElement.prototype as any;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
        if (this.classList && this.classList.contains('sidebar')) {
            return { x: 0, y: 50, width: 200, height: 600, top: 50, right: 200, bottom: 650, left: 0 };
        }
        return original.apply(this, arguments);
    };
}

describe('TourOverlay', () => {
    beforeEach(() => { stubRect(); });

    it('renders the current step title and body', () => {
        const first = TOURS[0].steps[0];
        render(<TourOverlay activeTourId={TOURS[0].id} currentStep={0} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} />);
        expect(screen.getByText(first.title)).toBeTruthy();
        expect(screen.getByText(first.body)).toBeTruthy();
    });

    it('calls onSkip when the Skip button is clicked', () => {
        const onSkip = vi.fn();
        render(<TourOverlay activeTourId={TOURS[0].id} currentStep={0} onNext={vi.fn()} onBack={vi.fn()} onSkip={onSkip} />);
        fireEvent.click(screen.getByRole('button', { name: /skip/i }));
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('calls onNext when the Next button is clicked', () => {
        const onNext = vi.fn();
        render(<TourOverlay activeTourId={TOURS[0].id} currentStep={0} onNext={onNext} onBack={vi.fn()} onSkip={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('renders Done on the last step', () => {
        const last = TOURS[0].steps.length - 1;
        render(<TourOverlay activeTourId={TOURS[0].id} currentStep={last} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} />);
        expect(screen.getByRole('button', { name: /done/i })).toBeTruthy();
    });
});
