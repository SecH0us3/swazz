// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { AppState } from '../store/appStore.js';
import type { SwazzConfig, FuzzProfile } from '../types.js';

export interface WebMcpToolAnnotations {
    readOnlyHint?: boolean;
    consequentialHint?: boolean;
    untrustedContentHint?: boolean;
}

export interface WebMcpToolResult {
    isError?: boolean;
    content: Array<{ type: 'text'; text: string }>;
}

export interface WebMcpToolDefinition {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: WebMcpToolAnnotations;
    execute: (input: Record<string, unknown>) => Promise<WebMcpToolResult>;
}

export interface ModelContextLike {
    registerTool: (tool: WebMcpToolDefinition) => void;
    unregisterTool?: (name: string) => void;
}

export interface WebMcpDependencies {
    getState: () => AppState;
    setState: (partial: Partial<AppState>) => void;
    updateConfig: (partial: Partial<SwazzConfig>) => void;
    updateProfiles: (profiles: FuzzProfile[]) => void;
    startScan: () => Promise<void> | void;
}

const VALID_TABS: ReadonlySet<AppState['activeTab']> = new Set([
    'heatmap', 'logs', 'findings', 'owasp', 'waf',
    'settings', 'project_settings', 'history', 'compare',
    'about', 'analytics', 'runner_logs',
]);

const VALID_PROFILES: ReadonlySet<FuzzProfile> = new Set([
    'RANDOM', 'BOUNDARY', 'MALICIOUS',
]);

export function getBrowserModelContext(): ModelContextLike | null {
    if (typeof document !== 'undefined' && (document as any).modelContext?.registerTool) {
        return (document as any).modelContext as ModelContextLike;
    }
    if (typeof navigator !== 'undefined' && (navigator as any).modelContext?.registerTool) {
        return (navigator as any).modelContext as ModelContextLike;
    }
    return null;
}

