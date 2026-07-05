/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProjects, createProject, fetchMemberLoginHistory } from './projectService.js';
import { useAppStore } from '../store/appStore.js';

describe('projectService', () => {
    let originalFetch: typeof globalThis.fetch;
    let storeMock: Record<string, string> = {};

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn();

        storeMock = {};
        const localStorageMock = {
            getItem: vi.fn((key: string) => storeMock[key] || null),
            setItem: vi.fn((key: string, value: string) => {
                storeMock[key] = value.toString();
            }),
            clear: vi.fn(() => {
                storeMock = {};
            }),
            removeItem: vi.fn((key: string) => {
                delete storeMock[key];
            }),
            length: 0,
            key: vi.fn()
        };
        vi.stubGlobal('localStorage', localStorageMock);
        useAppStore.setState({ csrfToken: null });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('fetchProjects', () => {
        it('should fetch projects successfully without token', async () => {
            const mockProjects = [
                { id: '1', name: 'Project 1', description: 'Desc 1' }
            ];
            const mockResponse = new Response(JSON.stringify({ projects: mockProjects }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const projects = await fetchProjects();
            expect(projects).toEqual(mockProjects);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/projects', {
                headers: {}
            });
        });

        it('should fetch projects successfully with token from localStorage', async () => {
            storeMock['swazz_token'] = 'test-token';
            const mockProjects = [
                { id: '2', name: 'Project 2', description: 'Desc 2' }
            ];
            const mockResponse = new Response(JSON.stringify({ projects: mockProjects }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const projects = await fetchProjects();
            expect(projects).toEqual(mockProjects);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/projects', {
                headers: {
                    'Authorization': 'Bearer test-token'
                }
            });
        });

        it('should return empty array if projects field is missing', async () => {
            const mockResponse = new Response(JSON.stringify({}), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const projects = await fetchProjects();
            expect(projects).toEqual([]);
        });

        it('should throw error when fetch returns not ok', async () => {
            const mockResponse = new Response('Not Found', {
                status: 404
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            await expect(fetchProjects()).rejects.toThrow('Failed to fetch projects');
        });
    });

    describe('createProject', () => {
        it('should create project successfully without csrf or auth token', async () => {
            const mockResult = { id: 'new-id', status: 'success' };
            const mockResponse = new Response(JSON.stringify(mockResult), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const result = await createProject('New Project');
            expect(result).toEqual(mockResult);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'New Project' })
            });
        });

        it('should create project successfully with csrf and auth token', async () => {
            storeMock['swazz_token'] = 'test-token';
            useAppStore.setState({ csrfToken: 'csrf-value' });

            const mockResult = { id: 'new-id', status: 'success' };
            const mockResponse = new Response(JSON.stringify(mockResult), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const result = await createProject('New Project');
            expect(result).toEqual(mockResult);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer test-token',
                    'X-CSRF-Token': 'csrf-value'
                },
                body: JSON.stringify({ name: 'New Project' })
            });
        });

        it('should throw error on create failure', async () => {
            const mockResponse = new Response('Conflict', {
                status: 409
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            await expect(createProject('Duplicate')).rejects.toThrow('Failed to create project');
        });
    });

    describe('fetchMemberLoginHistory', () => {
        it('should fetch login history with default pagination', async () => {
            const mockData = {
                history: [],
                pagination: { page: 1, limit: 20, total: 0, pages: 0 }
            };
            const mockResponse = new Response(JSON.stringify(mockData), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const result = await fetchMemberLoginHistory('proj-id', 'user-id');
            expect(result).toEqual(mockData);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/projects/proj-id/members/user-id/login-history?page=1&limit=20',
                { headers: {} }
            );
        });

        it('should fetch login history with custom pagination parameters', async () => {
            storeMock['swazz_token'] = 'auth-tok';
            const mockData = {
                history: [],
                pagination: { page: 2, limit: 5, total: 10, pages: 2 }
            };
            const mockResponse = new Response(JSON.stringify(mockData), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            const result = await fetchMemberLoginHistory('proj-id', 'user-id', 2, 5);
            expect(result).toEqual(mockData);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/projects/proj-id/members/user-id/login-history?page=2&limit=5',
                {
                    headers: {
                        'Authorization': 'Bearer auth-tok'
                    }
                }
            );
        });

        it('should throw error when server returns error status', async () => {
            const mockResponse = new Response('Forbidden', {
                status: 403
            });
            vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse);

            await expect(fetchMemberLoginHistory('proj-id', 'user-id')).rejects.toThrow('Failed to fetch member login history');
        });
    });
});
