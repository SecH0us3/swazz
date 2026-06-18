import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useConfig } from '../../hooks/useConfig.js';

export function GeneralTab() {
    const activeProject = useAppStore(state => state.activeProject);
    const projects = useAppStore(state => state.projects);

    const { config, updateConfig, updateSettings } = useConfig();

    // General Project Info state
    const [projectName, setProjectName] = useState(activeProject?.name || '');
    const [projectDesc, setProjectDesc] = useState(activeProject?.description || '');
    const [targetUrl, setTargetUrl] = useState(config.base_url || '');

    const [isSavingGeneral, setIsSavingGeneral] = useState(false);
    const [saveGeneralSuccess, setSaveGeneralSuccess] = useState(false);
    const [saveGeneralError, setSaveGeneralError] = useState('');

    // Sync state when active project changes
    useEffect(() => {
        if (activeProject) {
            setProjectName(activeProject.name);
            setProjectDesc(activeProject.description);
        }
    }, [activeProject]);

    // Sync targetUrl when config base_url loads/changes
    useEffect(() => {
        setTargetUrl(config.base_url || '');
    }, [config.base_url]);

    const handleSaveGeneral = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProject) return;

        setIsSavingGeneral(true);
        setSaveGeneralSuccess(false);
        setSaveGeneralError('');

        const token = localStorage.getItem('swazz_token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        try {
            // Update project metadata on backend
            const res = await fetch(`/api/projects/${activeProject.id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ name: projectName, description: projectDesc })
            });

            if (!res.ok) {
                const contentType = res.headers.get('content-type');
                let errMsg = 'Failed to update project details';
                if (contentType && contentType.includes('application/json')) {
                    const errData = await res.json().catch(() => ({}));
                    errMsg = errData.error || errMsg;
                } else {
                    const text = await res.text().catch(() => '');
                    errMsg = text || res.statusText || errMsg;
                }
                throw new Error(errMsg);
            }

            // Sync with base_url
            updateConfig({ base_url: targetUrl.trim() });

            // Update local store state
            const updatedProject = { ...activeProject, name: projectName, description: projectDesc };
            const updatedProjectsList = projects.map(p => p.id === activeProject.id ? updatedProject : p);
            
            useAppStore.setState({
                activeProject: updatedProject,
                projects: updatedProjectsList
            });

            setSaveGeneralSuccess(true);
            setTimeout(() => setSaveGeneralSuccess(false), 3000);
        } catch (err: any) {
            setSaveGeneralError(err.message || 'Failed to save settings');
        } finally {
            setIsSavingGeneral(false);
        }
    };

    const handleDeleteProject = async () => {
        if (!activeProject) return;
        const confirmName = prompt(`Type "${activeProject.name}" to delete this project. This is permanent and deletes all scan runs:`);
        if (confirmName !== activeProject.name) {
            if (confirmName !== null) alert('Project name mismatch. Deletion cancelled.');
            return;
        }

        const token = localStorage.getItem('swazz_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        try {
            const res = await fetch(`/api/projects/${activeProject.id}`, {
                method: 'DELETE',
                headers
            });

            if (!res.ok) throw new Error('Deletion request failed');

            // Find next project to switch to
            const remaining = projects.filter(p => p.id !== activeProject.id);
            useAppStore.setState({
                projects: remaining,
                activeProject: remaining.length > 0 ? remaining[0] : null,
                activeTab: 'heatmap',
                loadedRunId: null,
                liveRunId: null,
                stats: null,
                historyStats: null,
            });

            alert('Project deleted successfully.');
        } catch (err: any) {
            alert(err.message || 'Failed to delete project');
        }
    };

    return (
        <div className="card" style={{
            backgroundColor: 'var(--bg-elevated)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
        }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                Project Details & Target
            </h2>

            <form onSubmit={handleSaveGeneral} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Project Name</label>
                    <input 
                        type="text" 
                        className="input" 
                        value={projectName} 
                        onChange={(e) => setProjectName(e.target.value)}
                        style={{ width: '100%' }} 
                        required
                    />
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Description</label>
                    <textarea 
                        className="input" 
                        value={projectDesc} 
                        onChange={(e) => setProjectDesc(e.target.value)}
                        style={{ width: '100%', minHeight: '80px', resize: 'vertical' }} 
                    />
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Target Base URL</label>
                    <input 
                        type="text" 
                        className="input" 
                        placeholder="e.g. https://api.production.internal"
                        value={targetUrl} 
                        onChange={(e) => setTargetUrl(e.target.value)}
                        style={{ width: '100%' }} 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        Endpoints loaded from swagger spec will prefix calls with this base url.
                    </span>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Data Retention</label>
                    <select 
                        className="input" 
                        value={config.settings.data_retention || 'forever'} 
                        onChange={(e) => updateSettings({ data_retention: e.target.value })}
                        style={{ width: '100%' }}
                    >
                        <option value="30_days">30 Days</option>
                        <option value="90_days">90 Days</option>
                        <option value="1_year">1 Year</option>
                        <option value="forever">Forever</option>
                    </select>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                        Controls how long scan histories and findings logs are stored in the local index or cloud backup.
                    </span>
                </div>

                {/* Disable Shared Runners Toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.disable_shared_runners ?? false}
                            onChange={(e) => updateSettings({ disable_shared_runners: e.target.checked })}
                        />
                        <strong style={{ fontSize: '13px' }}>Disable Shared Runners</strong>
                    </label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                        Only dispatch scans to your own private runner nodes. Shared runners from the public pool will not receive scan requests.
                    </span>
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' }}>
                    <button type="submit" className="btn btn-primary" disabled={isSavingGeneral}>
                        {isSavingGeneral ? 'Saving...' : 'Save General Info'}
                    </button>
                    {saveGeneralSuccess && (
                        <span style={{ color: 'var(--color-success)', fontSize: '13px' }}>✓ Saved successfully</span>
                    )}
                    {saveGeneralError && (
                        <span style={{ color: 'var(--color-error)', fontSize: '13px' }}>Error: {saveGeneralError}</span>
                    )}
                </div>
            </form>

            {/* Danger Zone */}
            <div style={{
                marginTop: '24px',
                borderTop: '1px solid rgba(244,63,94,0.15)',
                paddingTop: '24px'
            }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--color-error)', marginBottom: '8px' }}>Danger Zone</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: '1.4' }}>
                    Deleting this project will permanently delete all metadata, custom profiles, target configurations, scan histories, and findings logs.
                </p>
                <button className="btn btn-danger" onClick={handleDeleteProject}>
                    Delete Project
                </button>
            </div>
        </div>
    );
}
