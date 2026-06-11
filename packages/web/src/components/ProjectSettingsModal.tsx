import React from 'react';
import { useAppStore } from '../store/appStore.js';
import { useShallow } from 'zustand/react/shallow';

export function ProjectSettingsModal() {
    const isProjectSettingsOpen = useAppStore(state => state.isProjectSettingsOpen);
    const close = () => useAppStore.setState({ isProjectSettingsOpen: false });

    if (!isProjectSettingsOpen) return null;

    return (
        <div className="modal-overlay" onClick={close} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{
                backgroundColor: 'var(--bg-elevated)',
                padding: '24px',
                borderRadius: 'var(--radius-lg)',
                width: '500px',
                maxWidth: '90vw',
                border: '1px solid var(--border-default)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, fontSize: '18px' }}>Project Settings</h2>
                    <button className="btn btn-ghost btn-icon" onClick={close}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Project Name</label>
                    <input type="text" className="input" defaultValue="Default Project" style={{ width: '100%' }} />
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Description</label>
                    <textarea className="input" defaultValue="Main fuzzing project for production APIs" style={{ width: '100%', minHeight: '80px', resize: 'vertical' }} />
                </div>
                
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Data Retention</label>
                    <select className="input" style={{ width: '100%' }}>
                        <option>30 Days</option>
                        <option>90 Days</option>
                        <option>1 Year</option>
                        <option>Forever</option>
                    </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-default)' }}>
                    <button className="btn btn-danger" onClick={() => {
                        if (confirm('Are you sure you want to delete this project?')) {
                            alert('Delete not implemented');
                        }
                    }}>Delete Project</button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-ghost" onClick={close}>Cancel</button>
                        <button className="btn btn-primary" onClick={close}>Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
