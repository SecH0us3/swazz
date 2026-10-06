// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { RunnersTab } from './RunnersTab.js';
import { useAppStore } from '../../store/appStore.js';

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast.js', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

describe('RunnersTab Component', () => {
    let mockFetch: any;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        localStorage.setItem('swazz_token', 'mock-token-xyz');

        useAppStore.setState({
            userProfile: {
                username: 'alice_admin',
                apiKey: 'swazz_test_api_key_123',
                publicKey: 'a'.repeat(64),
            } as any,
            csrfToken: 'csrf-token-abc',
        });

        mockFetch = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/api/version')) {
                return {
                    ok: true,
                    json: async () => ({ version: 'v1.4.0' }),
                };
            }
            if (url.includes('/api/auth/public-key')) {
                return {
                    ok: true,
                    json: async () => ({ public_key: 'b'.repeat(64) }),
                };
            }
            if (url.includes('/restart')) {
                return {
                    ok: true,
                    json: async () => ({ success: true }),
                };
            }
            return { ok: true, json: async () => ({}) };
        });
        global.fetch = mockFetch;

        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders loading state when isLoadingRunners is true', () => {
        render(<RunnersTab runners={[]} isLoadingRunners={true} runnerError="" />);
        expect(screen.getByText('Loading active runner registry...')).toBeInTheDocument();
    });

    it('renders error alert when runnerError is provided', () => {
        render(<RunnersTab runners={[]} isLoadingRunners={false} runnerError="Network timed out" />);
        expect(screen.getByText('Error: Network timed out')).toBeInTheDocument();
    });

    it('renders empty state when runners list is empty', () => {
        render(<RunnersTab runners={[]} isLoadingRunners={false} runnerError="" />);
        expect(screen.getByText('No runners connected')).toBeInTheDocument();
    });

    it('renders runners table with runner details and handles restarting owned runner', async () => {
        const mockRunners = [
            {
                connectionId: 'conn-1',
                name: 'local-node-1',
                publicKey: 'a'.repeat(64),
                status: 'connected' as const,
                isMine: true,
                isShared: false,
                version: 'v1.2.0',
            },
            {
                connectionId: 'conn-2',
                name: 'community-node-2',
                publicKey: null,
                status: 'authenticating' as const,
                isMine: false,
                isShared: true,
            },
        ];

        render(<RunnersTab runners={mockRunners} isLoadingRunners={false} runnerError="" />);

        expect(screen.getByText('local-node-1')).toBeInTheDocument();
        expect(screen.getByText('v1.2.0')).toBeInTheDocument();
        expect(screen.getByText('community-node-2')).toBeInTheDocument();
        expect(screen.getByText('Anonymous')).toBeInTheDocument();

        // Restart button only present for mine & not shared
        const restartBtn = screen.getByRole('button', { name: 'Restart' });
        expect(restartBtn).toBeInTheDocument();

        fireEvent.click(restartBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/runners/conn-1/restart'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        Authorization: 'Bearer mock-token-xyz',
                        'X-CSRF-Token': 'csrf-token-abc',
                    }),
                })
            );
            expect(mockShowToast).toHaveBeenCalledWith('Restart command sent successfully', 'success');
        });
    });

    it('validates public key format before submission', async () => {
        render(<RunnersTab runners={[]} isLoadingRunners={false} runnerError="" />);

        const input = screen.getByPlaceholderText(/Enter hex-encoded public key/i);
        fireEvent.change(input, { target: { value: 'invalid-hex-key' } });

        const saveBtn = screen.getByRole('button', { name: 'Save' });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(screen.getByText(/Invalid public key format\. Must be a 64-character hex-encoded string/i)).toBeInTheDocument();
        });
    });

    it('successfully saves valid public key and updates store', async () => {
        render(<RunnersTab runners={[]} isLoadingRunners={false} runnerError="" />);

        const newValidKey = 'c'.repeat(64);
        const input = screen.getByPlaceholderText(/Enter hex-encoded public key/i);
        fireEvent.change(input, { target: { value: newValidKey } });

        const saveBtn = screen.getByRole('button', { name: 'Save' });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/auth/public-key'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ public_key: newValidKey }),
                })
            );
            expect(screen.getByText(/Public key saved successfully!/i)).toBeInTheDocument();
            expect(useAppStore.getState().userProfile?.publicKey).toBe('b'.repeat(64));
        });
    });

    it('switches between Private Runner and Shared Runner setup guides and copies commands', async () => {
        render(<RunnersTab runners={[]} isLoadingRunners={false} runnerError="" />);

        expect(screen.getByText('Private Mode:')).toBeInTheDocument();

        // Copy command in private mode
        const copyBtns = screen.getAllByRole('button', { name: 'Copy Command' });
        fireEvent.click(copyBtns[0]);
        expect(navigator.clipboard.writeText).toHaveBeenCalled();

        // Switch to Shared Runner tab
        const sharedTabBtn = screen.getByRole('button', { name: /Shared Runner/i });
        fireEvent.click(sharedTabBtn);

        expect(screen.getByText('Shared Mode:')).toBeInTheDocument();
        expect(screen.getByText(/Critical Security Warning/i)).toBeInTheDocument();

        // Copy shared run command
        const sharedCopyBtn = screen.getByRole('button', { name: 'Copy Command' });
        fireEvent.click(sharedCopyBtn);
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('rejects oversized uploaded public key file', () => {
        render(<RunnersTab runners={[]} isLoadingRunners={false} runnerError="" />);

        const largeFile = new File(['x'.repeat(1024 * 11)], 'swazz_runner.pub', { type: 'text/plain' });
        const fileInput = document.getElementById('pubkey-file') as HTMLInputElement;

        fireEvent.change(fileInput, { target: { files: [largeFile] } });

        expect(screen.getByText(/File is too large\. Public key files should be under 10KB\./i)).toBeInTheDocument();
    });
});
