// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWebMcp } from './useWebMcp.js';
import * as webMcpService from '../services/webMcpService.js';

describe('useWebMcp', () => {
    let mockModelContext: any;
    let registerSpy: any;

    beforeEach(() => {
        mockModelContext = {
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
        };
        vi.spyOn(webMcpService, 'getBrowserModelContext').mockReturnValue(mockModelContext);
        registerSpy = vi.spyOn(webMcpService, 'registerSwazzWebMcpTools');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not register tools if enabled is false', () => {
        renderHook(() =>
            useWebMcp({
                enabled: false,
                updateConfig: vi.fn(),
                updateProfiles: vi.fn(),
                startScan: vi.fn(),
            })
        );
        expect(registerSpy).not.toHaveBeenCalled();
    });

    it('registers tools if enabled is true and unregisters on unmount', () => {
        const { unmount } = renderHook(() =>
            useWebMcp({
                enabled: true,
                updateConfig: vi.fn(),
                updateProfiles: vi.fn(),
                startScan: vi.fn(),
            })
        );
        expect(registerSpy).toHaveBeenCalled();

        unmount();
        expect(mockModelContext.unregisterTool).toHaveBeenCalled();
    });
});
