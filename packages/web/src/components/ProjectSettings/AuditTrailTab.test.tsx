// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuditTrailTab } from './AuditTrailTab.js';
import { useAppStore } from '../../store/appStore.js';
import React from 'react';

vi.mock('../../store/appStore.js', () => ({
    useAppStore: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;
global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

const mockActiveProject = { id: 'proj-1', name: 'Test Project' };

describe('AuditTrailTab Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.setItem('swazz_token', 'fake-token');

        (useAppStore as any).mockImplementation((selector: any) => selector({ activeProject: mockActiveProject }));

        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                logs: [],
                pagination: { page: 1, limit: 20, total: 0, pages: 1 }
            })
        });
    });

    afterEach(() => {
        localStorage.removeItem('swazz_token');
    });

    it('renders empty state initially', async () => {
        render(<AuditTrailTab />);
        
        expect(screen.getByText('Audit Trail')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search by user, action, or IP…')).toBeInTheDocument();
        
        await waitFor(() => {
            expect(screen.getByText('No audit events yet')).toBeInTheDocument();
        });
        
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/audit-logs?page=1&limit=20',
            expect.objectContaining({ headers: { 'Authorization': 'Bearer fake-token' } })
        );
    });

    it('renders list of audit logs', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                logs: [
                    {
                        id: 'log-1',
                        user_id: 'u-1',
                        actor_username: 'alice',
                        actor_role: 'admin',
                        action: 'project.update',
                        action_label: 'Updated Project Settings',
                        source: 'web',
                        ip_address: '192.168.1.1',
                        timestamp: '2026-08-24T12:00:00Z'
                    },
                    {
                        id: 'log-2',
                        user_id: null,
                        actor_username: null,
                        actor_role: null,
                        action: 'scan.start',
                        action_label: 'Started Scan',
                        source: 'api_key',
                        ip_address: null,
                        timestamp: '2026-08-24T12:05:00Z',
                        details: JSON.stringify({ before: { foo: 'bar' }, after: { foo: 'baz' } })
                    }
                ],
                pagination: { page: 1, limit: 20, total: 2, pages: 1 }
            })
        });

        render(<AuditTrailTab />);

        await waitFor(() => {
            expect(screen.getByText('alice')).toBeInTheDocument();
            expect(screen.getByText('[deleted user]')).toBeInTheDocument();
        });

        expect(screen.getByText('Updated Project Settings')).toBeInTheDocument();
        expect(screen.getByText('Started Scan')).toBeInTheDocument();
        expect(screen.getByText('192.168.1.1')).toBeInTheDocument();

        // Check if details row is accessible by clicking the row
        // the row is clickable because it has details
        const scanRow = screen.getByText('Started Scan').closest('tr');
        if (scanRow) {
            fireEvent.click(scanRow);
        }
        
        await waitFor(() => {
            expect(screen.getByText('bar')).toBeInTheDocument();
            expect(screen.getByText('baz')).toBeInTheDocument();
        });
    });

    it('exports CSV on click', async () => {
        // Mock for initial load
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                logs: [{ id: 'log-1', action: 'test' }],
                pagination: { page: 1, limit: 20, total: 1, pages: 1 }
            })
        });

        // Mock for export fetch
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                logs: [
                    {
                        id: 'log-1',
                        user_id: 'u-1',
                        actor_username: 'alice',
                        actor_role: 'admin',
                        action: 'project.update',
                        action_label: 'Updated Project Settings',
                        source: 'web',
                        ip_address: '192.168.1.1',
                        timestamp: '2026-08-24T12:00:00Z'
                    }
                ],
                pagination: { page: 1, limit: 20, total: 1, pages: 1 }
            })
        });

        // Mock document.createElement
        const mockLink = { href: '', download: '', click: vi.fn() };
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
            if (tagName === 'a') return mockLink as any;
            return originalCreateElement(tagName);
        });

        render(<AuditTrailTab />);

        await waitFor(() => {
            expect(screen.getByText('Export CSV')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Export CSV'));

        await waitFor(() => {
            expect(mockLink.click).toHaveBeenCalled();
            expect(mockLink.download).toMatch(/audit-trail-proj-1-.*\.csv/);
        });
        
        vi.restoreAllMocks();
    });
});
