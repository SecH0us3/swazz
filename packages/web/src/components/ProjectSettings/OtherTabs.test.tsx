// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useAppStore } from '../../store/appStore.js';
import { AnomaliesTab } from './AnomaliesTab.js';
import { ApiSpecsTab } from './ApiSpecsTab.js';
import { ChainingTab } from './ChainingTab.js';
import { DictionariesTab } from './DictionariesTab.js';
import { KeysTab } from './KeysTab.js';
import { MembersRolesTab } from './MembersRolesTab.js';
import { PerformanceTab } from './PerformanceTab.js';
import { RawConfigTab } from './RawConfigTab.js';
import { ScheduleTab } from './ScheduleTab.js';
import { WordlistsTab } from './WordlistsTab.js';
import { GeneralTab } from './GeneralTab.js';
import { RunnersTab } from './RunnersTab.js';
import { Section, KVEditor } from '../Sidebar/Shared.js';
import { ChainingRulesEditor } from '../Sidebar/ChainingRulesEditor.js';

vi.mock('../../hooks/useDb.js', () => ({
    useDb: () => ({
        getAllTriaged: vi.fn().mockResolvedValue([
            {
                endpoint: '/api/v1/users',
                method: 'GET',
                status: 500,
                analyzerFindings: [{ ruleId: 'swazz/sqli' }],
                payloadPreview: 'admin" OR 1=1--'
            }
        ]),
        runs: [],
        loadRuns: vi.fn().mockResolvedValue([]),
        deleteRun: vi.fn().mockResolvedValue(undefined),
    })
}));

