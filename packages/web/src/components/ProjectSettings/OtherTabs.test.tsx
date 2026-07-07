/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
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
import { Section, KVEditor } from '../Sidebar/Shared.js';
import { ChainingRulesEditor } from '../Sidebar/ChainingRulesEditor.js';

describe('Other ProjectSettings components', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn((url) => {
            return Promise.resolve(new Response(JSON.stringify({
                permissions: [],
                roles: [],
                members: [],
                projects: []
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        });

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
            projects: [{ id: 'test-project-1', name: 'Test Proj', description: 'desc' }]
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

    it('renders RawConfigTab', async () => {
        render(<RawConfigTab />);
        await waitFor(() => {
            expect(screen.getByText("Raw JSON Configuration")).toBeTruthy();
        });
    });

    it('renders ScheduleTab', async () => {
        render(<ScheduleTab />);
        await waitFor(() => {
            expect(screen.getByText(/Auto-Scan Scheduler/i)).toBeTruthy();
        });
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
