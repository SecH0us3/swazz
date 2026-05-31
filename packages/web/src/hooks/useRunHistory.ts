import type { RunStats } from '../types.js';
import type { ResultSummary } from './useRunner.js';
import type { QueryOptions } from './useDb.js';
import { useAppStore } from '../store/appStore.js';

interface UseRunHistoryProps {
    runs: any[];
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
    getRunResults: (id: string) => Promise<ResultSummary[]>;
    deleteRun: (id: string) => Promise<void>;
    showToast: (message: string, type: 'info' | 'success' | 'error') => void;
    onRunLoaded: () => void;
}

export function useRunHistory({ runs, queryResults, getRunResults, deleteRun, showToast, onRunLoaded }: UseRunHistoryProps) {
    // No need to subscribe to store state here since we use getState() in callbacks

    const handleLoadRun = async (runId: string, importedRun?: any) => {
        const runData = importedRun || runs.find(r => r.id === runId);
        if (!runData) return;
        useAppStore.setState({
            historyStats: runData.stats,
            loadedRunId: runId,
        });
        onRunLoaded();
        showToast(`Loaded run from history`, 'success');
    };

    const handleDeleteRun = async (runId: string) => {
        await deleteRun(runId);
        if (useAppStore.getState().loadedRunId === runId) {
            useAppStore.setState({ loadedRunId: null, historyStats: null });
        }
        showToast('Run deleted', 'success');
    };

    const handleExport = async (runId: string | null, baseUrl?: string) => {
        if (!runId) {
            showToast('No run selected to export', 'error');
            return;
        }
        showToast('Preparing export…', 'info');
        const rows = await getRunResults(runId);
        if (rows.length === 0) {
            showToast('No results to export', 'error');
            return;
        }
        const data = {
            exportedAt: new Date().toISOString(),
            baseUrl,
            totalRequests: rows.length,
            summary: {
                crashes5xx: rows.filter(r => r.status >= 500).length,
                errors4xx: rows.filter(r => r.status >= 400 && r.status < 500).length,
                success2xx: rows.filter(r => r.status >= 200 && r.status < 300).length,
                networkErrors: rows.filter(r => r.status === 0).length,
                totalRetries: rows.reduce((sum, r) => sum + (r.retries ?? 0), 0),
            },
            results: rows,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swazz-results-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${rows.length.toLocaleString()} results`, 'success');
    };

    const handleExportHTML = async (runId: string | null) => {
        if (!runId) {
            showToast('No active run or selected history to export', 'error');
            return;
        }
        showToast('Generating HTML report…', 'info');
        try {
            const res = await fetch(`/api/report?format=html&runId=${runId}`);
            if (!res.ok) throw new Error('Failed to generate report');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `swazz-report-${Date.now()}.html`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Report downloaded', 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Export failed', 'error');
        }
    };

    const handleExportMD = async (runId: string | null) => {
        if (!runId) {
            showToast('No active run or selected history to export', 'error');
            return;
        }
        showToast('Generating Markdown report…', 'info');
        try {
            const res = await fetch(`/api/report?format=md&runId=${runId}`);
            if (!res.ok) throw new Error('Failed to generate report');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `swazz-report-${Date.now()}.md`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Markdown downloaded', 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Export failed', 'error');
        }
    };

    return {
        handleLoadRun, handleDeleteRun, handleExport, handleExportHTML, handleExportMD,
        queryResults,
    };
}
