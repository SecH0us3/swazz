// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { ApiSpecsTab } from './ApiSpecsTab.js';
import * as swaggerService from '../../services/swaggerService.js';

const mockUpdateConfig = vi.fn();
const mockShowToast = vi.fn();
let mockConfig: any = {};

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: () => ({
        config: mockConfig,
        updateConfig: mockUpdateConfig
    })
}));

vi.mock('../../hooks/useToast.js', () => ({
    useToast: () => ({
        showToast: mockShowToast
    })
}));

vi.mock('../../services/swaggerService.js', () => ({
    loadSwaggerUrl: vi.fn(),
    parseRawSpec: vi.fn(),
    detectMcpServer: vi.fn(),
    ParsingError: class extends Error {
        issues: string[];
        constructor(message: string, issues: string[]) {
            super(message);
            this.issues = issues;
        }
    }
}));

describe('ApiSpecsTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('confirm', vi.fn(() => true));
        mockConfig = {
            _swagger_urls: ['http://example.com/swagger.json'],
            mcp_server: null
        };
    });

    it('renders urls', () => {
        render(<ApiSpecsTab />);
        expect(screen.getByText('http://example.com/swagger.json')).toBeTruthy();
    });

    it('adds a valid url', async () => {
        render(<ApiSpecsTab />);
        const input = screen.getByPlaceholderText('https://bbad.secmy.app/swagger.json');
        const addBtn = screen.getByText('Add URL');
        
        vi.mocked(swaggerService.detectMcpServer).mockResolvedValueOnce(null as any);
        vi.mocked(swaggerService.loadSwaggerUrl).mockResolvedValueOnce({
            basePath: '',
            endpointCount: 1,
            endpoints: []
        });

        fireEvent.change(input, { target: { value: 'http://test.com/openapi.yaml' } });
        fireEvent.click(addBtn);

        await waitFor(() => {
            expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({
                _swagger_urls: ['http://example.com/swagger.json', 'http://test.com/openapi.yaml']
            }));
        });
    });

    it('removes a url', async () => {
        render(<ApiSpecsTab />);
        const removeBtns = screen.getAllByRole('button', { name: /Remove/i });
        fireEvent.click(removeBtns[0]);
        
        expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({
            _swagger_urls: []
        }));
    });

    it('refreshes an existing url', async () => {
        mockConfig = {
            _swagger_urls: ['http://example.com/swagger.json'],
            endpoints: []
        };
        vi.mocked(swaggerService.loadSwaggerUrl).mockResolvedValueOnce({
            basePath: 'http://example.com',
            endpointCount: 5,
            endpoints: [{ method: 'GET', path: '/api/v1/users' } as any]
        });

        render(<ApiSpecsTab />);
        const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
        fireEvent.click(refreshBtn);

        await waitFor(() => {
            expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({
                base_url: 'http://example.com',
                endpoints: [{ method: 'GET', path: '/api/v1/users' }]
            }));
        });
    });

    it('handles parsing errors gracefully when adding a url', async () => {
        render(<ApiSpecsTab />);
        const input = screen.getByPlaceholderText('https://bbad.secmy.app/swagger.json');
        const addBtn = screen.getByText('Add URL');
        
        vi.mocked(swaggerService.detectMcpServer).mockResolvedValueOnce(null as any);
        vi.mocked(swaggerService.loadSwaggerUrl).mockRejectedValueOnce(new Error('Network failure'));

        fireEvent.change(input, { target: { value: 'http://bad-spec.com/swagger.json' } });
        fireEvent.click(addBtn);

        await waitFor(() => {
            expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({
                _swagger_urls: ['http://example.com/swagger.json', 'http://bad-spec.com/swagger.json']
            }));
        });
    });
    
    it('toggles and updates MCP server settings', async () => {
        mockConfig = {
            _swagger_urls: [],
            mcp_server: {
                type: 'stdio',
                command: 'node',
                args: ['demo/mcp.js']
            }
        };

        render(<ApiSpecsTab />);
        expect(screen.getByText('Tool Safety & Confirmation Contracts')).toBeInTheDocument();
        expect(screen.getByText(/requires_confirmation: true/i)).toBeInTheDocument();

        const toggleBtn = screen.getByLabelText(/Enable MCP Server Fuzzing/i);
        fireEvent.click(toggleBtn);
        
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            mcp_server: undefined
        });
    });

    it('switches transport to HTTP and updates URL', async () => {
        mockConfig = {
            _swagger_urls: [],
            mcp_server: {
                type: 'http',
                url: 'http://localhost:8000/mcp'
            }
        };

        render(<ApiSpecsTab />);
        const select = screen.getByRole('combobox');
        expect(select).toHaveValue('http');
        expect(screen.getByPlaceholderText('e.g. http://localhost:8000/mcp')).toBeInTheDocument();
        expect(screen.getByText(/Supports per-call identity header switching for BOLA \/ IDOR fuzzing/i)).toBeInTheDocument();

        const urlInput = screen.getByPlaceholderText('e.g. http://localhost:8000/mcp');
        fireEvent.change(urlInput, { target: { value: 'http://localhost:9000/mcp' } });

        expect(mockUpdateConfig).toHaveBeenCalledWith({
            mcp_server: {
                type: 'http',
                url: 'http://localhost:9000/mcp'
            }
        });
    });

    it('toggles enable_mcp_method_fuzzing setting in project config', async () => {
        mockConfig = {
            _swagger_urls: [],
            mcp_server: {
                type: 'stdio',
                command: 'node',
                args: ['demo/mcp.js']
            },
            settings: {
                enable_mcp_method_fuzzing: true
            }
        };

        render(<ApiSpecsTab />);
        const methodToggle = screen.getByLabelText(/Fuzz Method & Tool Names/i);
        expect(methodToggle).toBeChecked();

        fireEvent.click(methodToggle);

        expect(mockUpdateConfig).toHaveBeenCalledWith({
            settings: {
                enable_mcp_method_fuzzing: false
            }
        });
    });

    it('detects MCP server on URL input and enables MCP fuzzing automatically', async () => {
        render(<ApiSpecsTab />);
        const input = screen.getByPlaceholderText('https://bbad.secmy.app/swagger.json');
        const addBtn = screen.getByText('Add URL');
        
        vi.mocked(swaggerService.detectMcpServer).mockResolvedValueOnce('sse' as any);

        fireEvent.change(input, { target: { value: 'http://localhost:8080/mcp/sse' } });
        fireEvent.click(addBtn);

        await waitFor(() => {
            expect(mockUpdateConfig).toHaveBeenCalledWith({
                mcp_server: {
                    type: 'sse',
                    url: 'http://localhost:8080/mcp/sse'
                }
            });
        });
    });

    it('shows error toast when attempting to add duplicate spec URL', async () => {
        mockConfig = {
            _swagger_urls: ['http://example.com/swagger.json'],
        };
        render(<ApiSpecsTab />);
        const input = screen.getByPlaceholderText('https://bbad.secmy.app/swagger.json');
        const addBtn = screen.getByText('Add URL');

        vi.mocked(swaggerService.detectMcpServer).mockResolvedValueOnce(null as any);

        fireEvent.change(input, { target: { value: 'http://example.com/swagger.json' } });
        fireEvent.click(addBtn);

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('This URL is already in the list', 'error');
        });
    });

    it('refreshes all spec URLs when "Refresh All" is clicked', async () => {
        mockConfig = {
            _swagger_urls: ['http://example.com/1.json', 'http://example.com/2.json', 'http://example.com/3.json'],
            endpoints: [],
        };
        vi.mocked(swaggerService.loadSwaggerUrl).mockResolvedValue({
            basePath: 'http://example.com',
            endpointCount: 2,
            endpoints: [{ method: 'GET', path: '/api/v1/test' } as any],
        });

        render(<ApiSpecsTab />);
        const refreshAllBtn = screen.getByRole('button', { name: /Refresh All/i });
        fireEvent.click(refreshAllBtn);

        await waitFor(() => {
            expect(mockUpdateConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    endpoints: [{ method: 'GET', path: '/api/v1/test' }],
                })
            );
            expect(mockShowToast).toHaveBeenCalledWith(
                expect.stringContaining('Total loaded: 6 endpoints'),
                'success'
            );
        });
    });

    it('handles uploaded local spec file via parseRawSpec', async () => {
        vi.mocked(swaggerService.parseRawSpec).mockResolvedValueOnce({
            basePath: 'http://local.test',
            endpointCount: 1,
            endpoints: [{ method: 'POST', path: '/api/upload' } as any],
        });

        render(<ApiSpecsTab />);
        const file = new File(['{"openapi": "3.0.0"}'], 'spec.json', { type: 'application/json' });
        const fileInput = document.getElementById('specs-upload-input') as HTMLInputElement;

        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
            expect(swaggerService.parseRawSpec).toHaveBeenCalled();
            expect(mockUpdateConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    base_url: 'http://local.test',
                    endpoints: expect.arrayContaining([{ method: 'POST', path: '/api/upload' }]),
                })
            );
        });
    });
});
