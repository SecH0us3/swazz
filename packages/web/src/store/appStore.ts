import { create, StateCreator } from 'zustand';
import type { FuzzResult, RunStats, Project, SwazzConfig } from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import type { HeatmapFilter } from '../components/Dashboard/Heatmap.js';

export interface UISlice {
    activeTab: 'heatmap' | 'logs' | 'findings' | 'owasp' | 'settings' | 'project_settings' | 'history';
    isSidebarOpen: boolean;
    isConfigOpen: boolean;
    isSidebarHiddenDesktop: boolean;
    isConfigHiddenDesktop: boolean;
    isHotkeysHelpOpen: boolean;
    isUserProfileOpen: boolean;
}

const createUISlice: StateCreator<AppState, [], [], UISlice> = () => ({
    activeTab: 'heatmap',
    isSidebarOpen: false,
    isConfigOpen: false,
    isSidebarHiddenDesktop: false,
    isConfigHiddenDesktop: false,
    isHotkeysHelpOpen: false,
    isUserProfileOpen: false,
});

export interface FuzzingSlice {
    liveCount: number;
    liveRunId: string | null;
    loadedRunId: string | null;
    heatmapFilter: HeatmapFilter | null;
    selectedResult: FuzzResult | null;
}

const createFuzzingSlice: StateCreator<AppState, [], [], FuzzingSlice> = () => ({
    liveCount: 0,
    liveRunId: null,
    loadedRunId: null,
    heatmapFilter: null,
    selectedResult: null,
});

export interface StatsSlice {
    stats: RunStats | null;
    historyStats: RunStats | null;
    isRunning: boolean;
    isPaused: boolean;
    isLoadingSpecs: boolean;
    specCacheDates: Record<string, string>;
}

const createStatsSlice: StateCreator<AppState, [], [], StatsSlice> = () => ({
    stats: null,
    historyStats: null,
    isRunning: false,
    isPaused: false,
    isLoadingSpecs: false,
    specCacheDates: {},
});

export interface UserSlice {
    userProfile: { username: string; apiKey: string; publicKey?: string | null; isGuest?: boolean; deleteRequestedAt?: string | null } | null;
}

const createUserSlice: StateCreator<AppState, [], [], UserSlice> = () => ({
    userProfile: null,
});

export interface ProjectSlice {
    activeProject: Project | null;
    projects: Project[];
}

const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = () => ({
    activeProject: null,
    projects: [],
});

export interface ConfigSlice {
    config: SwazzConfig;
}

const createConfigSlice: StateCreator<AppState, [], [], ConfigSlice> = () => ({
    config: {
        base_url: '',
        global_headers: {},
        cookies: {},
        dictionaries: {},
        settings: { ...DEFAULT_SETTINGS },
        endpoints: [],
        disabled_endpoints: [],
        _swagger_urls: [],
        security: { allow_private_ips: false },
        rules: { ignore: [] },
    },
});

export type AppState = UISlice & FuzzingSlice & StatsSlice & UserSlice & ProjectSlice & ConfigSlice;

export const useAppStore = create<AppState>()((...a) => ({
    ...createUISlice(...a),
    ...createFuzzingSlice(...a),
    ...createStatsSlice(...a),
    ...createUserSlice(...a),
    ...createProjectSlice(...a),
    ...createConfigSlice(...a),
}));
