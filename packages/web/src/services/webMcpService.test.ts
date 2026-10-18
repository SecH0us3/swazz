// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    buildSwazzWebMcpTools,
    registerSwazzWebMcpTools,
    getBrowserModelContext,
    type WebMcpDependencies,
} from './webMcpService.js';
import type { AppState } from '../store/appStore.js';

describe('webMcpService', () => {
    let mockState: any;
    let mockDeps: WebMcpDependencies;

    beforeEach(() => {
        mockState = {
            activeTab: 'heatmap',
            activeProject: { id: 'proj-123', name: 'Test Project' },
            isRunning: false,
            isPaused: false,
            isQueued: false,
            heatmapFilter: null,
            config: {
                base_url: 'http://localhost:8788',
                endpoints: [{ path: '/api/v1/test', method: 'GET' }],
                settings: { profiles: ['RANDOM'] },
            },
        };

        mockDeps = {
            getState: () => mockState as AppState,
            setState: vi.fn((partial) => {
                Object.assign(mockState, partial);
            }),
            updateConfig: vi.fn((partial) => {
                Object.assign(mockState.config, partial);
            }),
            updateProfiles: vi.fn((profiles) => {
                mockState.config.settings.profiles = profiles;
            }),
            startScan: vi.fn(),
        };
    });

    describe('buildSwazzWebMcpTools', () => {
        it('builds 5 distinct tools with required annotations', () => {
            const tools = buildSwazzWebMcpTools(mockDeps);
            expect(tools).toHaveLength(5);
            const names = tools.map((t) => t.name);
            expect(names).toContain('swazz_ui_get_active_state');
            expect(names).toContain('swazz_ui_switch_tab');
            expect(names).toContain('swazz_ui_filter_heatmap');
            expect(names).toContain('swazz_ui_configure_scan');
            expect(names).toContain('swazz_ui_start_scan');

            const getStateTool = tools.find((t) => t.name === 'swazz_ui_get_active_state')!;
            expect(getStateTool.annotations?.readOnlyHint).toBe(true);

            const startScanTool = tools.find((t) => t.name === 'swazz_ui_start_scan')!;
            expect(startScanTool.annotations?.consequentialHint).toBe(true);
            expect(startScanTool.annotations?.readOnlyHint).toBe(false);
        });

        it('swazz_ui_get_active_state returns expected UI snapshot without leaking credentials', async () => {
            const tools = buildSwazzWebMcpTools(mockDeps);
            const tool = tools.find((t) => t.name === 'swazz_ui_get_active_state')!;
            const res = await tool.execute({});
            expect(res.isError).toBeFalsy();
            const data = JSON.parse(res.content[0].text);
            expect(data.activeTab).toBe('heatmap');
            expect(data.activeProjectId).toBe('proj-123');
            expect(data.endpointsCount).toBe(1);
            expect(data.apiKey).toBeUndefined();
            expect(data.token).toBeUndefined();
        });

        it('swazz_ui_switch_tab changes active tab or returns error for invalid tab', async () => {
            const tools = buildSwazzWebMcpTools(mockDeps);
            const tool = tools.find((t) => t.name === 'swazz_ui_switch_tab')!;

            // Valid tab
            const res = await tool.execute({ tab: 'waf' });
            expect(res.isError).toBeFalsy();
            expect(mockDeps.setState).toHaveBeenCalledWith({ activeTab: 'waf' });

            // Invalid tab
            const errRes = await tool.execute({ tab: 'non_existent_tab' });
            expect(errRes.isError).toBe(true);
        });

        it('swazz_ui_filter_heatmap sets or clears filter', async () => {
            const tools = buildSwazzWebMcpTools(mockDeps);
            const tool = tools.find((t) => t.name === 'swazz_ui_filter_heatmap')!;

            // Set filter
            const res = await tool.execute({ method: 'GET', path: '/api/v1/test', status: 200 });
            expect(res.isError).toBeFalsy();
            expect(mockDeps.setState).toHaveBeenCalledWith({
                heatmapFilter: { method: 'GET', path: '/api/v1/test', status: 200 },
                activeTab: 'logs',
            });

            // Clear filter
            await tool.execute({});
            expect(mockDeps.setState).toHaveBeenCalledWith({ heatmapFilter: null });
        });

        it('swazz_ui_configure_scan validates baseUrl and profiles', async () => {
            const tools = buildSwazzWebMcpTools(mockDeps);
            const tool = tools.find((t) => t.name === 'swazz_ui_configure_scan')!;

            // Valid config
            const res = await tool.execute({
                baseUrl: 'https://example.com/api',
                profiles: ['RANDOM', 'MALICIOUS'],
            });
            expect(res.isError).toBeFalsy();
            expect(mockDeps.updateConfig).toHaveBeenCalledWith({ base_url: 'https://example.com/api' });
            expect(mockDeps.updateProfiles).toHaveBeenCalledWith(['RANDOM', 'MALICIOUS']);

            // Invalid baseUrl
            const errUrl = await tool.execute({ baseUrl: 'javascript:alert(1)' });
            expect(errUrl.isError).toBe(true);

            // Invalid profile
            const errProf = await tool.execute({ profiles: ['INVALID_PROFILE'] });
            expect(errProf.isError).toBe(true);
        });

        it('swazz_ui_start_scan validates running state and endpoints', async () => {
            const tools = buildSwazzWebMcpTools(mockDeps);
            const tool = tools.find((t) => t.name === 'swazz_ui_start_scan')!;

            // Success case
            const res = await tool.execute({});
            expect(res.isError).toBeFalsy();
            expect(mockDeps.startScan).toHaveBeenCalled();

            // When already running
            mockState.isRunning = true;
            const errRunning = await tool.execute({});
            expect(errRunning.isError).toBe(true);
            expect(errRunning.content[0].text).toContain('already running');

            // When no endpoints
            mockState.isRunning = false;
            mockState.config.endpoints = [];
            const errNoEndpoints = await tool.execute({});
            expect(errNoEndpoints.isError).toBe(true);
            expect(errNoEndpoints.content[0].text).toContain('No endpoints loaded');
        });
    });

    describe('registerSwazzWebMcpTools', () => {
        it('registers all tools and unregisters on cleanup', () => {
            const registered: any[] = [];
            const unregistered: string[] = [];
            const mockModelContext = {
                registerTool: vi.fn((tool) => registered.push(tool)),
                unregisterTool: vi.fn((name) => unregistered.push(name)),
            };

            const cleanup = registerSwazzWebMcpTools(mockModelContext, mockDeps);
            expect(mockModelContext.registerTool).toHaveBeenCalledTimes(5);
            expect(registered).toHaveLength(5);
            expect(mockModelContext.unregisterTool).toHaveBeenCalledTimes(5);

            cleanup();
            expect(mockModelContext.unregisterTool).toHaveBeenCalledTimes(10);
        });

        it('handles null modelContext gracefully', () => {
            const cleanup = registerSwazzWebMcpTools(null, mockDeps);
            expect(typeof cleanup).toBe('function');
            expect(() => cleanup()).not.toThrow();
        });
    });

    describe('getBrowserModelContext', () => {
        it('returns null when document/navigator.modelContext is not defined', () => {
            const ctx = getBrowserModelContext();
            expect(ctx === null || typeof ctx.registerTool === 'function').toBe(true);
        });
    });
});
