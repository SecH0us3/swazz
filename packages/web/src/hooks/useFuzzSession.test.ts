// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFuzzSession } from './useFuzzSession.js';
import { useAppStore } from '../store/appStore.js';
import type { SwazzConfig } from '../types.js';

describe('useFuzzSession hook', () => {
    const mockUpdateConfig = vi.fn();
    const mockStart = vi.fn();
    const mockConnectToExisting = vi.fn();
    const mockSaveRun = vi.fn();
    const mockGetDb = vi.fn();
    const mockShowToast = vi.fn();

    const initialConfig: SwazzConfig = {
        base_url: 'https://api.example.com',
        global_headers: {},
        cookies: {},
        dictionaries: {},
        settings: {
            concurrency: 5,
            timeout_ms: 5000,
            max_payload_size_bytes: 1048576,
            delay_between_requests_ms: 0,
            profiles: ['RANDOM'],
            iterations_per_profile: 10,
            analyze_response_body: true,
            time_anomaly_threshold_ms: 4000,
            response_size_anomaly_multiplier: 5,
            bola_testing: false,
            auth_headers: [],
            auth_cookies: [],
            bola_similarity_threshold: 0.85,
            rate_limit_check: false,
            rate_limit_burst_size: 50,
        },
        endpoints: [
            { path: '/api/admin', method: 'GET', schema: {} },
            { path: '/api/users', method: 'POST', schema: {} },
            { path: '/api/health', method: 'GET', schema: {} }
        ],
        disabled_endpoints: [],
        _swagger_urls: ['https://example.com/swagger.json'],
        security: { allow_private_ips: false },
        rules: { ignore: [] }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            activeProject: { id: 'proj-123', name: 'Test Proj', description: '' },
            liveRunId: null,
            liveCount: 0,
            activeTab: 'heatmap',
            isLoadingSpecs: false,
        });
    });

    it('should run scan with all endpoints when disabled_endpoints is empty', async () => {
        const { result } = renderHook(() => useFuzzSession({
            config: initialConfig,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockStart).toHaveBeenCalled();
        const startArgs = mockStart.mock.calls[0][0];
        expect(startArgs.endpoints.length).toBe(3);
        expect(startArgs.disabled_endpoints).toBeUndefined();
        expect(mockShowToast).toHaveBeenCalledWith('Fuzzing 3 endpoints...', 'info');
    });

    it('should filter out disabled endpoints case-insensitively and using wildcards', async () => {
        const configWithDisabled = {
            ...initialConfig,
            disabled_endpoints: ['GET /API/ADMIN', '**/health']
        };

        const { result } = renderHook(() => useFuzzSession({
            config: configWithDisabled,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockStart).toHaveBeenCalled();
        const startArgs = mockStart.mock.calls[0][0];
        // Only POST /api/users should remain
        expect(startArgs.endpoints.length).toBe(1);
        expect(startArgs.endpoints[0].path).toBe('/api/users');
        expect(startArgs.endpoints[0].method).toBe('POST');
        expect(startArgs.disabled_endpoints).toBeUndefined();
        expect(mockShowToast).toHaveBeenCalledWith('Fuzzing 1 endpoint...', 'info');
    });

    it('should guard and show toast error when all endpoints are disabled', async () => {
        const configAllDisabled = {
            ...initialConfig,
            disabled_endpoints: ['/api/**']
        };

        const { result } = renderHook(() => useFuzzSession({
            config: configAllDisabled,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockStart).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('No active endpoints to fuzz', 'error');
    });

    it('should connect to an existing running scan and handle completion', async () => {
        mockConnectToExisting.mockImplementation(async (runId, onResult, onComplete) => {
            onResult({ endpoint: '/api/v1/test', status: 200, duration: 25 });
            onComplete({ total: 1, errors: 0, anomalies: 0 });
        });

        const { result } = renderHook(() => useFuzzSession({
            config: initialConfig,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        await act(async () => {
            await result.current.handleConnectToExisting('existing-run-999', Date.now() - 5000, 'https://api.example.com', 'manual', 'running');
        });

        expect(mockConnectToExisting).toHaveBeenCalledWith(
            'existing-run-999',
            expect.any(Function),
            expect.any(Function)
        );
        expect(mockSaveRun).toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Scan complete'), 'success');
    });

    it('should handle start error when runner is already in progress', async () => {
        mockStart.mockRejectedValueOnce(new Error('scan is already in progress'));

        const { result } = renderHook(() => useFuzzSession({
            config: initialConfig,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining('Server is busy'),
            'error'
        );
    });

    it('should guard and show error when no Swagger URLs and no endpoints are configured', async () => {
        const emptyConfig: SwazzConfig = {
            ...initialConfig,
            endpoints: [],
            _swagger_urls: []
        };

        const { result } = renderHook(() => useFuzzSession({
            config: emptyConfig,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        await act(async () => {
            await result.current.handleStart();
        });

        expect(mockStart).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('Add at least one Swagger URL to begin', 'error');
    });

    it('should handle paused status in connectToExisting and connection errors', async () => {
        mockConnectToExisting.mockRejectedValueOnce(new Error('Socket disconnected'));

        const { result } = renderHook(() => useFuzzSession({
            config: initialConfig,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        await act(async () => {
            await result.current.handleConnectToExisting('run-err', Date.now(), 'https://api.example.com', 'manual', 'paused');
        });

        expect(useAppStore.getState().isPaused).toBe(true);
        expect(mockShowToast).toHaveBeenCalledWith('Failed to connect to active scan: Socket disconnected', 'error');
        expect(useAppStore.getState().liveRunId).toBeNull();
    });

    it('should return undefined when loadEndpoints is called with empty array', async () => {
        const { result } = renderHook(() => useFuzzSession({
            config: initialConfig,
            updateConfig: mockUpdateConfig,
            start: mockStart,
            connectToExisting: mockConnectToExisting,
            saveRun: mockSaveRun,
            getDb: mockGetDb,
            showToast: mockShowToast,
        }));

        let res;
        await act(async () => {
            res = await result.current.loadEndpoints([]);
        });

        expect(res).toBeUndefined();
    });
});
