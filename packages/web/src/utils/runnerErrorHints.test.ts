// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { hintForRunnerMessage } from './runnerErrorHints.js';

describe('hintForRunnerMessage', () => {
    it('points an MCP credentials failure to the project settings', () => {
        const hint = hintForRunnerMessage('[MCP] ⚠️ could not connect to the MCP server: SSE connection failed with status 401.');
        expect(hint?.text).toMatch(/Global Headers/);
        expect(hint?.action?.tab).toBe('project_settings');
    });

    it('covers other MCP failures, lost runners, login, empty scans and private targets', () => {
        expect(hintForRunnerMessage('could not list the MCP server\'s tools: timeout')?.action?.tab).toBe('project_settings');
        expect(hintForRunnerMessage('The runner executing this scan stopped responding, and no runner took the scan over.')?.action?.tab).toBe('settings');
        expect(hintForRunnerMessage('Automatic re-authentication failed: 500')?.text).toMatch(/authentication/);
        expect(hintForRunnerMessage('[Runner] Cannot start scan: no endpoints')?.text).toMatch(/Import an OpenAPI/);
        expect(hintForRunnerMessage('blocked: target resolves to a private IP')?.text).toMatch(/your own runner/);
    });

    it('has nothing to say about an unknown message', () => {
        expect(hintForRunnerMessage('something odd happened')).toBeNull();
    });
});
