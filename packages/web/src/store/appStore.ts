import { create } from 'zustand';
import type { FuzzResult, RunStats } from '../types.js';
import type { HeatmapFilter } from '../components/Dashboard/Heatmap.js';

interface AppState {
    // UI State
    activeTab: 'heatmap' | 'logs';
    isSidebarOpen: boolean;
    isConfigOpen: boolean;
    isSidebarHiddenDesktop: boolean;
    isConfigHiddenDesktop: boolean;

    // Fuzzing State
    liveCount: number;
    liveRunId: string | null;
    loadedRunId: string | null;
    heatmapFilter: HeatmapFilter | null;
    selectedResult: FuzzResult | null;

    // Live Stats
    stats: RunStats | null;
    historyStats: RunStats | null;
    isRunning: boolean;
    isPaused: boolean;
    isLoadingSpecs: boolean;

    // Actions (UI)
    setActiveTab: (tab: 'heatmap' | 'logs') => void;
    setIsSidebarOpen: (isOpen: boolean) => void;
    setIsConfigOpen: (isOpen: boolean) => void;
    setIsSidebarHiddenDesktop: (isHidden: boolean) => void;
    setIsConfigHiddenDesktop: (isHidden: boolean) => void;

    // Actions (Fuzzing)
    setLiveCount: (count: number) => void;
    incrementLiveCount: () => void;
    setLiveRunId: (runId: string | null) => void;
    setLoadedRunId: (runId: string | null) => void;
    setHistoryStats: (stats: RunStats | null) => void;
    setHeatmapFilter: (filter: HeatmapFilter | null) => void;
    setSelectedResult: (result: FuzzResult | null) => void;

    // Actions (Live Stats)
    setRunnerState: (partial: Partial<{ stats: RunStats | null; isRunning: boolean; isPaused: boolean; isLoadingSpecs: boolean }>) => void;
}

export const useAppStore = create<AppState>((set) => ({
    // UI State
    activeTab: 'heatmap',
    isSidebarOpen: false,
    isConfigOpen: false,
    isSidebarHiddenDesktop: false,
    isConfigHiddenDesktop: false,

    // Fuzzing State
    liveCount: 0,
    liveRunId: null,
    loadedRunId: null,
    heatmapFilter: null,
    selectedResult: null,

    // Live Stats
    stats: null,
    historyStats: null,
    isRunning: false,
    isPaused: false,
    isLoadingSpecs: false,

    // Actions
    setActiveTab: (tab) => set({ activeTab: tab }),
    setIsSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
    setIsConfigOpen: (isOpen) => set({ isConfigOpen: isOpen }),
    setIsSidebarHiddenDesktop: (isHidden) => set({ isSidebarHiddenDesktop: isHidden }),
    setIsConfigHiddenDesktop: (isHidden) => set({ isConfigHiddenDesktop: isHidden }),
    
    setLiveCount: (count) => set({ liveCount: count }),
    incrementLiveCount: () => set((state) => ({ liveCount: state.liveCount + 1 })),
    setLiveRunId: (runId) => set({ liveRunId: runId }),
    setLoadedRunId: (runId) => set({ loadedRunId: runId }),
    setHistoryStats: (stats) => set({ historyStats: stats }),
    setHeatmapFilter: (filter) => set({ heatmapFilter: filter }),
    setSelectedResult: (result) => set({ selectedResult: result }),
    
    setRunnerState: (partial) => set(partial),
}));
