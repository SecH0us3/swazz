import { useMemo } from 'react';
import type { ResultSummary } from './useRunner.js';
import type { HeatmapFilter } from '../components/Dashboard/Heatmap.js';

export type StatusFilter = 'all' | '2xx' | '4xx' | '5xx';

interface UseInspectorFiltersProps {
    results: ResultSummary[];
    filter: StatusFilter;
    search: string;
    heatmapFilter: HeatmapFilter | null;
    sortConfig: { key: 'timestamp' | 'duration'; direction: 'asc' | 'desc' };
}

export function useInspectorFilters({
    results,
    filter,
    search,
    heatmapFilter,
    sortConfig,
}: UseInspectorFiltersProps) {
    return useMemo(() => {
        let list = results;

        if (heatmapFilter) {
            list = list.filter(
                (r) =>
                    r.method.toUpperCase() === heatmapFilter.method.toUpperCase() &&
                    r.endpoint === heatmapFilter.path &&
                    r.status === heatmapFilter.status,
            );
        } else {
            if (filter === '5xx') list = list.filter((r) => r.status >= 500);
            else if (filter === '4xx') list = list.filter((r) => r.status >= 400 && r.status < 500);
            else if (filter === '2xx') list = list.filter((r) => r.status >= 200 && r.status < 300);
        }

        if (search) {
            const q = search.toLowerCase();
            list = list.filter(
                (r) => r.endpoint.toLowerCase().includes(q) || r.profile.toLowerCase().includes(q),
            );
        }

        list.sort((a, b) => {
            if (sortConfig.key === 'timestamp') {
                return sortConfig.direction === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
            } else {
                return sortConfig.direction === 'asc' ? a.duration - b.duration : b.duration - a.duration;
            }
        });

        return { filtered: list, totalFiltered: list.length };
    }, [results, filter, search, heatmapFilter, sortConfig]);
}
