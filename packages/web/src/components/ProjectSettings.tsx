import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';
import { GeneralTab } from './ProjectSettings/GeneralTab.js';
import { PerformanceTab } from './ProjectSettings/PerformanceTab.js';
import { AnomaliesTab } from './ProjectSettings/AnomaliesTab.js';
import { RunnersTab } from './ProjectSettings/RunnersTab.js';
import { WordlistsTab } from './ProjectSettings/WordlistsTab.js';
import { ChainingTab } from './ProjectSettings/ChainingTab.js';
import { RawConfigTab } from './ProjectSettings/RawConfigTab.js';

interface Runner {
    connectionId: string | null;
    name: string;
    publicKey: string | null;
    status: 'authenticating' | 'connected';
    isMine: boolean;
    isShared: boolean;
    version?: string;
}

export function ProjectSettings() {
    const [activeSubTab, setActiveSubTab] = useState<'general' | 'performance' | 'anomalies' | 'runners' | 'wordlists' | 'chaining' | 'raw_config'>('general');

    // Runners state (kept in parent for count badge in tab navigation)
    const [runners, setRunners] = useState<Runner[]>([]);
    const [isLoadingRunners, setIsLoadingRunners] = useState(false);
    const [runnerError, setRunnerError] = useState('');

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
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'raw_config' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('raw_config')}
                        style={{
                            width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                            background: activeSubTab === 'raw_config' ? 'var(--accent-subtle)' : 'transparent',
                            color: activeSubTab === 'raw_config' ? 'var(--accent-light)' : 'var(--text-secondary)'
                        }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>
                        Raw JSON Config
                    </button>
                </div>

                {/* Tab Content Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {activeSubTab === 'general' && <GeneralTab />}
                    {activeSubTab === 'performance' && <PerformanceTab />}
                    {activeSubTab === 'anomalies' && <AnomaliesTab />}
                    {activeSubTab === 'wordlists' && <WordlistsTab />}
                    {activeSubTab === 'chaining' && <ChainingTab />}
                    {activeSubTab === 'runners' && (
                        <RunnersTab 
                            runners={runners} 
                            isLoadingRunners={isLoadingRunners} 
                            runnerError={runnerError} 
                        />
                    )}
                    {activeSubTab === 'raw_config' && <RawConfigTab />}
                </div>
            </div>
        </div>
    );
}
