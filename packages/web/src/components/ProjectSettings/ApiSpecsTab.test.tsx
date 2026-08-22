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
    
    it('toggles MCP server', async () => {
        render(<ApiSpecsTab />);
        const toggleBtn = screen.getByLabelText(/Enable MCP Server Fuzzing/i);
        fireEvent.click(toggleBtn);
        
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            mcp_server: {
                type: 'stdio',
                command: 'node',
                args: ['demo/mcp-stdio.js']
            }
        });
    });
});
