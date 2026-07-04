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
});
