import { create, StateCreator } from 'zustand';
import type { FuzzResult, RunStats } from '../types.js';
import type { HeatmapFilter } from '../components/Dashboard/Heatmap.js';

export interface UISlice {
    activeTab: 'heatmap' | 'logs' | 'findings';
    isSidebarOpen: boolean;
    isConfigOpen: boolean;
    isSidebarHiddenDesktop: boolean;
    isConfigHiddenDesktop: boolean;
}

const createUISlice: StateCreator<AppState, [], [], UISlice> = () => ({
    activeTab: 'heatmap',
    isSidebarOpen: false,
    isConfigOpen: false,
    isSidebarHiddenDesktop: false,
    isConfigHiddenDesktop: false,
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
}

const createStatsSlice: StateCreator<AppState, [], [], StatsSlice> = () => ({
    stats: null,
    historyStats: null,
    isRunning: false,
    isPaused: false,
    isLoadingSpecs: false,
});

export type AppState = UISlice & FuzzingSlice & StatsSlice;

export const useAppStore = create<AppState>()((...a) => ({
    ...createUISlice(...a),
    ...createFuzzingSlice(...a),
    ...createStatsSlice(...a),
}));
