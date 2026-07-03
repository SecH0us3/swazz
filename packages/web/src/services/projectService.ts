import { useAppStore } from '../store/appStore.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export interface Project {
    id: string;
    name: string;
    description: string;
}

export async function fetchProjects(): Promise<Project[]> {
    const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    const headers: Record<string, string> = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${PROXY_URL}/api/projects`, { headers });
    if (!res.ok) {
        throw new Error('Failed to fetch projects');
    }
    const data = await res.json();
    return data.projects || [];
}

export async function createProject(name: string): Promise<{ id: string; status: string }> {
    const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const csrfToken = useAppStore.getState().csrfToken;
    if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
    }
    const res = await fetch(`${PROXY_URL}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name })
    });
    if (!res.ok) {
        throw new Error('Failed to create project');
    }
    return res.json();
}

import type { LoginHistoryEntry } from '../types.js';

export async function fetchMemberLoginHistory(
    projectId: string,
    userId: string,
    page = 1,
    limit = 20
): Promise<{ history: LoginHistoryEntry[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
    const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    const headers: Record<string, string> = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${PROXY_URL}/api/projects/${projectId}/members/${userId}/login-history?page=${page}&limit=${limit}`, { headers });
    if (!res.ok) {
        throw new Error('Failed to fetch member login history');
    }
    return res.json();
}
