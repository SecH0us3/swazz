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

    it('renders DictionariesTab', async () => {
        render(<DictionariesTab />);
        await waitFor(() => {
            expect(screen.getByText(/Custom Fuzzing Dictionaries/i)).toBeTruthy();
        });
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

    it('renders PerformanceTab', async () => {
        render(<PerformanceTab />);
        await waitFor(() => {
            expect(screen.getByText(/Fuzzing Settings/i)).toBeTruthy();
        });
    });

    it('renders and interacts with RawConfigTab', async () => {
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

    it('renders and updates ScheduleTab', async () => {
        render(<ScheduleTab />);
        await waitFor(() => {
            expect(screen.getByText(/Auto-Scan Scheduler/i)).toBeTruthy();
        });

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'daily' } });

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
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
