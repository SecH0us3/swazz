// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useEffect, useState } from 'react';
import { TOURS } from '../../data/tours.js';
import './TourOverlay.css';

export interface TourOverlayProps {
    activeTourId: string | null;
    currentStep: number;
    onNext: () => void;
    onBack: () => void;
    onSkip: () => void;
}

export function TourOverlay({ activeTourId, currentStep, onNext, onBack, onSkip }: TourOverlayProps) {
    const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const tour = TOURS.find((t) => t.id === activeTourId) ?? null;
    const step = tour?.steps[currentStep] ?? null;

    useEffect(() => {
        if (!step) { setRect(null); return; }
        const el = document.querySelector(step.selector);
        if (!el) { setRect(null); return; }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }, [step]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onSkip(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onSkip]);

    if (!tour || !step) return null;

    const isLast = currentStep >= tour.steps.length - 1;
    const placement = step.placement || 'bottom';

    return (
        <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={step.title}>
            {rect && (
                <div
                    className="tour-spotlight"
                    style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
                    data-testid="tour-spotlight"
                />
            )}
            <div className="tour-tooltip tour-tooltip-bottom" data-testid="tour-tooltip">
                <div className="tour-tooltip-title">{step.title}</div>
                <div className="tour-tooltip-body">{step.body}</div>
                <div className="tour-tooltip-actions">
                    <button type="button" className="tour-tooltip-btn" onClick={onSkip}>Skip</button>
                    {currentStep > 0 && (
                        <button type="button" className="tour-tooltip-btn" onClick={onBack}>Back</button>
                    )}
                    {isLast ? (
                        <button type="button" className="tour-tooltip-btn tour-tooltip-primary" onClick={onNext}>Done</button>
                    ) : (
                        <button type="button" className="tour-tooltip-btn tour-tooltip-primary" onClick={onNext}>Next</button>
                    )}
                </div>
            </div>
        </div>
    );
}
