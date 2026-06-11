import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';

interface Project {
    id: string;
    name: string;
    description: string;
}

export function ProjectSelector() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeProject, setActiveProject] = useState<Project | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch('/api/projects')
            .then(res => res.json())
            .then(data => {
                if (data.projects) {
                    setProjects(data.projects);
                    if (data.projects.length > 0 && !activeProject) {
                        setActiveProject(data.projects[0]);
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
        <div className="dropdown-container" ref={dropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <button 
                className="btn btn-ghost" 
                onClick={() => setIsOpen(!isOpen)}
                style={{ gap: '6px', padding: '4px 8px', fontWeight: 500 }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                {activeProject?.name || 'Select Project'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '4px',
                    backgroundColor: 'var(--bg-elevated)',
                    minWidth: '200px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
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
                        style={{ padding: '8px 12px', background: 'transparent', border: 'none', textAlign: 'left', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}
                        onClick={() => {
                            setIsOpen(false);
                            useAppStore.setState({ isProjectSettingsOpen: true });
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
