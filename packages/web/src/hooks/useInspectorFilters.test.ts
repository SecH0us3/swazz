import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInspectorFilters } from './useInspectorFilters.js';
import type { ResultSummary } from './useRunner.js';

const mockResults: ResultSummary[] = [
    {
        id: '1',
        timestamp: 1000,
        method: 'GET',
        endpoint: '/api/users',
        resolvedPath: '/api/users',
        status: 200,
        profile: 'RANDOM',
        duration: 50,
        payloadSize: 0,
        retries: 0,
        payloadPreview: '',
        responsePreview: '',
    },
    {
        id: '2',
        timestamp: 2000,
        method: 'POST',
        endpoint: '/api/login',
        resolvedPath: '/api/login',
        status: 401,
        profile: 'MALICIOUS',
        duration: 150,
        payloadSize: 10,
        retries: 0,
        payloadPreview: '{}',
        responsePreview: 'Unauthorized',
    },
    {
        id: '3',
        timestamp: 1500,
        method: 'GET',
        endpoint: '/api/users/1',
        resolvedPath: '/api/users/1',
        status: 500,
        profile: 'BOUNDARY',
        duration: 100,
        payloadSize: 0,
        retries: 0,
        payloadPreview: '',
        responsePreview: 'Internal Server Error',
    }
];

describe('useInspectorFilters', () => {
    const defaultSort = { key: 'timestamp' as const, direction: 'desc' as const };

    it('should return all results when no filters are applied', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: 'all',
            search: '',
            heatmapFilter: null,
            sortConfig: defaultSort,
        }));

        expect(result.current.filtered).toHaveLength(3);
        expect(result.current.totalFiltered).toBe(3);
        // Default sort is timestamp desc: 2, 3, 1
        expect(result.current.filtered[0].id).toBe('2');
        expect(result.current.filtered[1].id).toBe('3');
        expect(result.current.filtered[2].id).toBe('1');
    });

    it('should filter by status 2xx', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: '2xx',
            search: '',
            heatmapFilter: null,
            sortConfig: defaultSort,
        }));

        expect(result.current.filtered).toHaveLength(1);
        expect(result.current.filtered[0].status).toBe(200);
    });

    it('should filter by status 4xx', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: '4xx',
            search: '',
            heatmapFilter: null,
            sortConfig: defaultSort,
        }));

        expect(result.current.filtered).toHaveLength(1);
        expect(result.current.filtered[0].status).toBe(401);
    });

    it('should filter by status 5xx', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: '5xx',
            search: '',
            heatmapFilter: null,
            sortConfig: defaultSort,
        }));

        expect(result.current.filtered).toHaveLength(1);
        expect(result.current.filtered[0].status).toBe(500);
    });

    it('should filter by search query (endpoint)', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: 'all',
            search: 'login',
            heatmapFilter: null,
            sortConfig: defaultSort,
        }));

        expect(result.current.filtered).toHaveLength(1);
        expect(result.current.filtered[0].endpoint).toBe('/api/login');
    });

    it('should filter by search query (profile)', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: 'all',
            search: 'MALICIOUS',
            heatmapFilter: null,
            sortConfig: defaultSort,
        }));

        expect(result.current.filtered).toHaveLength(1);
        expect(result.current.filtered[0].profile).toBe('MALICIOUS');
    });

    it('should filter by heatmap filter and override status filter', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: '2xx', // Should be ignored because heatmapFilter is present
            search: '',
            heatmapFilter: { method: 'GET', path: '/api/users/1', status: 500 },
            sortConfig: defaultSort,
        }));

        expect(result.current.filtered).toHaveLength(1);
        expect(result.current.filtered[0].id).toBe('3');
    });

    it('should sort by duration asc', () => {
        const { result } = renderHook(() => useInspectorFilters({
            results: mockResults,
            filter: 'all',
            search: '',
            heatmapFilter: null,
            sortConfig: { key: 'duration', direction: 'asc' },
        }));

        expect(result.current.filtered[0].duration).toBe(50);
        expect(result.current.filtered[1].duration).toBe(100);
        expect(result.current.filtered[2].duration).toBe(150);
    });

    it('should not mutate the input results array', () => {
        const resultsCopy = mockResults.map(r => ({ ...r }));
        renderHook(() => useInspectorFilters({
            results: resultsCopy,
            filter: 'all',
            search: '',
            heatmapFilter: null,
            sortConfig: { key: 'duration', direction: 'asc' },
        }));

        // If it mutated, resultsCopy would be sorted by duration
        expect(resultsCopy[0].id).toBe('1');
        expect(resultsCopy[1].id).toBe('2');
        expect(resultsCopy[2].id).toBe('3');
    });
});
