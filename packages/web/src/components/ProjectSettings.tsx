import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useConfig } from '../hooks/useConfig.js';
import { KVEditor } from './Sidebar/Shared.js';
import { ChainingRulesEditor } from './Sidebar/ChainingRulesEditor.js';

interface Project {
    id: string;
    name: string;
    description: string;
}

interface Runner {
    name: string;
    publicKey: string | null;
    status: 'authenticating' | 'connected';
    isMine: boolean;
}

export function ProjectSettings() {
    const activeProject = useAppStore(state => state.activeProject);
    const projects = useAppStore(state => state.projects);
    const userProfile = useAppStore(state => state.userProfile);

    const { config, updateConfig, updateSettings } = useConfig();

    const [activeSubTab, setActiveSubTab] = useState<'general' | 'performance' | 'anomalies' | 'runners' | 'wordlists' | 'chaining'>('general');

    // General Project Info state
    const [projectName, setProjectName] = useState(activeProject?.name || '');
    const [projectDesc, setProjectDesc] = useState(activeProject?.description || '');
    const [targetUrl, setTargetUrl] = useState(config.base_url || '');

    const [isSavingGeneral, setIsSavingGeneral] = useState(false);
    const [saveGeneralSuccess, setSaveGeneralSuccess] = useState(false);
    const [saveGeneralError, setSaveGeneralError] = useState('');

    // Runners state
    const [runners, setRunners] = useState<Runner[]>([]);
    const [isLoadingRunners, setIsLoadingRunners] = useState(false);
    const [runnerError, setRunnerError] = useState('');

    // Status code ignore input state
    const [newIgnoreCode, setNewIgnoreCode] = useState('');

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

    // Fetch and poll runners list when the runners tab is active
    useEffect(() => {
        if (activeSubTab !== 'runners') return;

        let active = true;
        const fetchRunners = async () => {
            const token = localStorage.getItem('swazz_token');
            const headers: Record<string, string> = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            try {
                if (runners.length === 0) setIsLoadingRunners(true);
                const res = await fetch('/api/runners', { headers });
                if (!res.ok) throw new Error('Failed to fetch runners');
                const data = await res.json();
                if (active) {
                    setRunners(data.runners || []);
                    setRunnerError('');
                }
            } catch (err: any) {
                if (active) {
                    setRunnerError(err.message || 'Could not fetch runners list');
                }
            } finally {
                if (active) setIsLoadingRunners(false);
            }
        };

        fetchRunners();
        const interval = setInterval(fetchRunners, 3000);

        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [activeSubTab]);

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
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to update project details');
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

    // Ignore status codes management helpers
    const ignoredCodes = config.rules?.ignore || [];
    const handleAddIgnoreCode = (e: React.FormEvent) => {
        e.preventDefault();
        const codeNum = parseInt(newIgnoreCode.trim());
        if (isNaN(codeNum) || codeNum < 100 || codeNum > 599) {
            alert('Please enter a valid HTTP status code (100-599).');
            return;
        }
        if (ignoredCodes.includes(codeNum)) {
            setNewIgnoreCode('');
            return;
        }

        const nextIgnore = [...ignoredCodes, codeNum].sort();
        updateConfig({
            rules: {
                ...config.rules,
                ignore: nextIgnore
            }
        });
        setNewIgnoreCode('');
    };

    const handleRemoveIgnoreCode = (codeToRemove: number) => {
        const nextIgnore = ignoredCodes.filter(c => c !== codeToRemove);
        updateConfig({
            rules: {
                ...config.rules,
                ignore: nextIgnore
            }
        });
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            padding: '24px',
            height: '100%',
            overflowY: 'auto',
            minWidth: 0
        }}>
            {/* Header */}
            <div style={{
                borderBottom: '1px solid var(--border-default)',
                paddingBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: 'var(--text-default)' }}>Project Settings</h1>
                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>
                        Configure project metadata, security defaults, fuzzing thresholds, and active run environments.
                    </p>
                </div>
                <button 
                    className="btn btn-secondary" 
                    onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                    style={{ gap: '6px', display: 'flex', alignItems: 'center' }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                    Back to Dashboard
                </button>
            </div>

            {/* Layout with Sub-Tabs */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '240px 1fr',
                gap: '32px',
                alignItems: 'start'
            }}>
                {/* Left Sub-Tab Navigation */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '4px',
                    backgroundColor: 'rgba(255,255,255,0.01)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)'
                }}>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'general' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('general')}
                        style={{
                            width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                            background: activeSubTab === 'general' ? 'var(--accent-subtle)' : 'transparent',
                            color: activeSubTab === 'general' ? 'var(--accent-light)' : 'var(--text-secondary)'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="9" x2="15" y2="9"></line>
                            <line x1="9" y1="13" x2="15" y2="13"></line>
                            <line x1="9" y1="17" x2="13" y2="17"></line>
                        </svg>
                        General & Target
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'performance' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('performance')}
                        style={{
                            width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                            background: activeSubTab === 'performance' ? 'var(--accent-subtle)' : 'transparent',
                            color: activeSubTab === 'performance' ? 'var(--accent-light)' : 'var(--text-secondary)'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="6" x2="12" y2="12"></line>
                            <line x1="12" y1="12" x2="16" y2="14"></line>
                        </svg>
                        Fuzzing & Performance
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'anomalies' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('anomalies')}
                        style={{
                            width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                            background: activeSubTab === 'anomalies' ? 'var(--accent-subtle)' : 'transparent',
                            color: activeSubTab === 'anomalies' ? 'var(--accent-light)' : 'var(--text-secondary)'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Anomalies & Security
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'wordlists' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('wordlists')}
                        style={{
                            width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                            background: activeSubTab === 'wordlists' ? 'var(--accent-subtle)' : 'transparent',
                            color: activeSubTab === 'wordlists' ? 'var(--accent-light)' : 'var(--text-secondary)'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        Wordlist Files
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'chaining' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('chaining')}
                        style={{
                            width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                            background: activeSubTab === 'chaining' ? 'var(--accent-subtle)' : 'transparent',
                            color: activeSubTab === 'chaining' ? 'var(--accent-light)' : 'var(--text-secondary)'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                        Request Chaining
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'runners' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('runners')}
                        style={{
                            width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                            background: activeSubTab === 'runners' ? 'var(--accent-subtle)' : 'transparent',
                            color: activeSubTab === 'runners' ? 'var(--accent-light)' : 'var(--text-secondary)',
                            display: 'flex', alignItems: 'center'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                            <line x1="6" y1="6" x2="6.01" y2="6"></line>
                            <line x1="6" y1="18" x2="6.01" y2="18"></line>
                        </svg>
                        Active Runners
                        {runners.length > 0 && (
                            <span className="tab-bar-count" style={{ marginLeft: 'auto', backgroundColor: 'var(--accent)', color: 'white' }}>
                                {runners.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Tab Content Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {activeSubTab === 'general' && (
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
                    )}

                    {activeSubTab === 'performance' && (
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
                                Fuzzing Settings & Rate Limits
                            </h2>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Request Concurrency</label>
                                        <span style={{ fontWeight: 600, color: 'var(--accent-light)' }}>{config.settings.concurrency} workers</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <input 
                                            type="range" 
                                            min="1" 
                                            max="10" 
                                            value={config.settings.concurrency} 
                                            onChange={(e) => updateSettings({ concurrency: parseInt(e.target.value) || 1 })}
                                            style={{ flex: 1, accentColor: 'var(--accent)' }}
                                        />
                                        <input 
                                            type="number"
                                            className="input"
                                            style={{ width: '60px', textAlign: 'center' }}
                                            value={config.settings.concurrency}
                                            onChange={(e) => updateSettings({ concurrency: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })}
                                        />
                                    </div>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                        The number of requests dispatched simultaneously by the agent runner. Higher concurrency speeds up scans but increases target server load.
                                    </span>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Individual Request Timeout (ms)</label>
                                    <input 
                                        type="number" 
                                        className="input" 
                                        value={config.settings.timeout_ms} 
                                        onChange={(e) => updateSettings({ timeout_ms: parseInt(e.target.value) || 2000 })}
                                        style={{ width: '120px' }} 
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                        Maximum milliseconds to wait for each HTTP response before triggering a timeout anomaly.
                                    </span>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Delay Between Requests (ms)</label>
                                    <input 
                                        type="number" 
                                        className="input" 
                                        value={config.settings.delay_between_requests_ms} 
                                        onChange={(e) => updateSettings({ delay_between_requests_ms: parseInt(e.target.value) || 0 })}
                                        style={{ width: '120px' }} 
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                        Introduces an artificial sleep duration between outgoing requests (ideal for target rate limit bypass or sensitive local tests).
                                    </span>
                                </div>

                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Fuzzing Intensity (Iterations per profile)</label>
                                    <input 
                                        type="number" 
                                        className="input" 
                                        value={config.settings.iterations_per_profile} 
                                        onChange={(e) => updateSettings({ iterations_per_profile: parseInt(e.target.value) || 10 })}
                                        style={{ width: '120px' }} 
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                        Controls the volume of payload variations tested on each endpoint. High values provide thorough code path exploration at the expense of scan execution time.
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSubTab === 'anomalies' && (
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
                                Vulnerability & Anomaly Analysis
                            </h2>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Analyze response body */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label className="premium-checkbox-label">
                                        <input
                                            type="checkbox"
                                            className="premium-checkbox"
                                            checked={config.settings.analyze_response_body ?? true}
                                            onChange={() => updateSettings({
                                                analyze_response_body: !(config.settings.analyze_response_body ?? true)
                                            })}
                                        />
                                        <strong style={{ fontSize: '13px' }}>Enable Response Body Structural Analysis</strong>
                                    </label>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                                        Inspect responses dynamically to detect schema changes, reflection vectors, or internal stack trace leakage. Required for findings triage.
                                    </span>
                                </div>

                                {config.settings.analyze_response_body !== false && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginLeft: '24px', paddingLeft: '16px', borderLeft: '2px solid var(--border-default)' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Size Anomaly Deviation Multiplier</label>
                                            <input 
                                                type="number" 
                                                className="input" 
                                                step="0.1"
                                                min="1"
                                                value={config.settings.response_size_anomaly_multiplier ?? 5.0} 
                                                onChange={(e) => updateSettings({ response_size_anomaly_multiplier: parseFloat(e.target.value) || 5.0 })}
                                                style={{ width: '120px' }} 
                                            />
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                                Classify size changes larger than this multiplier of standard deviations as structural body size anomalies.
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Timeout anomalies */}
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>Time-delay Anomaly Threshold (ms)</label>
                                    <input 
                                        type="number" 
                                        className="input" 
                                        value={config.settings.time_anomaly_threshold_ms ?? 4000} 
                                        onChange={(e) => updateSettings({ time_anomaly_threshold_ms: parseInt(e.target.value) || 4000 })}
                                        style={{ width: '120px' }} 
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                        Flag response latencies higher than this threshold as a delay anomaly (essential for identifying SQL injection / Command injection time-delay checks).
                                    </span>
                                </div>

                                {/* Security SSRF */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                                    <label className="premium-checkbox-label">
                                        <input
                                            type="checkbox"
                                            className="premium-checkbox"
                                            checked={config.security?.allow_private_ips ?? false}
                                            onChange={() => updateConfig({
                                                security: {
                                                    ...config.security,
                                                    allow_private_ips: !(config.security?.allow_private_ips ?? false)
                                                }
                                            })}
                                        />
                                        <strong style={{ fontSize: '13px' }}>Allow Scanner Private IP Scopes (Skip SSRF protection)</strong>
                                    </label>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                                        By default, Swazz agents block scanning targets resolved as private IPv4/IPv6 address blocks (e.g. 127.0.0.1, 10.x.x.x) to prevent internal-network loops. Toggle this if you are running tests against internal/local developers.
                                    </span>
                                </div>

                                {/* BOLA access testing */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                                    <label className="premium-checkbox-label">
                                        <input
                                            type="checkbox"
                                            className="premium-checkbox"
                                            checked={config.settings.bola_testing ?? false}
                                            onChange={() => updateSettings({
                                                bola_testing: !(config.settings.bola_testing ?? false)
                                            })}
                                        />
                                        <strong style={{ fontSize: '13px' }}>Enable Broken Object Level Authorization (BOLA) checking</strong>
                                    </label>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}>
                                        Compare primary user endpoints against credentials for a secondary user profile (User B) to detect improper access control settings.
                                    </span>
                                </div>

                                {/* Ignored status codes */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                                    <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>Ignored HTTP Status Codes</label>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                        Configure status codes that are treated as expected behavior and will be ignored in anomaly reports.
                                    </span>

                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' }}>
                                        {ignoredCodes.length === 0 ? (
                                            <span style={{ fontSize: '12px', color: 'var(--text-disabled)', fontStyle: 'italic' }}>No custom ignored status codes. Standard success codes (1xx, 2xx, 3xx) are ignored by default.</span>
                                        ) : (
                                            ignoredCodes.map(code => (
                                                <span 
                                                    key={code} 
                                                    className="tag-btn active"
                                                    style={{ 
                                                        display: 'inline-flex', 
                                                        alignItems: 'center', 
                                                        gap: '6px',
                                                        padding: '4px 10px',
                                                        backgroundColor: 'rgba(124, 58, 237, 0.15)',
                                                        border: '1px solid rgba(124, 58, 237, 0.3)',
                                                        borderRadius: 'var(--radius-full)',
                                                        fontSize: '12px',
                                                        color: 'var(--accent-light)'
                                                    }}
                                                >
                                                    {code}
                                                    <button 
                                                        type="button" 
                                                        onClick={() => handleRemoveIgnoreCode(code)}
                                                        style={{ 
                                                            border: 'none', 
                                                            background: 'transparent', 
                                                            color: 'var(--text-secondary)', 
                                                            cursor: 'pointer',
                                                            fontSize: '10px',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            padding: '2px'
                                                        }}
                                                    >
                                                        ✕
                                                    </button>
                                                </span>
                                            ))
                                        )}
                                    </div>

                                    <form onSubmit={handleAddIgnoreCode} style={{ display: 'flex', gap: '8px', maxWidth: '240px' }}>
                                        <input 
                                            type="text" 
                                            className="input" 
                                            placeholder="e.g. 404"
                                            value={newIgnoreCode}
                                            onChange={(e) => setNewIgnoreCode(e.target.value)}
                                            style={{ width: '100px', textAlign: 'center' }}
                                        />
                                        <button type="submit" className="btn btn-secondary btn-sm">Add Code</button>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSubTab === 'runners' && (
                        <div className="card" style={{
                            backgroundColor: 'var(--bg-elevated)',
                            padding: '24px',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-default)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                                    Distributed Fuzzing Agents (Runners)
                                </h2>
                                <span style={{
                                    fontSize: '11px',
                                    color: 'var(--text-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    <span className="dot pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
                                    Live Coordinator Status
                                </span>
                            </div>

                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                                View all available agent runner nodes currently connected to the central coordinator. 
                                When you start a scan, the coordinator dispatches fuzz instructions to available agents, prioritizing your own matching signing keys first.
                            </p>

                            {isLoadingRunners && runners.length === 0 ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                                    Loading active runner registry...
                                </div>
                            ) : runnerError ? (
                                <div style={{
                                    padding: '12px 16px',
                                    backgroundColor: 'var(--color-error-bg)',
                                    border: '1px solid rgba(244,63,94,0.25)',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'var(--color-error)',
                                    fontSize: '13px'
                                }}>
                                    Error: {runnerError}
                                </div>
                            ) : runners.length === 0 ? (
                                <div className="empty-state" style={{ padding: '32px 0', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                    <div className="empty-state-icon" style={{ fontSize: '24px', marginBottom: '8px' }}>🔌</div>
                                    <div className="empty-state-title" style={{ fontSize: '14px' }}>No runners connected</div>
                                    <div className="empty-state-text" style={{ fontSize: '12px', maxWidth: '380px', margin: '4px auto 0 auto', textAlign: 'center' }}>
                                        Scan coordinator has zero active web socket runners. Register and run a local agent on your machine.
                                    </div>
                                    <button 
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => useAppStore.setState({ activeTab: 'settings' })}
                                        style={{ marginTop: '16px' }}
                                    >
                                        Setup Local Runner
                                    </button>
                                </div>
                            ) : (
                                <div style={{
                                    border: '1px solid var(--border-default)',
                                    borderRadius: 'var(--radius-md)',
                                    overflow: 'hidden'
                                }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-default)' }}>
                                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Agent Name</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Public Key Hash</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Owner</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {runners.map((r, i) => (
                                                <tr key={i} style={{ borderBottom: i === runners.length - 1 ? 'none' : '1px solid var(--border-subtle)', backgroundColor: r.isMine ? 'rgba(124,58,237,0.03)' : 'transparent' }}>
                                                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>{r.name}</td>
                                                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>
                                                        {r.publicKey ? `${r.publicKey.substring(0, 16)}...` : 'Anonymous'}
                                                    </td>
                                                    <td style={{ padding: '12px 16px' }}>
                                                        {r.isMine ? (
                                                            <span style={{
                                                                fontSize: '11px',
                                                                fontWeight: 600,
                                                                color: 'var(--color-success)',
                                                                backgroundColor: 'rgba(34,211,160,0.12)',
                                                                padding: '2px 8px',
                                                                borderRadius: '12px'
                                                            }}>You</span>
                                                        ) : (
                                                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Shared Pool</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '12px 16px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <span className={`dot ${r.status === 'connected' ? 'pulse' : ''}`} style={{
                                                                width: '6px',
                                                                height: '6px',
                                                                borderRadius: '50%',
                                                                backgroundColor: r.status === 'connected' ? 'var(--color-success)' : 'var(--color-warning)'
                                                            }} />
                                                            <span style={{
                                                                fontSize: '12px',
                                                                color: r.status === 'connected' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                                textTransform: 'capitalize'
                                                            }}>{r.status}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {activeSubTab === 'wordlists' && (
                        <div className="card" style={{
                            backgroundColor: 'var(--bg-elevated)',
                            padding: '24px',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-default)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px'
                        }}>
                            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                                Wordlist Files Configuration
                            </h2>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                                Map custom payload categories to specific wordlist files in the runner's `wordlists/` directory.
                            </p>
                            <KVEditor
                                entries={config.wordlist_files || {}}
                                onChange={(w) => updateConfig({ wordlist_files: w })}
                                keyPlaceholder="Category (e.g. xss)"
                                valuePlaceholder="Filename (in wordlists/ dir)"
                            />
                        </div>
                    )}

                    {activeSubTab === 'chaining' && (
                        <div className="card" style={{
                            backgroundColor: 'var(--bg-elevated)',
                            padding: '24px',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-default)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px'
                        }}>
                            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                                Request Chaining Rules
                            </h2>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                                Configure chaining rules to extract dynamic variables (like CSRF tokens or session IDs) from responses and inject them into subsequent test requests.
                            </p>
                            <ChainingRulesEditor 
                                rules={config.settings.chaining_rules || []} 
                                onChange={(rules) => updateSettings({ chaining_rules: rules })} 
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
