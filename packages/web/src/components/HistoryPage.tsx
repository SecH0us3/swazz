// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useRef, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import type { ScanRun } from '../hooks/useDb.js';
import { useToast } from '../hooks/useToast.js';
import { useFeatureGate } from '../hooks/useFeatureGate.js';
import { useHistoryFilters, type DatePreset } from '../hooks/useHistoryFilters.js';
import { FEATURE_REPORT_EXPORTS, FEATURE_CLOUD_HISTORY } from '@swazz/shared';

interface HistoryPageProps {
    runs: ScanRun[];
    onLoadRun: (runId: string, importedRun?: any) => void;
    onDeleteRun: (runId: string) => void;
    onImportRun: (data: any) => Promise<{ runId: string; run: any } | undefined>;
    onExport: (runId: string | null, baseUrl?: string) => void;
    onExportHTML: (runId: string | null) => void;
    onExportMD: (runId: string | null) => void;
    onExportExecutiveSummary?: (runId: string) => void;
}

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
];

function formatDate(epoch: number): string {
    const d = new Date(epoch);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function getAuthToken(): string | null {
    try {
        return typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    } catch {
        return null;
    }
}

export function HistoryPage({
    runs,
    onLoadRun,
    onDeleteRun,
    onImportRun,
    onExport,
    onExportHTML,
    onExportMD,
    onExportExecutiveSummary,
}: HistoryPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const loadedRunId = useAppStore(state => state.loadedRunId);
    const liveRunId = useAppStore(state => state.liveRunId);
    const activeProjectId = useAppStore(state => state.activeProject?.id ?? null);
    const { showToast } = useToast();
    const gateReportExports = useFeatureGate(FEATURE_REPORT_EXPORTS);
    const gateCloudHistory = useFeatureGate(FEATURE_CLOUD_HISTORY);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    const token = getAuthToken();

    const {
        searchQuery,
        setSearchQuery,
        clearSearch,
        dateFrom,
        setDateFrom,
        dateTo,
        setDateTo,
        activePreset,
        applyPreset,
        dateRangeError,
        hasActiveFilters,
        resetFilters,
        currentTab,
        setCurrentTab,
        filteredRuns,
        activeRuns,
        completedRuns,
        failedRuns,
        displayRuns,
        paginatedRuns,
        page,
        totalPages,
        setPage,
        pageSize,
        isLoadingServer,
        isLoadingMoreServer,
        serverError,
        hasMoreServerResults,
        loadMoreServerRuns,
        removeRun,
    } = useHistoryFilters({
        runs,
        liveRunId,
        projectId: activeProjectId,
        token,
    });

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const json = JSON.parse(evt.target?.result as string);
                const result = await onImportRun(json);
                if (result) {
                    const { runId, run } = result;
                    onLoadRun(runId, run);
                }
            } catch (err: any) {
                showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleClearSearch = () => {
        clearSearch();
        searchInputRef.current?.focus();
    };

    const formatDuration = (start: number, end: number) => {
        if (!start || !end) return '-';
        const diffMs = end - start;
        if (diffMs < 0) return '0s';
        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs < 60) return `${diffSecs}s`;
        const mins = Math.floor(diffSecs / 60);
        const secs = diffSecs % 60;
        return `${mins}m ${secs}s`;
    };

    const showInitialEmpty = runs.length === 0 && !hasActiveFilters && !isLoadingServer;
    const rangeStart = displayRuns.length === 0 ? 0 : (page - 1) * pageSize + 1;
    const rangeEnd = Math.min(page * pageSize, displayRuns.length);

    return (
        <div className="history-page">
            {/* Header */}
            <div className="history-page-header">
                <div>
                    <h1 className="history-page-title">Scan History</h1>
                    <p className="history-page-subtitle">
                        Manage past fuzzing sessions, analyze anomaly reports, and export scan artifacts.
                    </p>
                </div>
                <div className="history-page-actions">
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="history-file-input"
                        accept=".json"
                        onChange={handleFileChange}
                    />
                    <button
                        type="button"
                        className="btn btn-secondary history-header-btn"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        Import CLI Report
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary history-header-btn"
                        onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                    >
                        Dashboard
                    </button>
                </div>
            </div>

            {/* Content area */}
            {showInitialEmpty ? (
                <div className="history-empty-wrapper">
                    <div className="empty-state history-empty-card">
                        <div className="empty-state-icon history-empty-icon" aria-hidden="true">🕒</div>
                        <div className="empty-state-title history-empty-title">No scan history yet</div>
                        <div className="empty-state-text history-empty-text">
                            Perform a fuzz test or import a CLI report (JSON format) to view previous execution logs and reports.
                        </div>
                        <button
                            type="button"
                            className="btn btn-primary history-empty-cta"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Import JSON Report
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Search & Date Range Filter Bar */}
                    <search className="history-filters-bar" aria-label="Filter scan history">
                        <form
                            className="history-filters-form"
                            onSubmit={(e) => e.preventDefault()}
                        >
                            <div className="history-filter-group history-filter-group--search">
                                <label htmlFor="history-url-search" className="history-filter-label">
                                    Target Base URL
                                </label>
                                <div className="history-search-input-wrap">
                                    <svg
                                        className="history-search-icon"
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <circle cx="11" cy="11" r="8" />
                                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                    </svg>
                                    <input
                                        ref={searchInputRef}
                                        id="history-url-search"
                                        name="target_url"
                                        type="search"
                                        className="history-filter-input history-search-input"
                                        placeholder="Search target base URL (e.g. api.example.com)…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        enterKeyHint="search"
                                        data-1p-ignore="true"
                                    />
                                    {searchQuery.length > 0 && (
                                        <button
                                            type="button"
                                            className="history-search-clear-btn"
                                            onClick={handleClearSearch}
                                            aria-label="Clear target URL search"
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                                <line x1="18" y1="6" x2="6" y2="18" />
                                                <line x1="6" y1="6" x2="18" y2="18" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="history-filter-dates">
                                <div className="history-filter-group">
                                    <label htmlFor="history-date-from" className="history-filter-label">
                                        From
                                    </label>
                                    <input
                                        id="history-date-from"
                                        name="from"
                                        type="date"
                                        className={`history-filter-input history-date-input ${dateRangeError ? 'is-invalid' : ''}`}
                                        value={dateFrom}
                                        max={dateTo || undefined}
                                        onChange={(e) => setDateFrom(e.target.value)}
                                        aria-invalid={dateRangeError ? 'true' : undefined}
                                        aria-describedby={dateRangeError ? 'history-date-error' : undefined}
                                    />
                                </div>

                                <div className="history-filter-group">
                                    <label htmlFor="history-date-to" className="history-filter-label">
                                        To
                                    </label>
                                    <input
                                        id="history-date-to"
                                        name="to"
                                        type="date"
                                        className={`history-filter-input history-date-input ${dateRangeError ? 'is-invalid' : ''}`}
                                        value={dateTo}
                                        min={dateFrom || undefined}
                                        onChange={(e) => setDateTo(e.target.value)}
                                        aria-invalid={dateRangeError ? 'true' : undefined}
                                        aria-describedby={dateRangeError ? 'history-date-error' : undefined}
                                    />
                                </div>
                            </div>

                            <div className="history-filter-presets" role="group" aria-label="Quick date presets">
                                {DATE_PRESETS.map((preset) => {
                                    const isActive = activePreset === preset.id;
                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            className={`history-preset-btn ${isActive ? 'active' : ''}`}
                                            aria-pressed={isActive}
                                            onClick={() => applyPreset(preset.id)}
                                        >
                                            {preset.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {hasActiveFilters && (
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm history-reset-btn"
                                    onClick={resetFilters}
                                >
                                    Clear filters
                                </button>
                            )}
                        </form>

                        {dateRangeError && (
                            <div id="history-date-error" className="history-filter-error" role="alert">
                                <span aria-hidden="true">⚠</span>
                                <span>{dateRangeError}</span>
                            </div>
                        )}

                        {serverError && !dateRangeError && (
                            <div className="history-filter-notice" role="status" aria-live="polite">
                                {serverError}
                            </div>
                        )}
                    </search>

                    <div className="history-tabs-row">
                        <div className="history-tabs-container">
                            <button type="button" className={`history-tab-btn ${currentTab === 'all' ? 'active' : ''}`} onClick={() => setCurrentTab('all')}>
                                All <span className="history-tab-badge">{filteredRuns.length}</span>
                            </button>
                            <button type="button" className={`history-tab-btn ${currentTab === 'active' ? 'active' : ''}`} onClick={() => setCurrentTab('active')}>
                                Active <span className="history-tab-badge active">{activeRuns.length}</span>
                            </button>
                            <button type="button" className={`history-tab-btn ${currentTab === 'completed' ? 'active' : ''}`} onClick={() => setCurrentTab('completed')}>
                                Completed <span className="history-tab-badge completed">{completedRuns.length}</span>
                            </button>
                            <button type="button" className={`history-tab-btn ${currentTab === 'failed' ? 'active' : ''}`} onClick={() => setCurrentTab('failed')}>
                                Failed <span className="history-tab-badge failed">{failedRuns.length}</span>
                            </button>
                        </div>

                        {hasActiveFilters && !dateRangeError && (
                            <div className="history-filter-summary" aria-live="polite">
                                {isLoadingServer
                                    ? 'Searching scan history…'
                                    : `${displayRuns.length} matching ${displayRuns.length === 1 ? 'scan' : 'scans'}`}
                            </div>
                        )}
                    </div>

                    {isLoadingServer && displayRuns.length === 0 ? (
                        <div className="history-empty-tab-state">
                            <div className="spinner history-loading-spinner" />
                            <div>Searching scan history…</div>
                        </div>
                    ) : displayRuns.length === 0 ? (
                        hasActiveFilters ? (
                            <div className="history-empty-tab-state history-empty-filter-state">
                                <div className="empty-state-icon history-empty-tab-icon" aria-hidden="true">
                                    {dateRangeError ? '📅' : '🔍'}
                                </div>
                                <div className="history-empty-filter-title">
                                    {dateRangeError ? 'Invalid date range' : 'No scans match your filters'}
                                </div>
                                <div className="history-empty-filter-desc">
                                    {dateRangeError
                                        ? dateRangeError
                                        : 'Try adjusting the date range or clearing the Target Base URL search.'}
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm history-empty-reset-btn"
                                    onClick={resetFilters}
                                >
                                    Reset filters
                                </button>
                            </div>
                        ) : (
                            <div className="history-empty-tab-state">
                                <div className="empty-state-icon history-empty-tab-icon" aria-hidden="true">🔍</div>
                                <div>No scans found in this category</div>
                            </div>
                        )
                    ) : (
                        <>
                            <div className="history-table-card">
                                <table className="history-table">
                                    <thead>
                                        <tr className="history-table-head-row">
                                            <th scope="col" className="history-checkbox-header">
                                                <span className="visually-hidden">Select</span>
                                            </th>
                                            <th scope="col" className="history-th">
                                                <div className="history-th-date">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="history-th-icon" aria-hidden="true">
                                                        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                                                    </svg>
                                                    Scan Date
                                                </div>
                                            </th>
                                            <th scope="col" className="history-th">Target Base URL</th>
                                            <th scope="col" className="history-th">Stats</th>
                                            <th scope="col" className="history-th">Crashes / Anomalies</th>
                                            <th scope="col" className="history-th history-th--actions">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedRuns.map((r, i) => {
                                            const errors5xx = r.stats?.statusCounts
                                                ? Object.entries(r.stats.statusCounts)
                                                    .filter(([s]) => s.startsWith('5'))
                                                    .reduce((acc: number, [, c]) => acc + (c as number), 0)
                                                : 0;
                                            const isLoaded = loadedRunId === r.id;
                                            const isLastRow = i === paginatedRuns.length - 1;
                                            const existsLocally = runs.some((local) => local.id === r.id);

                                            return (
                                                <tr
                                                    key={r.id}
                                                    className={`history-row ${isLoaded ? 'history-row--loaded' : ''} ${isLastRow ? 'history-row--last' : ''}`}
                                                >
                                                    <td className="history-checkbox-cell">
                                                        <div className="history-checkbox-wrapper">
                                                            <input
                                                                id={`select-run-${r.id}`}
                                                                type="checkbox"
                                                                className="premium-checkbox"
                                                                checked={existsLocally && selectedIds.includes(r.id)}
                                                                disabled={!existsLocally || (selectedIds.length >= 2 && !selectedIds.includes(r.id))}
                                                                title={!existsLocally ? 'Comparison requires locally synced scan results' : undefined}
                                                                aria-label={
                                                                    !existsLocally
                                                                        ? `Cannot compare archived scan ${r.baseUrl || r.id}: local scan data not cached`
                                                                        : `Select scan ${r.baseUrl || r.id} from ${formatDate(r.startedAt)}`
                                                                }
                                                                onChange={() => {
                                                                    if (!existsLocally) return;
                                                                    setSelectedIds(prev =>
                                                                        prev.includes(r.id)
                                                                            ? prev.filter(id => id !== r.id)
                                                                            : [...prev, r.id]
                                                                    );
                                                                }}
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="history-cell history-cell--date">
                                                        <span>{formatDate(r.startedAt)}</span>
                                                        {r.triggerType === 'scheduled' && (
                                                            <span className="badge badge-scheduled">
                                                                Scheduled
                                                            </span>
                                                        )}
                                                        {r.failureReason && (
                                                            <div className="history-failure-reason" title={r.failureReason}>
                                                                Failed: {r.failureReason}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="history-cell history-cell--url" title={r.baseUrl || undefined}>
                                                        {r.baseUrl ? r.baseUrl.replace(/^https?:\/\//i, '') : '(no url)'}
                                                    </td>
                                                    <td className="history-cell history-cell--stats">
                                                        <div className="history-stats-duration">{formatDuration(r.startedAt, r.completedAt)}</div>
                                                        <div className="history-stats-reqs">
                                                            {r.stats?.totalRequests?.toLocaleString() || 0} reqs
                                                        </div>
                                                    </td>
                                                    <td className="history-cell">
                                                        {errors5xx > 0 ? (
                                                            <span className="badge badge-error history-crash-badge">
                                                                {errors5xx} crash{errors5xx > 1 ? 'es' : ''}
                                                            </span>
                                                        ) : (
                                                            <span className="history-ok-badge">
                                                                0 Crashes
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="history-cell history-cell--actions">
                                                        <div className="history-row-actions">
                                                            <button
                                                                type="button"
                                                                className={`btn ${isLoaded ? 'btn-success' : 'btn-secondary'} btn-sm history-load-btn`}
                                                                onClick={() => (existsLocally ? onLoadRun(r.id) : onLoadRun(r.id, r))}
                                                                disabled={isLoaded}
                                                            >
                                                                {isLoaded ? '✓ Loaded' : 'Load Run'}
                                                            </button>

                                                            <div className="history-export-wrap">
                                                                <select
                                                                    className="btn btn-secondary btn-sm history-export-select"
                                                                    aria-label={`Export scan from ${formatDate(r.startedAt)}`}
                                                                    onChange={(e) => {
                                                                        const format = e.target.value;
                                                                        if (format === 'html') onExportHTML(r.id);
                                                                        else if (format === 'md') onExportMD(r.id);
                                                                        else if (format === 'json') onExport(r.id, r.baseUrl);
                                                                        else if (format === 'summary' && onExportExecutiveSummary) onExportExecutiveSummary(r.id);
                                                                        e.target.value = '';
                                                                    }}
                                                                    value=""
                                                                >
                                                                    <option value="" disabled>Export</option>
                                                                    <option value="html" disabled={!gateReportExports.unlocked}>{gateReportExports.unlocked ? 'HTML' : 'HTML 🔒'}</option>
                                                                    <option value="md" disabled={!gateReportExports.unlocked}>{gateReportExports.unlocked ? 'Markdown' : 'Markdown 🔒'}</option>
                                                                    <option value="json">JSON</option>
                                                                    <option value="summary">AI Summary ✨</option>
                                                                </select>
                                                                <svg
                                                                    width="10"
                                                                    height="10"
                                                                    viewBox="0 0 24 24"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    strokeWidth="2.5"
                                                                    className="history-export-caret"
                                                                    aria-hidden="true"
                                                                >
                                                                    <polyline points="6 9 12 15 18 9" />
                                                                </svg>
                                                            </div>

                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-sm history-delete-btn"
                                                                onClick={() => {
                                                                    if (confirm('Delete this scan history?')) {
                                                                        onDeleteRun(r.id);
                                                                        removeRun(r.id);
                                                                        setSelectedIds(prev => prev.filter(id => id !== r.id));
                                                                    }
                                                                }}
                                                                title="Delete Scan Run"
                                                                aria-label="Delete Scan Run"
                                                            >
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {(totalPages > 1 || hasMoreServerResults) && (
                                <nav className="history-pagination" aria-label="Scan history pagination">
                                    <span className="history-pagination-info">
                                        Showing {rangeStart}–{rangeEnd} of {displayRuns.length}
                                        {hasMoreServerResults ? '+' : ''}
                                    </span>
                                    <div className="history-pagination-controls">
                                        {totalPages > 1 && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    disabled={page <= 1}
                                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                                >
                                                    Previous
                                                </button>
                                                <span className="history-pagination-page">
                                                    Page {page} of {totalPages}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    disabled={page >= totalPages}
                                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                                >
                                                    Next
                                                </button>
                                            </>
                                        )}
                                        {hasMoreServerResults && (
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                disabled={isLoadingMoreServer}
                                                onClick={() => void loadMoreServerRuns()}
                                            >
                                                {isLoadingMoreServer ? 'Loading…' : 'Load older matches'}
                                            </button>
                                        )}
                                    </div>
                                </nav>
                            )}
                        </>
                    )}
                </>
            )}
            {selectedIds.length === 2 && (
                <div className="compare-bar">
                    <span className="compare-bar-text">
                        {selectedIds.length} scans selected for comparison
                    </span>
                    <div className="compare-bar-actions">
                        <button
                            type="button"
                            id="compare-scans-clear-btn"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSelectedIds([])}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            id="compare-scans-submit-btn"
                            className="btn btn-primary btn-sm"
                            title={gateCloudHistory.unlocked ? 'Compare Scans' : gateCloudHistory.lockMessage}
                            onClick={() => {
                                if (!gateCloudHistory.unlocked) {
                                    showToast(gateCloudHistory.lockMessage, 'error');
                                    return;
                                }
                                const runA = runs.find(r => r.id === selectedIds[0]);
                                const runB = runs.find(r => r.id === selectedIds[1]);
                                if (!runA || !runB) return;
                                const timeA = runA?.startedAt || 0;
                                const timeB = runB?.startedAt || 0;
                                const sortedIds = timeA <= timeB
                                    ? [selectedIds[0], selectedIds[1]]
                                    : [selectedIds[1], selectedIds[0]];

                                useAppStore.setState({
                                    compareRunIdA: sortedIds[0],
                                    compareRunIdB: sortedIds[1],
                                    activeTab: 'compare'
                                });
                            }}
                        >
                            Compare Scans {!gateCloudHistory.unlocked && (gateCloudHistory.gateType === 'coming_soon' ? '⏳' : '🔒')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
