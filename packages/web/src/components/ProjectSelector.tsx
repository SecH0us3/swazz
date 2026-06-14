import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';

interface Project {
    id: string;
    name: string;
    description: string;
}

export function ProjectSelector() {
    const projects = useAppStore(state => state.projects);
    const setProjects = (projs: Project[]) => useAppStore.setState({ projects: projs });
    const activeProject = useAppStore(state => state.activeProject);
    const setActiveProject = (p: Project | null) => {
        useAppStore.setState({
            activeProject: p,
            loadedRunId: null,
            liveRunId: null,
            historyStats: null,
            stats: null,
            liveCount: 0,
            selectedResult: null,
            heatmapFilter: null,
        });
    };
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const handleCreateProject = async (name: string) => {
        const token = localStorage.getItem('swazz_token');
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name })
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            
            // Reload the list of projects
            const listHeaders: Record<string, string> = {};
            if (token) {
                listHeaders['Authorization'] = `Bearer ${token}`;
            }
            const listRes = await fetch('/api/projects', { headers: listHeaders });
            const listData = await listRes.json();
            if (listData.projects) {
                setProjects(listData.projects);
                const newProj = listData.projects.find((p: Project) => p.id === data.id);
                if (newProj) {
                    setActiveProject(newProj);
                }
            }
        } catch {
            alert('Failed to create project');
        }
    };

    useEffect(() => {
        const token = localStorage.getItem('swazz_token');
        const headers: Record<string, string> = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        fetch('/api/projects', { headers })
            .then(res => res.json())
            .then(data => {
                if (data.projects) {
                    setProjects(data.projects);
                    if (data.projects.length > 0 && !activeProject) {
                        useAppStore.setState({ activeProject: data.projects[0] });
                    }
                }
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (projects.length === 0) return null;

    return (
        <div className="dropdown-container" ref={dropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
            <button 
                className="btn btn-ghost" 
                onClick={() => setIsOpen(!isOpen)}
                style={{ 
                    gap: '8px', 
                    padding: '8px 12px', 
                    fontWeight: 500, 
                    width: '100%', 
                    display: 'flex', 
                    justifyContent: 'flex-start', 
                    alignItems: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 'var(--radius-md)',
                }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-light)', flexShrink: 0 }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flexGrow: 1, textAlign: 'left' }}>
                    {activeProject?.name || 'Select Project'}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, marginLeft: 'auto', flexShrink: 0 }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    backgroundColor: 'var(--bg-elevated)',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                    zIndex: 100,
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '4px',
                    border: '1px solid var(--border-default)'
                }}>
                    <div style={{ padding: '8px 12px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                        Your Projects
                    </div>
                    {projects.map(p => (
                        <button
                            key={p.id}
                            className="dropdown-item"
                            onClick={() => {
                                setActiveProject(p);
                                setIsOpen(false);
                            }}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 12px',
                                background: p.id === activeProject?.id ? 'rgba(124,58,237,0.1)' : 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                textAlign: 'left',
                                color: p.id === activeProject?.id ? 'var(--accent-light)' : 'var(--text-default)',
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ fontWeight: p.id === activeProject?.id ? 600 : 400 }}>{p.name}</span>
                            {p.id === activeProject?.id && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            )}
                        </button>
                    ))}
                    <div style={{ height: '1px', background: 'var(--border-default)', margin: '4px 0' }} />
                    <button 
                        className="dropdown-item" 
                        style={{ padding: '8px 12px', background: 'transparent', border: 'none', textAlign: 'left', color: 'var(--accent-light)', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}
                        onClick={() => {
                            setIsOpen(false);
                            const name = prompt('Enter project name:');
                            if (name && name.trim()) {
                                handleCreateProject(name.trim());
                            }
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Create New Project
                    </button>
                    <button 
                        className="dropdown-item" 
                        style={{ padding: '8px 12px', background: 'transparent', border: 'none', textAlign: 'left', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}
                        onClick={() => {
                            setIsOpen(false);
                            useAppStore.setState({ activeTab: 'project_settings' });
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        Project Settings
                    </button>
                </div>
            )}
        </div>
    );
}
