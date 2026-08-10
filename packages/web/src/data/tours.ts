// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

export type TourTrigger = 'screen' | 'event' | 'manual';
export interface TourStep { selector: string; title: string; body: string; placement?: 'top' | 'bottom' | 'left' | 'right'; }
export interface Tour { id: string; trigger: TourTrigger; screen?: string; steps: TourStep[]; }

export const TOURS: Tour[] = [
    {
        id: 'workspace-first',
        trigger: 'event',
        steps: [
            { selector: '.sidebar', title: 'Endpoint tree', body: 'Browse the parsed API endpoints here.', placement: 'right' },
            { selector: '.config-sidebar', title: 'Configuration', body: 'Tune auth, rate limits and fuzzing options.', placement: 'left' },
            { selector: '.heatmap-container, .main-content', title: 'Results heatmap', body: 'Scan results appear here in real time.', placement: 'bottom' },
        ],
    },
    {
        id: 'project-settings-first',
        trigger: 'screen',
        screen: 'project_settings',
        steps: [
            { selector: '.settings-nav', title: 'Project settings', body: 'Manage project-level configuration and integrations.', placement: 'right' },
            { selector: '.settings-content', title: 'Settings tabs', body: 'Adjust per-project behavior across these tabs.', placement: 'left' },
        ],
    },
];
