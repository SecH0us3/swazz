// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhooksTab } from './WebhooksTab.js';
import { useAppStore } from '../../store/appStore.js';
import { useToast } from '../../hooks/useToast.js';
import { useFeatureGate } from '../../hooks/useFeatureGate.js';

// Mock hooks
vi.mock('../../store/appStore.js');
vi.mock('../../hooks/useToast.js');
vi.mock('../../hooks/useFeatureGate.js');

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('WebhooksTab Component', () => {
    const mockShowToast = vi.fn();
    const mockActiveProject = { id: 'proj-1', name: 'Test Project' };

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Setup local storage correctly
        localStorage.setItem('swazz_token', 'fake-token');
        
        // Setup clipboard mock
        vi.stubGlobal('navigator', {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined)
            }
        });

        (useAppStore as any).mockImplementation((selector: any) => selector({ activeProject: mockActiveProject }));
        (useToast as any).mockReturnValue({ showToast: mockShowToast });
        (useFeatureGate as any).mockReturnValue({ unlocked: true });

        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ webhooks: [] })
        });
    });

    it('renders empty state initially', async () => {
        render(<WebhooksTab />);
        
        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-1/webhooks', expect.any(Object));
        
        await waitFor(() => {
            expect(screen.getByText('No webhooks configured for this project yet.')).toBeInTheDocument();
        });
    });

    it('renders list of webhooks', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                webhooks: [
                    { id: 'wh-1', url: 'https://example.com/webhook', event_types: ['scan.started'], secret: 'fake-secret' }
                ]
            })
        });

        render(<WebhooksTab />);

        await waitFor(() => {
            expect(screen.getByText('https://example.com/webhook')).toBeInTheDocument();
            expect(screen.getByText('scan.started')).toBeInTheDocument();
        });
    });

    it('opens add form and handles validation errors', async () => {
        render(<WebhooksTab />);
        await waitFor(() => expect(screen.queryByText(/No webhooks configured/)).toBeInTheDocument());

        fireEvent.click(screen.getByText('Add Webhook'));

        // Invalid URL
        const urlInput = screen.getByPlaceholderText("https://my-api.com/webhooks/swazz");
        fireEvent.change(urlInput, { target: { value: 'invalid-url' } });
        fireEvent.click(screen.getByText('Save Configuration'));

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('Invalid target URL format', 'error');
        });

        // Invalid JSON headers
        fireEvent.change(urlInput, { target: { value: 'https://valid.com' } });
        const headersInput = screen.getByPlaceholderText("{ \"Authorization\": \"Bearer token\" }");
        fireEvent.change(headersInput, { target: { value: 'not-json' } });
        fireEvent.click(screen.getByText('Save Configuration'));

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('Headers must be a valid JSON object', 'error');
        });
    });

    it('creates a new webhook successfully and copies secret', async () => {
        render(<WebhooksTab />);
        await waitFor(() => expect(screen.queryByText(/No webhooks configured/)).toBeInTheDocument());

        fireEvent.click(screen.getByText('Add Webhook'));
        
        const urlInput = screen.getByPlaceholderText("https://my-api.com/webhooks/swazz");
        fireEvent.change(urlInput, { target: { value: 'https://valid.com/hook' } });
        
        const headersInput = screen.getByPlaceholderText("{ \"Authorization\": \"Bearer token\" }");
        fireEvent.change(headersInput, { target: { value: '{}' } });

        // Select an event
        fireEvent.click(screen.getByText('Scan Started'));
        
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: 'wh-new', secret: 'new-secret', webhook: { id: 'wh-new', url: 'https://valid.com/hook', event_types: ['scan.started'] }
            })
        });
        
        // fetch called to refresh after save
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                webhooks: [
                    { id: 'wh-new', url: 'https://valid.com/hook', event_types: ['scan.started'], secret: '••••••••' }
                ]
            })
        });

        fireEvent.click(screen.getByText('Save Configuration'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-1/webhooks', expect.objectContaining({ method: 'POST' }));
            expect(mockShowToast).toHaveBeenCalledWith('Webhook created successfully', 'success');
        });

        // Need to click Reveal first because secrets are hidden by default
        fireEvent.click(screen.getByText('Reveal'));

        await waitFor(() => {
            expect(screen.getByText('new-secret')).toBeInTheDocument();
        });

        // Copy to clipboard
        fireEvent.click(screen.getByText('Copy'));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('new-secret');
        expect(mockShowToast).toHaveBeenCalledWith('Secret copied to clipboard', 'success');
        
        // Hide secret
        fireEvent.click(screen.getByText('Hide'));
        expect(screen.queryByText('new-secret')).not.toBeInTheDocument();
        
        // Reveal secret
        fireEvent.click(screen.getByText('Reveal'));
        expect(screen.getByText('new-secret')).toBeInTheDocument();
    });

    it('edits an existing webhook', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                webhooks: [
                    { id: 'wh-1', url: 'https://example.com/webhook', event_types: ['scan.started'], headers: '{"X-Test":"1"}', secret: 'fake-secret' }
                ]
            })
        });

        render(<WebhooksTab />);
        await waitFor(() => expect(screen.getByText('https://example.com/webhook')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Edit'));

        // Form opens
        const urlInput = screen.getByDisplayValue('https://example.com/webhook');
        expect(urlInput).toBeInTheDocument();
        
        fireEvent.change(urlInput, { target: { value: 'https://example.com/updated' } });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({})
        });
        
        // refresh
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ webhooks: [] })
        });

        fireEvent.click(screen.getByText('Save Configuration'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-1/webhooks/wh-1', expect.objectContaining({ method: 'PUT' }));
            expect(mockShowToast).toHaveBeenCalledWith('Webhook updated successfully', 'success');
        });
    });

    it('deletes a webhook', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                webhooks: [
                    { id: 'wh-1', url: 'https://example.com/webhook', event_types: ['scan.started'], secret: 'fake-secret' }
                ]
            })
        });

        render(<WebhooksTab />);
        await waitFor(() => expect(screen.getByText('https://example.com/webhook')).toBeInTheDocument());

        // mock window.confirm
        const originalConfirm = window.confirm;
        window.confirm = vi.fn().mockReturnValue(true);

        mockFetch.mockResolvedValueOnce({ ok: true });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ webhooks: [] }) });

        fireEvent.click(screen.getByText('Delete'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-1/webhooks/wh-1', expect.objectContaining({ method: 'DELETE' }));
            expect(mockShowToast).toHaveBeenCalledWith('Webhook deleted successfully', 'success');
        });

        window.confirm = originalConfirm;
    });

    it('tests a webhook', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                webhooks: [
                    { id: 'wh-1', url: 'https://example.com/webhook', event_types: ['scan.started'], secret: 'fake-secret' }
                ]
            })
        });

        render(<WebhooksTab />);
        await waitFor(() => expect(screen.getByText('https://example.com/webhook')).toBeInTheDocument());

        mockFetch.mockImplementation(async (url) => {
            if (url.includes('/test')) return { ok: true, json: async () => ({ statusCode: 200 }) };
            return { ok: true, json: async () => ({ webhooks: [] }) };
        });

        fireEvent.click(screen.getByText('Test Connection'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-1/webhooks/wh-1/test', expect.objectContaining({ method: 'POST' }));
            expect(mockShowToast).toHaveBeenCalledWith('Test payload sent successfully. Status code: 200', 'success');
        });
    });

    it('blocks feature if gate is locked', async () => {
        (useFeatureGate as any).mockReturnValue({ unlocked: false });
        render(<WebhooksTab />);
        
        await waitFor(() => expect(screen.queryByText(/No webhooks configured/)).toBeInTheDocument());

        fireEvent.click(screen.getByText('Add Webhook'));
        fireEvent.submit(screen.getByText('Save Configuration').closest('form') as HTMLFormElement);

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('Webhooks require the Scheduled Runs feature (paid plan)', 'error');
        });
    });
});