describe('Other ProjectSettings components', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn((url: string, opts?: any) => {
            if (url.includes('/config')) {
                return Promise.resolve(new Response(JSON.stringify({
                    cron_schedule: '0 0 * * *',
                    last_run_at: '2026-08-24T12:00:00Z'
                }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            if (url.includes('/version')) {
                return Promise.resolve(new Response(JSON.stringify({ version: '1.2.3' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            return Promise.resolve(new Response(JSON.stringify({
                permissions: [],
                roles: [],
                members: [],
                projects: []
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        });

        globalThis.fetch = mockFetch;
        localStorage.clear();
        localStorage.setItem('swazz_token', 'test-token');

        // Mock IndexedDB for KeysTab/E2EE usage
        const mockIDB = {
            open: vi.fn().mockImplementation(() => {
                const req: any = {};
                setTimeout(() => {
                    if (req.onsuccess) {
                        req.result = {
                            createObjectStore: vi.fn(),
                            transaction: vi.fn().mockReturnValue({
                                objectStore: vi.fn().mockReturnValue({
                                    get: vi.fn().mockReturnValue({ onsuccess: null }),
                                    put: vi.fn().mockReturnValue({ onsuccess: null }),
                                    delete: vi.fn().mockReturnValue({ onsuccess: null })
                                })
                            })
                        };
                        req.onsuccess();
                    }
                }, 1);
                return req;
            })
        };
        vi.stubGlobal('indexedDB', mockIDB);

        useAppStore.setState({
            activeProject: {
                id: 'test-project-1',
                name: 'Test Proj',
                description: 'desc',
                url_mappings: '',
                ai_prompts: '{}',
                auto_fix_rules: JSON.stringify([]),
                propose_fixes: 0
            },
            projects: [{ id: 'test-project-1', name: 'Test Proj', description: 'desc' }],
            userProfile: {
                username: 'alice',
                apiKey: 'key-123',
                publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...'
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders AnomaliesTab', async () => {
        render(<AnomaliesTab />);
        await waitFor(() => {
            expect(screen.getByText(/Vulnerability & Anomaly/i)).toBeTruthy();
        });
    });

    it('renders ApiSpecsTab', async () => {
        render(<ApiSpecsTab />);
        await waitFor(() => {
            expect(screen.getByText(/API Specifications/i)).toBeTruthy();
        });
    });

    it('renders ChainingTab', async () => {
        render(<ChainingTab />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /Request Chaining Rules/i })).toBeTruthy();
        });
    });

    it('renders DictionariesTab and validates/updates custom dictionaries', async () => {
        render(<DictionariesTab />);
        await waitFor(() => {
            expect(screen.getByText(/Custom Fuzzing Dictionaries/i)).toBeTruthy();
        });

        const textarea = screen.getByRole('textbox');

        // Valid update
        fireEvent.change(textarea, { target: { value: JSON.stringify({ email: ['test@example.com'] }, null, 2) } });
        fireEvent.blur(textarea);
        expect(screen.queryByText(/must be/i)).toBeNull();

        // Empty string resets to empty object
        fireEvent.change(textarea, { target: { value: '' } });
        fireEvent.blur(textarea);
        expect(screen.queryByText(/must be/i)).toBeNull();

        // Invalid JSON error
        fireEvent.change(textarea, { target: { value: '{ not json }' } });
        fireEvent.blur(textarea);
        expect(screen.getByText(/Expected/i)).toBeTruthy();

        // Not an object error
        fireEvent.change(textarea, { target: { value: '[1, 2, 3]' } });
        fireEvent.blur(textarea);
        expect(screen.getByText('Dictionary configuration must be a JSON object')).toBeTruthy();

        // Values not arrays
        fireEvent.change(textarea, { target: { value: '{"user": "alice"}' } });
        fireEvent.blur(textarea);
        expect(screen.getByText('Value for key "user" must be an array of strings/numbers')).toBeTruthy();

        // Array items not strings or numbers
        fireEvent.change(textarea, { target: { value: '{"user": [{}]}' } });
        fireEvent.blur(textarea);
        expect(screen.getByText('Items in array "user" must be strings or numbers')).toBeTruthy();
    });

    it('renders KeysTab', async () => {
        render(<KeysTab />);
        await waitFor(() => {
            expect(screen.getByText(/Encryption & Keys/i)).toBeTruthy();
        });
    });

    it('renders MembersRolesTab', async () => {
        render(<MembersRolesTab />);
        await waitFor(() => {
            expect(screen.getByText(/Access & Permissions/i)).toBeTruthy();
        });
    });

    it('renders PerformanceTab and navigates all subtabs and inputs', async () => {
        render(<PerformanceTab />);
        await waitFor(() => {
            expect(screen.getByText(/Fuzzing Settings/i)).toBeTruthy();
        });

        // 1. Subtab: Concurrency & Rate Limits (default)
        const concurrencyRange = screen.getByLabelText('Request Concurrency');
        fireEvent.change(concurrencyRange, { target: { value: '5' } });
        const concurrencyNumber = screen.getByLabelText('Request Concurrency Worker Count');
        fireEvent.change(concurrencyNumber, { target: { value: '7' } });

        const delayInput = screen.getByLabelText(/Delay Between Requests/i);
        fireEvent.change(delayInput, { target: { value: '150' } });

        const rateLimitCheckbox = screen.getByLabelText(/Enable Rate Limit Detection/i);
        fireEvent.click(rateLimitCheckbox);
        const burstInput = screen.getByLabelText('Burst Size');
        fireEvent.change(burstInput, { target: { value: '100' } });

        const adaptiveCheckbox = screen.getByLabelText(/Enable Adaptive Rate Limiting/i);
        fireEvent.click(adaptiveCheckbox);

        // 2. Subtab: Fuzzing & Intensity
        const fuzzTabBtn = screen.getByRole('tab', { name: /Fuzzing & Intensity/i });
        fireEvent.click(fuzzTabBtn);
        const iterInput = screen.getByLabelText(/Fuzzing Intensity/i);
        fireEvent.change(iterInput, { target: { value: '25' } });
        const paramCheckbox = screen.getByLabelText(/Active Parameter Fuzzing/i);
        fireEvent.click(paramCheckbox);
        const harInput = screen.getByLabelText(/HAR Domain Filter/i);
        fireEvent.change(harInput, { target: { value: 'api.example.com' } });

        // 3. Subtab: Timeout & Duration
        const timeoutTabBtn = screen.getByRole('tab', { name: /Timeout & Duration/i });
        fireEvent.click(timeoutTabBtn);
        const timeoutInput = screen.getByLabelText(/Individual Request Timeout/i);
        fireEvent.change(timeoutInput, { target: { value: '3000' } });
        const maxDurationInput = screen.getByLabelText(/Maximum Scan Duration/i);
        fireEvent.change(maxDurationInput, { target: { value: '15' } });

        // 4. Subtab: WAF Evasion & AI
        const evasionTabBtn = screen.getByRole('tab', { name: /WAF Evasion & AI/i });
        fireEvent.click(evasionTabBtn);
        const proxyTextarea = screen.getByLabelText(/Proxy List/i);
        fireEvent.change(proxyTextarea, { target: { value: 'http://127.0.0.1:8080\nhttp://127.0.0.1:8081' } });
        fireEvent.blur(proxyTextarea);

        const uaCheckbox = screen.getByLabelText(/Randomize User-Agent/i);
        fireEvent.click(uaCheckbox);
        const semanticCheckbox = screen.getByLabelText(/Semantic Format Wrappers/i);
        fireEvent.click(semanticCheckbox);
        const prepassCheckbox = screen.getByLabelText(/Pre-Scan LLM Batching/i);
        fireEvent.click(prepassCheckbox);
        const triageCheckbox = screen.getByLabelText(/Enable Smart Triage/i);
        fireEvent.click(triageCheckbox);

        const aiGatewayInput = screen.getByLabelText('AI Gateway / OpenAI Proxy URL');
        fireEvent.change(aiGatewayInput, { target: { value: 'https://gateway.ai.cloudflare.com/v1/123/swazz/openai' } });
        const cfTokenInput = screen.getByLabelText(/Cloudflare AI Gateway Token/i);
        fireEvent.change(cfTokenInput, { target: { value: 'test-token' } });
        const triageCountInput = screen.getByLabelText(/Max AI Triage Requests/i);
        fireEvent.change(triageCountInput, { target: { value: '50' } });
    });

    it('renders and interacts with RawConfigTab', async () => {
        const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/mock-blob');
        const revokeObjectURLMock = vi.fn();
        vi.stubGlobal('URL', {
            createObjectURL: createObjectURLMock,
            revokeObjectURL: revokeObjectURLMock
        });

        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined)
            }
        });

        render(<RawConfigTab />);
        await waitFor(() => {
            expect(screen.getByText("Raw JSON Configuration")).toBeTruthy();
        });

        // Test Copy
        const copyBtn = screen.getByRole('button', { name: /^Copy$/i });
        fireEvent.click(copyBtn);
        expect(navigator.clipboard.writeText).toHaveBeenCalled();

        // Test invalid JSON error display
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: '{"invalid_json": ' } });
        expect(screen.getByText(/Invalid JSON:/i)).toBeTruthy();

        // Fix JSON and save
        fireEvent.change(textarea, { target: { value: '{"base_url":"http://new.example.com"}' } });
        const saveBtn = screen.getByRole('button', { name: /Save Configuration/i });
        fireEvent.click(saveBtn);

        // Export File button
        const exportFileBtn = screen.getByRole('button', { name: /Export File/i });
        fireEvent.click(exportFileBtn);
        expect(createObjectURLMock).toHaveBeenCalled();

        // Export Ignore Rules button
        const exportIgnoreBtn = screen.getByRole('button', { name: /Export Ignore Rules/i });
        fireEvent.click(exportIgnoreBtn);

        // Import File
        const importBtn = screen.getByRole('button', { name: /Import File/i });
        fireEvent.click(importBtn);

        // Simulate file upload with valid JSON
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) {
            const validFile = new File(['{"base_url": "https://imported.example.com"}'], 'config.json', { type: 'application/json' });
            fireEvent.change(fileInput, { target: { files: [validFile] } });
        }
    });

    it('renders and saves GeneralTab', async () => {
        render(<GeneralTab />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Test Proj')).toBeTruthy();
        });

        const nameInput = screen.getByDisplayValue('Test Proj');
        fireEvent.change(nameInput, { target: { value: 'Updated Project Name' } });

        const saveBtn = screen.getByRole('button', { name: /Save General Info/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/test-project-1'),
                expect.objectContaining({ method: 'PATCH' })
            );
        });
    });

    it('renders and updates ScheduleTab with all frequencies and validates custom cron', async () => {
        render(<ScheduleTab />);
        await waitFor(() => {
            expect(screen.getByText(/Auto-Scan Scheduler/i)).toBeTruthy();
        });

        const select = screen.getByRole('combobox');
        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });

        // Daily
        fireEvent.change(select, { target: { value: 'daily' } });
        fireEvent.click(saveBtn);

        // Weekly
        fireEvent.change(select, { target: { value: 'weekly' } });
        fireEvent.click(saveBtn);

        // Custom - invalid fields length
        fireEvent.change(select, { target: { value: 'custom' } });
        const cronInput = screen.getByDisplayValue('0 0 * * *');
        fireEvent.change(cronInput, { target: { value: '0 0 *' } });
        fireEvent.click(saveBtn);

        // Custom - frequency too high
        fireEvent.change(cronInput, { target: { value: '*/5 * * * *' } });
        fireEvent.click(saveBtn);

        // Custom - valid
        fireEvent.change(cronInput, { target: { value: '15 4 * * *' } });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/test-project-1/schedule'),
                expect.objectContaining({ method: 'POST' })
            );
        });
    });

    it('renders RunnersTab and switches runner modes', async () => {
        const mockRunners = [
            {
                connectionId: 'conn-1',
                name: 'runner-node-1',
                publicKey: 'pubkey-1',
                status: 'connected' as const,
                isMine: true,
                isShared: false,
                version: '1.2.3'
            }
        ];

        render(
            <RunnersTab
                runners={mockRunners}
                isLoadingRunners={false}
                runnerError=""
            />
        );

        await waitFor(() => {
            expect(screen.getByText('runner-node-1')).toBeTruthy();
            expect(screen.getByText('connected')).toBeTruthy();
        });

        const sharedBtn = screen.getByRole('button', { name: /Shared Runner/i });
        fireEvent.click(sharedBtn);

        expect(screen.getByText(/Shared Mode:/i)).toBeTruthy();

        // Switch back to private
        const privateBtn = screen.getByRole('button', { name: /Private Runner/i });
        fireEvent.click(privateBtn);

        expect(screen.getByText(/Private Mode:/i)).toBeTruthy();
    });

    it('renders WordlistsTab', async () => {
        render(<WordlistsTab />);
        await waitFor(() => {
            expect(screen.getByText("Wordlist Files Configuration")).toBeTruthy();
        });
    });

    it('renders Section component', () => {
        render(
            <Section title="My Section">
                <div>Content</div>
            </Section>
        );
        expect(screen.getByText("My Section")).toBeTruthy();
    });

    it('renders KVEditor component', () => {
        const handleToggle = vi.fn();
        const handleChange = vi.fn();

        render(
            <KVEditor
                entries={{ "Content-Type": "application/json" }}
                onChange={handleChange}
                authKeys={["Content-Type"]}
                onToggleAuthKey={handleToggle}
            />
        );
        expect(screen.getByPlaceholderText("Key")).toBeTruthy();
    });

    it('renders ChainingRulesEditor', () => {
        const handleChange = vi.fn();
        const rules = [{
            source_endpoint: 'POST /api/login',
            extract_type: 'json' as const,
            extract_path: 'data.token',
            variable_name: 'TOKEN'
        }];
        render(<ChainingRulesEditor rules={rules} onChange={handleChange} />);
        expect(screen.getByPlaceholderText("e.g. POST /api/login")).toBeTruthy();
    });
});
