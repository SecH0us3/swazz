// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ScanRun } from './useDb.js';
import { fetchScansPage, serverScanToScanRun } from '../services/scansService.js';

export const HISTORY_PAGE_SIZE = 25;
export const SERVER_FILTER_PAGE_SIZE = 50;
export const HISTORY_SEARCH_DEBOUNCE_MS = 250;

export type HistoryTab = 'all' | 'active' | 'completed' | 'failed';
export type DatePreset = 'today' | '7d' | '30d';

export const HISTORY_URL_PARAM = 'history_url';
export const HISTORY_FROM_PARAM = 'history_from';
export const HISTORY_TO_PARAM = 'history_to';

const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validates a YYYY-MM-DD date string against the real Gregorian calendar. */
export function isValidDateInput(val: string): boolean {
    const match = DATE_INPUT_RE.exec(val);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/** Formats a Date as a local calendar YYYY-MM-DD string. */
export function formatLocalDateInput(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/** Returns inclusive local calendar date bounds for a quick preset. */
export function getPresetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);
    if (preset === '7d') {
        start.setDate(start.getDate() - 6);
    } else if (preset === '30d') {
        start.setDate(start.getDate() - 29);
    }
    return {
        from: formatLocalDateInput(start),
        to: formatLocalDateInput(end),
    };
}

/** Detects whether the current from/to dates match one of the quick presets. */
export function detectActivePreset(from: string, to: string, now: Date = new Date()): DatePreset | null {
    if (!from || !to) return null;
    for (const preset of ['today', '7d', '30d'] as const) {
        const range = getPresetRange(preset, now);
        if (range.from === from && range.to === to) return preset;
    }
    return null;
}

