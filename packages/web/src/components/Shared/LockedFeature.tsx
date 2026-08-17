// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import React from 'react';
import { useFeatureGate } from '../../hooks/useFeatureGate.js';
import { useToast } from '../../hooks/useToast.js';

interface LockedFeatureProps {
    feature: string;
    children: React.ReactNode;
    className?: string;
}

export function LockedFeature({ feature, children, className }: LockedFeatureProps) {
    const gate = useFeatureGate(feature);
    const { showToast } = useToast();

    if (gate.unlocked) {
        return <>{children}</>;
    }

    const badge = gate.gateType === 'coming_soon' ? '⏳' : '🔒';

    return (
        <span
            className={className}
            title={gate.lockMessage}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                showToast(gate.lockMessage, 'error');
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showToast(gate.lockMessage, 'error');
                }
            }}
        >
            {children} {badge}
        </span>
    );
}
