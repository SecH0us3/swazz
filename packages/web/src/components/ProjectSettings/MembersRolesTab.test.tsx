// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { MembersRolesTab } from './MembersRolesTab.js';
import { useAppStore } from '../../store/appStore.js';
import { fetchMemberLoginHistory } from '../../services/projectService.js';

vi.mock('../../services/projectService.js', () => ({
    fetchMemberLoginHistory: vi.fn().mockResolvedValue({
        history: [
            {
                id: 'lh-1',
                created_at: '2026-09-01 10:00:00',
                status: 'success',
                auth_method: 'password',
                two_factor_active: 1,
                ip_address: '192.168.1.1',
                city: 'Berlin',
                region: 'BE',
                country: 'DE',
                user_agent: 'Mozilla/5.0',
                cf_ray: 'ray-123',
            },
        ],
        pagination: { page: 1, total: 15, pages: 2 },
    }),
}));

describe('MembersRolesTab Component', () => {
    let mockFetch: any;

    const mockMembers = [
        {
            id: 'u-1',
            username: 'alice_admin',
            email: 'alice@example.com',
            roles: ['Admin'],
            two_factor_enabled: true,
            auth_method: 'password'
        },
        {
            id: 'u-2',
            username: 'bob_dev',
            email: 'bob@example.com',
            roles: ['Developer'],
            two_factor_enabled: false,
            auth_method: 'github'
        }
    ];

    const mockRoles = [
        {
            id: 'r-admin',
            name: 'Admin',
            is_default: false,
            permissions: ['project:read', 'project:write', 'project:delete'],
            included_roles: []
        },
        {
            id: 'r-dev',
            name: 'Developer',
            is_default: true,
            permissions: ['project:read', 'project:write'],
            included_roles: []
        }
    ];

    const mockPermissions = {
        'project:read': 'View project configuration and scans',
        'project:write': 'Edit project settings and launch scans',
        'project:delete': 'Delete project'
    };

    beforeEach(() => {
        mockFetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/members') && (!opts || opts.method === 'GET' || !opts.method)) {
                return {
                    ok: true,
                    json: async () => ({ members: mockMembers })
                };
            }
            if (url.includes('/roles') && (!opts || opts.method === 'GET' || !opts.method)) {
                return {
                    ok: true,
                    json: async () => ({ roles: mockRoles, permissions: mockPermissions })
                };
            }
            if (url.includes('/invitations') && opts?.method === 'POST') {
                return {
                    ok: true,
                    json: async () => ({ success: true, invitation: { id: 'inv-1' } })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        global.fetch = mockFetch;
        localStorage.clear();
        localStorage.setItem('swazz_token', 'fake-token');

        useAppStore.setState({
            activeProject: {
                id: 'proj-123',
                name: 'Main Security Project',
                role: 'owner',
                created_at: '2026-08-24T12:00:00Z',
                updated_at: '2026-08-24T12:00:00Z'
            } as any,
            userProfile: {
                username: 'alice_admin',
                apiKey: 'test-key',
                publicKey: 'pubkey',
                twoFactorEnabled: true
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders members list by default and displays table with members', async () => {
        render(<MembersRolesTab />);

        expect(screen.getByText('Access & Permissions')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByText('alice_admin')).toBeTruthy();
            expect(screen.getByText('bob_dev')).toBeTruthy();
            expect(screen.getByText('Admin')).toBeTruthy();
        });
    });

    it('can switch between Members and Roles sub-views', async () => {
        render(<MembersRolesTab />);

        await waitFor(() => {
            expect(screen.getByText('alice_admin')).toBeTruthy();
        });

        // Switch to Roles tab
        const rolesTabBtn = screen.getByRole('button', { name: 'Roles' });
        fireEvent.click(rolesTabBtn);

        await waitFor(() => {
            expect(screen.getByText('Admin')).toBeTruthy();
            expect(screen.getByText('Developer')).toBeTruthy();
            expect(screen.getByRole('button', { name: /Create Custom Role/i })).toBeTruthy();
        });
    });

    it('opens Invite Member modal, selects role, and submits invitation', async () => {
        render(<MembersRolesTab />);

        await waitFor(() => {
            expect(screen.getByText('alice_admin')).toBeTruthy();
        });

        const inviteBtn = screen.getByRole('button', { name: /Invite User/i });
        fireEvent.click(inviteBtn);

        expect(screen.getByText('Email or Username')).toBeTruthy();

        const input = screen.getByPlaceholderText('user@example.com');
        fireEvent.change(input, { target: { value: 'charlie@example.com' } });

        // Select a role checkbox
        const checkboxes = screen.getAllByRole('checkbox');
        if (checkboxes.length > 0) {
            fireEvent.click(checkboxes[0]);
        }

        const submitBtn = screen.getByRole('button', { name: 'Send Invite' });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/proj-123/invitations'),
                expect.objectContaining({ method: 'POST' })
            );
        });
    });

    it('opens Create Custom Role modal, selects permissions, and creates role', async () => {
        mockFetch.mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/roles') && opts?.method === 'POST') {
                return {
                    ok: true,
                    json: async () => ({
                        role: {
                            id: 'r-auditor',
                            name: 'Auditor',
                            is_default: false,
                            permissions: ['project:read'],
                            included_roles: []
                        }
                    })
                };
            }
            if (url.includes('/roles')) {
                return {
                    ok: true,
                    json: async () => ({ roles: mockRoles, permissions: mockPermissions })
                };
            }
            if (url.includes('/members')) {
                return {
                    ok: true,
                    json: async () => ({ members: mockMembers })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<MembersRolesTab />);

        const rolesTabBtn = screen.getByRole('button', { name: 'Roles' });
        fireEvent.click(rolesTabBtn);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Create Custom Role/i })).toBeTruthy();
        });

        const createRoleBtn = screen.getByRole('button', { name: /Create Custom Role/i });
        fireEvent.click(createRoleBtn);

        expect(screen.getByText('Role Name')).toBeTruthy();

        const nameInput = screen.getByPlaceholderText('e.g. Audit Viewer');
        fireEvent.change(nameInput, { target: { value: 'Auditor' } });

        // Select permission checkbox
        const permCheckboxes = screen.getAllByRole('checkbox');
        if (permCheckboxes.length > 0) {
            fireEvent.click(permCheckboxes[0]);
        }

        const saveRoleBtn = screen.getByRole('button', { name: 'Create Role' });
        fireEvent.click(saveRoleBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/proj-123/roles'),
                expect.objectContaining({ method: 'POST' })
            );
        });
    });

    it('opens direct account creation modal, creates service account and displays credentials', async () => {
        mockFetch.mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/members/create') && opts?.method === 'POST') {
                return {
                    ok: true,
                    json: async () => ({
                        username: 'svc_ci_bot',
                        api_key: 'swazz_live_secret_bot_key_777',
                        password: 'generated-secure-pass-123'
                    })
                };
            }
            if (url.includes('/roles')) {
                return {
                    ok: true,
                    json: async () => ({ roles: mockRoles, permissions: mockPermissions })
                };
            }
            if (url.includes('/members')) {
                return {
                    ok: true,
                    json: async () => ({ members: mockMembers })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<MembersRolesTab />);

        await waitFor(() => {
            expect(screen.getByText('alice_admin')).toBeTruthy();
        });

        const createAccountBtn = screen.getByRole('button', { name: /Create User \/ Service Account/i });
        fireEvent.click(createAccountBtn);

        expect(screen.getByRole('heading', { name: 'Create User / Service Account' })).toBeTruthy();

        const usernameInput = screen.getByPlaceholderText(/e\.g\. scanner-node-1/i);
        fireEvent.change(usernameInput, { target: { value: 'svc_ci_bot' } });

        const roleCheckbox = screen.getByLabelText('Admin');
        fireEvent.click(roleCheckbox);

        const submitBtn = screen.getByRole('button', { name: 'Create Account' });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(screen.getByText('Account Created Successfully')).toBeTruthy();
            expect(screen.getByDisplayValue('svc_ci_bot')).toBeTruthy();
            expect(screen.getByDisplayValue('generated-secure-pass-123')).toBeTruthy();
        });

        const doneBtn = screen.getByRole('button', { name: 'Done' });
        fireEvent.click(doneBtn);
    });

    it('opens Edit Roles modal for a member and saves updated roles', async () => {
        mockFetch.mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/members/u-2') && opts?.method === 'PUT') {
                return {
                    ok: true,
                    json: async () => ({ success: true })
                };
            }
            if (url.includes('/roles')) {
                return {
                    ok: true,
                    json: async () => ({ roles: mockRoles, permissions: mockPermissions })
                };
            }
            if (url.includes('/members')) {
                return {
                    ok: true,
                    json: async () => ({ members: mockMembers })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<MembersRolesTab />);

        await waitFor(() => {
            expect(screen.getByText('bob_dev')).toBeTruthy();
        });

        const editRolesBtn = screen.getByRole('button', { name: 'Edit Roles' });
        fireEvent.click(editRolesBtn);

        await waitFor(() => {
            expect(screen.getByText(/Edit Roles for bob_dev/i)).toBeTruthy();
        });

        const saveRolesBtn = screen.getByRole('button', { name: 'Save Changes' });
        fireEvent.click(saveRolesBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/proj-123/members/u-2'),
                expect.objectContaining({ method: 'PUT' })
            );
        });
    });

    it('opens and interacts with login history modal and exports CSV', async () => {
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
        window.URL.revokeObjectURL = vi.fn();

        render(<MembersRolesTab />);

        await waitFor(() => {
            expect(screen.getByText('alice_admin')).toBeTruthy();
        });

        const historyBtns = screen.getAllByRole('button', { name: 'History' });
        fireEvent.click(historyBtns[0]);

        await waitFor(() => {
            expect(screen.getByText(/Login History: alice_admin/i)).toBeTruthy();
            expect(screen.getByText('192.168.1.1')).toBeTruthy();
            expect(screen.getByText('Berlin, BE, DE')).toBeTruthy();
        });

        // Test pagination next
        const nextBtn = screen.getByRole('button', { name: 'Next' });
        fireEvent.click(nextBtn);
        expect(fetchMemberLoginHistory).toHaveBeenCalledWith('proj-123', 'u-1', 2, 10);

        // Test export CSV
        const exportCsvBtn = screen.getByRole('button', { name: 'Export CSV' });
        fireEvent.click(exportCsvBtn);
        await waitFor(() => {
            expect(fetchMemberLoginHistory).toHaveBeenCalledWith('proj-123', 'u-1', 1, 1000);
        });

        // Close history modal
        const closeBtn = screen.getByRole('button', { name: 'Close' });
        fireEvent.click(closeBtn);
        expect(screen.queryByText(/Login History: alice_admin/i)).toBeNull();
    });

    it('deletes custom role when confirmed', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<MembersRolesTab />);

        // Switch to Roles tab
        const rolesTabBtn = screen.getByRole('button', { name: 'Roles' });
        fireEvent.click(rolesTabBtn);

        await waitFor(() => {
            expect(screen.getByText('Developer')).toBeTruthy();
        });

        // Developer is default, so let's mock non-default custom role
        // In our mockRoles, 'Admin' is is_default: false, so it has Delete button!
        const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/proj-123/roles/r-admin'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });

    it('removes member when confirmed', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<MembersRolesTab />);

        await waitFor(() => {
            expect(screen.getByText('bob_dev')).toBeTruthy();
        });

        const removeBtn = screen.getByRole('button', { name: 'Remove' });
        fireEvent.click(removeBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/proj-123/members/u-2'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });

    it('displays notice banner when user is a guest', () => {
        useAppStore.setState({
            userProfile: {
                username: 'guest_user',
                isGuest: true,
            } as any,
        });

        render(<MembersRolesTab />);

        expect(screen.getByText(/Guest accounts are permitted to view existing access rights/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Invite User' })).toBeDisabled();
    });
});
