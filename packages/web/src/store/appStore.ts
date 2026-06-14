import { create, StateCreator } from 'zustand';
import type { FuzzResult, RunStats, Project } from '../types.js';
import type { HeatmapFilter } from '../components/Dashboard/Heatmap.js';

export interface UISlice {
    activeTab: 'heatmap' | 'logs' | 'findings' | 'owasp';
    isSidebarOpen: boolean;
    isConfigOpen: boolean;
    isSidebarHiddenDesktop: boolean;
    isConfigHiddenDesktop: boolean;
    isHotkeysHelpOpen: boolean;
    isUserProfileOpen: boolean;
    isProjectSettingsOpen: boolean;
}

const createUISlice: StateCreator<AppState, [], [], UISlice> = () => ({
    activeTab: 'heatmap',
    isSidebarOpen: false,
    isConfigOpen: false,
    isSidebarHiddenDesktop: false,
    isConfigHiddenDesktop: false,
    isHotkeysHelpOpen: false,
    isUserProfileOpen: false,
    isProjectSettingsOpen: false,
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
    userProfile: { username: string; apiKey: string } | null;
}

const createUserSlice: StateCreator<AppState, [], [], UserSlice> = () => ({
    userProfile: null,
});

export interface ProjectSlice {
    activeProject: Project | null;
}

const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = () => ({
    activeProject: null,
});

export type AppState = UISlice & FuzzingSlice & StatsSlice & UserSlice & ProjectSlice;

export const useAppStore = create<AppState>()((...a) => ({
    ...createUISlice(...a),
    ...createFuzzingSlice(...a),
    ...createStatsSlice(...a),
    ...createUserSlice(...a),
    ...createProjectSlice(...a),
}));
