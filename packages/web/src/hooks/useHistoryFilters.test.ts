// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ScanRun } from './useDb.js';
import {
    isValidDateInput,
    formatLocalDateInput,
    getPresetRange,
    detectActivePreset,
    localDateStartMs,
    localDateEndMs,
    matchesHistoryFilters,
    readHistoryFiltersFromUrl,
    writeHistoryFiltersToUrl,
} from './useHistoryFilters.js';

function makeRun(over: Partial<ScanRun> = {}): ScanRun {
    return {
        id: 'r1',
        startedAt: new Date(2026, 9, 15, 12, 0, 0).getTime(),
        completedAt: new Date(2026, 9, 15, 12, 1, 0).getTime(),
        baseUrl: 'https://api.example.com/v1',
        stats: { statusCounts: { '200': 5 } } as any,
        ...over,
    };
}

describe('useHistoryFilters helpers', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/');
    });

    it('validates real Gregorian calendar dates strictly', () => {
        expect(isValidDateInput('2026-10-15')).toBe(true);
        expect(isValidDateInput('2024-02-29')).toBe(true);
        expect(isValidDateInput('2026-02-29')).toBe(false);
        expect(isValidDateInput('2026-04-31')).toBe(false);
        expect(isValidDateInput('2026-13-01')).toBe(false);
        expect(isValidDateInput('2026-1-5')).toBe(false);
        expect(isValidDateInput('not-a-date')).toBe(false);
    });

    it('computes and detects quick date presets relative to a reference date', () => {
        const ref = new Date(2026, 9, 20, 14, 30, 0); // 2026-10-20 local
        expect(formatLocalDateInput(ref)).toBe('2026-10-20');

        const today = getPresetRange('today', ref);
        expect(today).toEqual({ from: '2026-10-20', to: '2026-10-20' });
        expect(detectActivePreset(today.from, today.to, ref)).toBe('today');

        const last7 = getPresetRange('7d', ref);
        expect(last7).toEqual({ from: '2026-10-14', to: '2026-10-20' });
        expect(detectActivePreset(last7.from, last7.to, ref)).toBe('7d');

        const last30 = getPresetRange('30d', ref);
        expect(last30).toEqual({ from: '2026-09-21', to: '2026-10-20' });
        expect(detectActivePreset(last30.from, last30.to, ref)).toBe('30d');

        expect(detectActivePreset('2026-10-01', '2026-10-10', ref)).toBeNull();
    });

    it('matches Target Base URL case-insensitively including special characters', () => {
        const r = makeRun({ baseUrl: 'https://Staging.Example.com/100%_test\\v1?foo=bar' });
        expect(matchesHistoryFilters(r, { targetUrl: 'STAGING.EXAMPLE.COM', dateFrom: '', dateTo: '' })).toBe(true);
        expect(matchesHistoryFilters(r, { targetUrl: '  100%_test\\v1  ', dateFrom: '', dateTo: '' })).toBe(true);
        expect(matchesHistoryFilters(r, { targetUrl: 'other.example.com', dateFrom: '', dateTo: '' })).toBe(false);
    });

    it('matches inclusive local day boundaries accurately', () => {
        const dayStart = localDateStartMs('2026-10-15')!;
        const dayEnd = localDateEndMs('2026-10-15')!;

        expect(matchesHistoryFilters(makeRun({ startedAt: dayStart - 1 }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(false);
        expect(matchesHistoryFilters(makeRun({ startedAt: dayStart }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(true);
        expect(matchesHistoryFilters(makeRun({ startedAt: dayEnd }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(true);
        expect(matchesHistoryFilters(makeRun({ startedAt: dayEnd + 1 }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(false);
    });

    it('reads and writes URL query parameters while preserving unrelated params and rejecting invalid dates', () => {
        window.history.replaceState({}, '', '/?keep=1&history_url=api.test&history_from=2026-10-01&history_to=2026-02-30');
        expect(readHistoryFiltersFromUrl()).toEqual({
            searchQuery: 'api.test',
            dateFrom: '2026-10-01',
            dateTo: '',
        });

        writeHistoryFiltersToUrl({ searchQuery: 'staging.test', dateFrom: '2026-10-02', dateTo: '2026-10-05' });
        const params = new URLSearchParams(window.location.search);
        expect(params.get('keep')).toBe('1');
        expect(params.get('history_url')).toBe('staging.test');
        expect(params.get('history_from')).toBe('2026-10-02');
        expect(params.get('history_to')).toBe('2026-10-05');

        writeHistoryFiltersToUrl({ searchQuery: '', dateFrom: '', dateTo: '' });
        const cleared = new URLSearchParams(window.location.search);
        expect(cleared.get('keep')).toBe('1');
        expect(cleared.has('history_url')).toBe(false);
        expect(cleared.has('history_from')).toBe(false);
        expect(cleared.has('history_to')).toBe(false);
    });
});
