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
        const toggleBtn = screen.getByLabelText(/Enable MCP Server Fuzzing/i);
        fireEvent.click(toggleBtn);
        
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            mcp_server: undefined
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
});