/** Returns the local start-of-day timestamp (00:00:00.000) in epoch ms for YYYY-MM-DD. */
export function localDateStartMs(dateStr: string): number | null {
    if (!isValidDateInput(dateStr)) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** Returns the local end-of-day timestamp (23:59:59.999) in epoch ms for YYYY-MM-DD. */
export function localDateEndMs(dateStr: string): number | null {
    if (!isValidDateInput(dateStr)) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/** Converts a local YYYY-MM-DD start date to an ISO-8601 UTC timestamp for the server API. */
export function localDateStartIso(dateStr: string): string | undefined {
    const ms = localDateStartMs(dateStr);
    return ms === null ? undefined : new Date(ms).toISOString();
}

/** Converts a local YYYY-MM-DD end date to an ISO-8601 UTC timestamp for the server API. */
export function localDateEndIso(dateStr: string): string | undefined {
    const ms = localDateEndMs(dateStr);
    return ms === null ? undefined : new Date(ms).toISOString();
}

/**
 * Folds ASCII uppercase letters (A-Z) to lowercase (a-z) to match SQLite LOWER() semantics
 * used by GET /api/scans so client and server Target Base URL filtering behave identically.
 */
export function toAsciiLowerCase(value: string): string {
    return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

/** Checks whether a ScanRun matches the Target Base URL substring and inclusive local date range. */
export function matchesHistoryFilters(
    run: ScanRun,
    criteria: { targetUrl: string; dateFrom: string; dateTo: string }
): boolean {
    const needle = toAsciiLowerCase(criteria.targetUrl.trim());
    if (needle) {
        const haystack = toAsciiLowerCase(run.baseUrl || '');
        if (!haystack.includes(needle)) return false;
    }

    if (criteria.dateFrom) {
        const startMs = localDateStartMs(criteria.dateFrom);
        if (startMs !== null && run.startedAt < startMs) return false;
    }

    if (criteria.dateTo) {
        const endMs = localDateEndMs(criteria.dateTo);
        if (endMs !== null && run.startedAt > endMs) return false;
    }

    return true;
}

/** Reads initial Scan History filters from URL query parameters, ignoring malformed dates. */
export function readHistoryFiltersFromUrl(search?: string): {
    searchQuery: string;
    dateFrom: string;
    dateTo: string;
} {
    const rawSearch = search !== undefined
        ? search
        : (typeof window !== 'undefined' ? window.location.search : '');
    const params = new URLSearchParams(rawSearch);
    const searchQuery = params.get(HISTORY_URL_PARAM) ?? '';
    const rawFrom = params.get(HISTORY_FROM_PARAM) ?? '';
    const rawTo = params.get(HISTORY_TO_PARAM) ?? '';
    return {
        searchQuery,
        dateFrom: isValidDateInput(rawFrom) ? rawFrom : '',
        dateTo: isValidDateInput(rawTo) ? rawTo : '',
    };
}

/** Persists Scan History filters into URL query params without disturbing unrelated params. */
export function writeHistoryFiltersToUrl(filters: {
    searchQuery: string;
    dateFrom: string;
    dateTo: string;
}): void {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const url = new URL(window.location.href);
    const trimmedUrl = filters.searchQuery.trim();
    if (trimmedUrl) url.searchParams.set(HISTORY_URL_PARAM, trimmedUrl);
    else url.searchParams.delete(HISTORY_URL_PARAM);

    if (filters.dateFrom && isValidDateInput(filters.dateFrom)) {
        url.searchParams.set(HISTORY_FROM_PARAM, filters.dateFrom);
    } else {
        url.searchParams.delete(HISTORY_FROM_PARAM);
    }

    if (filters.dateTo && isValidDateInput(filters.dateTo)) {
        url.searchParams.set(HISTORY_TO_PARAM, filters.dateTo);
    } else {
        url.searchParams.delete(HISTORY_TO_PARAM);
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
        window.history.replaceState(window.history.state, '', next);
    }
}

function count5xxErrors(run: ScanRun): number {
    if (!run.stats?.statusCounts) return 0;
    return Object.entries(run.stats.statusCounts)
        .filter(([s]) => s.startsWith('5'))
        .reduce((acc, [, c]) => acc + (c as number), 0);
}

export interface UseHistoryFiltersOptions {
    runs: ScanRun[];
    liveRunId: string | null;
    projectId: string | null;
    token: string | null;
}

export function useHistoryFilters({ runs, liveRunId, projectId, token }: UseHistoryFiltersOptions) {
    const initial = useMemo(() => readHistoryFiltersFromUrl(), []);

    const [searchQuery, setSearchQueryState] = useState<string>(initial.searchQuery);
    const [debouncedSearch, setDebouncedSearch] = useState<string>(initial.searchQuery);
    const [dateFrom, setDateFromState] = useState<string>(initial.dateFrom);
    const [dateTo, setDateToState] = useState<string>(initial.dateTo);
    const [currentTab, setCurrentTabState] = useState<HistoryTab>('all');
    const [page, setPage] = useState<number>(1);

    // Server-backed filtered results when authenticated with an active project.
    const [serverRuns, setServerRuns] = useState<ScanRun[] | null>(null);
    const [serverNextCursor, setServerNextCursor] = useState<string | undefined>(undefined);
    const [isLoadingServer, setIsLoadingServer] = useState<boolean>(false);
    const [isLoadingMoreServer, setIsLoadingMoreServer] = useState<boolean>(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const loadMoreAbortRef = useRef<AbortController | null>(null);

    // Debounce URL search query for server API calls (clear immediately when emptied).
    useEffect(() => {
        if (!searchQuery.trim()) {
            setDebouncedSearch('');
            return;
        }
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, HISTORY_SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const dateRangeError = useMemo(() => {
        if (dateFrom && dateTo && dateFrom > dateTo) {
            return 'Start date must be on or before end date.';
        }
        return null;
    }, [dateFrom, dateTo]);

    const hasActiveFilters = Boolean(searchQuery.trim() || dateFrom || dateTo);
    const hasDebouncedFilters = Boolean(debouncedSearch.trim() || dateFrom || dateTo);
    // Compute directly (no useMemo) so activePreset stays accurate if the tab remains open past midnight.
    const activePreset = detectActivePreset(dateFrom, dateTo);

    // Sync filter state to URL query params.
    useEffect(() => {
        writeHistoryFiltersToUrl({ searchQuery, dateFrom, dateTo });
    }, [searchQuery, dateFrom, dateTo]);

    // Reset pagination to page 1 whenever project changes.
    useEffect(() => {
        setPage(1);
    }, [projectId]);

    // Query backend GET /api/scans when authenticated and filters are active so scans beyond
    // the local background-sync cap are still searchable and accurately paginated.
    useEffect(() => {
        loadMoreAbortRef.current?.abort();
        loadMoreAbortRef.current = null;
        setIsLoadingMoreServer(false);

        if (!token || !projectId || !hasDebouncedFilters || dateRangeError) {
            setServerRuns(null);
            setServerNextCursor(undefined);
            setIsLoadingServer(false);
            setServerError(null);
            return;
        }

        const controller = new AbortController();
        setIsLoadingServer(true);
        setServerError(null);

        fetchScansPage(token, projectId, {
            limit: SERVER_FILTER_PAGE_SIZE,
            from: localDateStartIso(dateFrom),
            to: localDateEndIso(dateTo),
            targetUrl: debouncedSearch.trim() || undefined,
            signal: controller.signal,
        })
            .then((res) => {
                if (controller.signal.aborted) return;
                setServerRuns(res.scans.map(serverScanToScanRun));
                setServerNextCursor(res.nextCursor);
                setIsLoadingServer(false);
            })
            .catch((err: any) => {
                if (controller.signal.aborted || err?.name === 'AbortError') return;
                setServerRuns(null);
                setServerNextCursor(undefined);
                setIsLoadingServer(false);
                setServerError('Showing cached local scans (server filter unavailable).');
            });

        return () => {
            controller.abort();
            loadMoreAbortRef.current?.abort();
            loadMoreAbortRef.current = null;
            setIsLoadingMoreServer(false);
        };
    }, [token, projectId, hasDebouncedFilters, debouncedSearch, dateFrom, dateTo, dateRangeError]);

    const loadMoreServerRuns = useCallback(async () => {
        if (!token || !projectId || !serverNextCursor || isLoadingMoreServer || dateRangeError) return;
        loadMoreAbortRef.current?.abort();
        const controller = new AbortController();
        loadMoreAbortRef.current = controller;
        setIsLoadingMoreServer(true);
        setServerError(null);

        try {
            const res = await fetchScansPage(token, projectId, {
                limit: SERVER_FILTER_PAGE_SIZE,
                cursor: serverNextCursor,
                from: localDateStartIso(dateFrom),
                to: localDateEndIso(dateTo),
                targetUrl: debouncedSearch.trim() || undefined,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            const nextBatch = res.scans.map(serverScanToScanRun);
            setServerRuns((prev) => {
                const existing = prev ?? [];
                const seen = new Set(existing.map((r) => r.id));
                const merged = [...existing];
                for (const item of nextBatch) {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        merged.push(item);
                    }
                }
                return merged;
            });
            setServerNextCursor(res.nextCursor);
        } catch (err: any) {
            if (controller.signal.aborted || err?.name === 'AbortError') return;
            setServerError('Failed to load older matching scans from server.');
        } finally {
            if (loadMoreAbortRef.current === controller) {
                loadMoreAbortRef.current = null;
                setIsLoadingMoreServer(false);
            }
        }
    }, [token, projectId, serverNextCursor, isLoadingMoreServer, dateRangeError, dateFrom, dateTo, debouncedSearch]);

    // Merge server-filtered results with matching local runs (preserving richer local stats and
    // newly created/completed scans not yet present in the last server response).
    const filteredRuns = useMemo(() => {
        if (dateRangeError) return [];
        if (!hasActiveFilters) return runs;

        const criteria = { targetUrl: searchQuery, dateFrom, dateTo };

        if (serverRuns !== null) {
            const localById = new Map(runs.map((r) => [r.id, r]));
            const mergedById = new Map<string, ScanRun>();

            for (const sRun of serverRuns) {
                const local = localById.get(sRun.id);
                const candidate = local
                    ? {
                        ...sRun,
                        ...(local.stats ? { stats: local.stats } : {}),
                        ...(sRun.completedAt === 0 && local.completedAt > 0 ? { completedAt: local.completedAt } : {}),
                    }
                    : sRun;
                // Apply immediate searchQuery check in case user typed since debouncedSearch fired
                if (matchesHistoryFilters(candidate, criteria)) {
                    mergedById.set(candidate.id, candidate);
                }
            }

            // Include all matching local runs (CLI imports, active runs, and freshly completed runs)
            // that are not yet in serverRuns, deduplicated by id.
            for (const localRun of runs) {
                if (!mergedById.has(localRun.id) && matchesHistoryFilters(localRun, criteria)) {
                    mergedById.set(localRun.id, localRun);
                }
            }

            return Array.from(mergedById.values()).sort((a, b) => b.startedAt - a.startedAt);
        }

        return runs.filter((r) => matchesHistoryFilters(r, criteria));
    }, [runs, serverRuns, hasActiveFilters, dateRangeError, searchQuery, dateFrom, dateTo]);

    const activeRuns = useMemo(
        () => filteredRuns.filter((r) => r.completedAt === 0 && r.id === liveRunId),
        [filteredRuns, liveRunId]
    );

    const completedRuns = useMemo(
        () => filteredRuns.filter((r) => r.completedAt > 0 && count5xxErrors(r) === 0 && !r.failureReason),
        [filteredRuns]
    );

    const failedRuns = useMemo(
        () => filteredRuns.filter((r) =>
            !!r.failureReason ||
            (r.completedAt > 0 && count5xxErrors(r) > 0) ||
            (r.completedAt === 0 && r.id !== liveRunId)
        ),
        [filteredRuns, liveRunId]
    );

    const displayRuns = currentTab === 'all'
        ? filteredRuns
        : currentTab === 'active'
            ? activeRuns
            : currentTab === 'completed'
                ? completedRuns
                : failedRuns;

    const totalPages = Math.max(1, Math.ceil(displayRuns.length / HISTORY_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);

    const paginatedRuns = useMemo(() => {
        const start = (safePage - 1) * HISTORY_PAGE_SIZE;
        return displayRuns.slice(start, start + HISTORY_PAGE_SIZE);
    }, [displayRuns, safePage]);

    // Filter mutators always reset pagination to page 1.
    const setSearchQuery = useCallback((value: string) => {
        setSearchQueryState(value);
        setPage(1);
    }, []);

    const clearSearch = useCallback(() => {
        setSearchQueryState('');
        setDebouncedSearch('');
        setPage(1);
    }, []);

    const setDateFrom = useCallback((value: string) => {
        setDateFromState(value);
        setPage(1);
    }, []);

    const setDateTo = useCallback((value: string) => {
        setDateToState(value);
        setPage(1);
    }, []);

    const applyPreset = useCallback((preset: DatePreset) => {
        const range = getPresetRange(preset);
        const isSame = dateFrom === range.from && dateTo === range.to;
        setDateFromState(isSame ? '' : range.from);
        setDateToState(isSame ? '' : range.to);
        setPage(1);
    }, [dateFrom, dateTo]);

    const resetFilters = useCallback(() => {
        setSearchQueryState('');
        setDebouncedSearch('');
        setDateFromState('');
        setDateToState('');
        setPage(1);
    }, []);

    const setCurrentTab = useCallback((tab: HistoryTab) => {
        setCurrentTabState(tab);
        setPage(1);
    }, []);

    const removeRun = useCallback((runId: string) => {
        setServerRuns((prev) => (prev ? prev.filter((r) => r.id !== runId) : prev));
    }, []);

    return {
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
        page: safePage,
        totalPages,
        setPage,
        pageSize: HISTORY_PAGE_SIZE,
        isLoadingServer,
        isLoadingMoreServer,
        serverError,
        hasMoreServerResults: Boolean(serverNextCursor),
        loadMoreServerRuns,
        removeRun,
    };
}
