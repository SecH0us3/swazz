import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { EndpointTree } from './EndpointTree.js';
import type { EndpointConfig } from '../../types.js';

describe('EndpointTree Component', () => {
    const mockEndpoints: EndpointConfig[] = [
        { path: '/api/v1/users', method: 'GET', schema: { properties: { id: { type: 'string' } } } },
        { path: '/api/v1/admins', method: 'POST', schema: {} },
        { path: '/api/v2/health', method: 'GET', schema: {} }
    ];

    it('renders tree hierarchy correctly', () => {
        const onUpdateDisabled = vi.fn();
        render(
            <EndpointTree
                endpoints={mockEndpoints}
                disabledEndpoints={[]}
                onUpdateDisabled={onUpdateDisabled}
            />
        );

        // Verify folder segments are rendered (displayName: node.name + '/')
        expect(screen.getByText('/api/')).toBeTruthy();
        expect(screen.getByText('v1/')).toBeTruthy();
        expect(screen.getByText('v2/')).toBeTruthy();

        // Verify leaf/endpoint names are rendered
        expect(screen.getByText('users')).toBeTruthy();
        expect(screen.getByText('admins')).toBeTruthy();
        expect(screen.getByText('health')).toBeTruthy();
    });

    it('handles direct and case-insensitive/wildcard disabled states correctly', () => {
        const onUpdateDisabled = vi.fn();
        
        // Scenario 1: Exact case-insensitive matching
        const { unmount } = render(
            <EndpointTree
                endpoints={mockEndpoints}
                disabledEndpoints={['GET /API/v1/USERS']}
                onUpdateDisabled={onUpdateDisabled}
            />
        );

        let usersCheckbox = screen.getByLabelText('Enable endpoint GET /api/v1/users') as HTMLInputElement;
        expect(usersCheckbox.checked).toBe(false);

        let adminsCheckbox = screen.getByLabelText('Enable endpoint POST /api/v1/admins') as HTMLInputElement;
        expect(adminsCheckbox.checked).toBe(true);

        unmount();

        // Scenario 2: Wildcard matching
        render(
            <EndpointTree
                endpoints={mockEndpoints}
                disabledEndpoints={['/api/v1/**']}
                onUpdateDisabled={onUpdateDisabled}
            />
        );

        usersCheckbox = screen.getByLabelText('Enable endpoint GET /api/v1/users') as HTMLInputElement;
        expect(usersCheckbox.checked).toBe(false);

        adminsCheckbox = screen.getByLabelText('Enable endpoint POST /api/v1/admins') as HTMLInputElement;
        expect(adminsCheckbox.checked).toBe(false);

        const healthCheckbox = screen.getByLabelText('Enable endpoint GET /api/v2/health') as HTMLInputElement;
        expect(healthCheckbox.checked).toBe(true);
    });

    it('handles interactive toggling correctly', () => {
        const onUpdateDisabled = vi.fn();
        render(
            <EndpointTree
                endpoints={mockEndpoints}
                disabledEndpoints={[]}
                onUpdateDisabled={onUpdateDisabled}
            />
        );

        // Disable a single endpoint
        const usersCheckbox = screen.getByLabelText('Enable endpoint GET /api/v1/users');
        fireEvent.click(usersCheckbox);
        expect(onUpdateDisabled).toHaveBeenCalledWith(['GET /api/v1/users']);
    });

    it('handles folder toggling and wildcard removals correctly', () => {
        const onUpdateDisabled = vi.fn();
        
        render(
            <EndpointTree
                endpoints={mockEndpoints}
                disabledEndpoints={['/api/**']}
                onUpdateDisabled={onUpdateDisabled}
            />
        );

        const usersCheckbox = screen.getByLabelText('Enable endpoint GET /api/v1/users');
        fireEvent.click(usersCheckbox);
        expect(onUpdateDisabled).toHaveBeenCalledWith([]);
    });
});