export function buildSwazzWebMcpTools(deps: WebMcpDependencies): WebMcpToolDefinition[] {
    return [
        {
            name: 'swazz_ui_get_active_state',
            title: 'Get Active Swazz UI State',
            description: 'Returns non-sensitive metadata about the active Swazz dashboard view, loaded endpoints, and scan status.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            async execute() {
                const state = deps.getState();
                const summary = {
                    activeTab: state.activeTab,
                    activeProjectId: state.activeProject?.id ?? null,
                    activeProjectName: state.activeProject?.name ?? null,
                    isRunning: state.isRunning,
                    isPaused: state.isPaused,
                    isQueued: state.isQueued,
                    endpointsCount: state.config.endpoints?.length ?? 0,
                    baseUrl: state.config.base_url || '',
                    profiles: state.config.settings?.profiles ?? [],
                };
                return {
                    content: [{ type: 'text', text: JSON.stringify(summary) }],
                };
            },
        },
        {
            name: 'swazz_ui_switch_tab',
            title: 'Switch Dashboard Tab',
            description: 'Switches the active tab in the Swazz Web Dashboard.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab: {
                        type: 'string',
                        enum: Array.from(VALID_TABS),
                        description: 'Target tab identifier.',
                    },
                },
                required: ['tab'],
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            async execute(input) {
                const tab = typeof input?.tab === 'string' ? (input.tab as AppState['activeTab']) : null;
                if (!tab || !VALID_TABS.has(tab)) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Invalid tab: ${String(input?.tab)}` }],
                    };
                }
                deps.setState({ activeTab: tab });
                return {
                    content: [{ type: 'text', text: JSON.stringify({ activeTab: tab }) }],
                };
            },
        },
        {
            name: 'swazz_ui_filter_heatmap',
            title: 'Filter Inspector by Heatmap Cell',
            description: 'Applies or clears an endpoint + method + HTTP status filter in the Swazz Request Inspector.',
            inputSchema: {
                type: 'object',
                properties: {
                    method: { type: 'string', description: 'HTTP method (e.g. GET, POST) or empty to clear.' },
                    path: { type: 'string', description: 'Endpoint path (e.g. /api/users).' },
                    status: { type: 'number', description: 'HTTP status code (e.g. 200, 500).' },
                },
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            async execute(input) {
                if (!input || !input.method || !input.path || typeof input.status !== 'number') {
                    deps.setState({ heatmapFilter: null });
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ heatmapFilter: null }) }],
                    };
                }
                const filter = {
                    method: String(input.method).toUpperCase(),
                    path: String(input.path),
                    status: Number(input.status),
                };
                deps.setState({ heatmapFilter: filter, activeTab: 'logs' });
                return {
                    content: [{ type: 'text', text: JSON.stringify({ heatmapFilter: filter }) }],
                };
            },
        },
        {
            name: 'swazz_ui_configure_scan',
            title: 'Configure Active Scan Parameters',
            description: 'Updates base_url and/or fuzzing profiles in the active Swazz workspace configuration.',
            inputSchema: {
                type: 'object',
                properties: {
                    baseUrl: { type: 'string', description: 'Target API base URL (must start with http://, https://, ws://, wss://, grpc://, or grpcs://).' },
                    profiles: {
                        type: 'array',
                        items: { type: 'string', enum: ['RANDOM', 'BOUNDARY', 'MALICIOUS'] },
                        description: 'Fuzzing payload profiles to enable.',
                    },
                },
                additionalProperties: false,
            },
            annotations: { readOnlyHint: false, consequentialHint: true },
            async execute(input) {
                if (input?.baseUrl !== undefined) {
                    if (typeof input.baseUrl !== 'string' || !/^(https?|wss?|grpcs?):\/\/.+/i.test(input.baseUrl.trim())) {
                        return {
                            isError: true,
                            content: [{ type: 'text', text: 'Invalid baseUrl: must use http(s), ws(s), or grpc(s) scheme.' }],
                        };
                    }
                    deps.updateConfig({ base_url: input.baseUrl.trim() });
                }
                if (input?.profiles !== undefined) {
                    if (!Array.isArray(input.profiles) || input.profiles.some((p) => typeof p !== 'string' || !VALID_PROFILES.has(p as FuzzProfile))) {
                        return {
                            isError: true,
                            content: [{ type: 'text', text: 'Invalid profiles: must be an array of RANDOM, BOUNDARY, or MALICIOUS.' }],
                        };
                    }
                    deps.updateProfiles(input.profiles as FuzzProfile[]);
                }
                const updated = deps.getState().config;
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            baseUrl: updated.base_url,
                            profiles: updated.settings?.profiles ?? [],
                        }),
                    }],
                };
            },
        },
        {
            name: 'swazz_ui_start_scan',
            title: 'Start Fuzzing Scan',
            description: 'Starts a fuzzing run in the current Swazz workspace if endpoints are loaded and no scan is currently running.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            annotations: { readOnlyHint: false, consequentialHint: true },
            async execute() {
                const state = deps.getState();
                if (state.isRunning) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: 'A scan is already running.' }],
                    };
                }
                if (!state.config.endpoints || state.config.endpoints.length === 0) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: 'No endpoints loaded in current workspace.' }],
                    };
                }
                await deps.startScan();
                return {
                    content: [{ type: 'text', text: JSON.stringify({ status: 'started' }) }],
                };
            },
        },
    ];
}

export function registerSwazzWebMcpTools(
    modelContext: ModelContextLike | null,
    deps: WebMcpDependencies,
): () => void {
    if (!modelContext) return () => {};
    const tools = buildSwazzWebMcpTools(deps);
    const registeredNames: string[] = [];

    for (const tool of tools) {
        try {
            modelContext.unregisterTool?.(tool.name);
        } catch {
            // Ignore if not previously registered
        }
        try {
            modelContext.registerTool(tool);
            registeredNames.push(tool.name);
        } catch (err) {
            console.warn(`[Swazz WebMCP] Failed to register tool ${tool.name}:`, err);
        }
    }

    return () => {
        for (const name of registeredNames) {
            try {
                modelContext.unregisterTool?.(name);
            } catch {
                // Ignore cleanup errors
            }
        }
    };
}
