import { useState } from 'react';
import type { RunStats } from '@swazz/core';
import type { ResultSummary } from './useRunner.js';

interface UseRunHistoryProps {
    runs: any[];
    getRunResults: (id: string) => Promise<ResultSummary[]>;
    deleteRun: (id: string) => Promise<void>;
    showToast: (message: string, type: 'info' | 'success' | 'error') => void;
    onRunLoaded: () => void;
}

export function useRunHistory({ runs, getRunResults, deleteRun, showToast, onRunLoaded }: UseRunHistoryProps) {
    const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
    const [historyRows, setHistoryRows] = useState<ResultSummary[]>([]);
    const [historyStats, setHistoryStats] = useState<RunStats | null>(null);

    const handleLoadRun = async (runId: string, importedRun?: any) => {
        const runData = importedRun || runs.find(r => r.id === runId);
        if (!runData) return;
        
        showToast(`Loading scan...`, 'info');
        const rows = await getRunResults(runId);
        setHistoryRows(rows);
        setHistoryStats(runData.stats);
        setLoadedRunId(runId);
        onRunLoaded();
        showToast(`Loaded ${rows.length} results from history`, 'success');
    };

    const handleDeleteRun = async (runId: string) => {
        await deleteRun(runId);
        if (loadedRunId === runId) {
            setLoadedRunId(null);
            setHistoryRows([]);
            setHistoryStats(null);
        }
        showToast('Run deleted', 'success');
    };

    const handleExport = (activeRows: ResultSummary[], baseUrl?: string) => {
        if (activeRows.length === 0) {
            showToast('No results to export yet', 'error');
            return;
        }
        const data = {
            exportedAt: new Date().toISOString(),
            baseUrl: baseUrl,
            totalRequests: activeRows.length,
            summary: {
                crashes5xx: activeRows.filter((r) => r.status >= 500).length,
                errors4xx: activeRows.filter((r) => r.status >= 400 && r.status < 500).length,
                success2xx: activeRows.filter((r) => r.status >= 200 && r.status < 300).length,
                networkErrors: activeRows.filter((r) => r.status === 0).length,
                totalRetries: activeRows.reduce((sum: number, r) => sum + (r.retries ?? 0), 0),
            },
            results: activeRows,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swazz-results-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${activeRows.length} results`, 'success');
    };

    return { loadedRunId, setLoadedRunId, historyRows, historyStats, handleLoadRun, handleDeleteRun, handleExport };
}
