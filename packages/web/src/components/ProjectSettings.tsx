import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';
import { GeneralTab } from './ProjectSettings/GeneralTab.js';
import { PerformanceTab } from './ProjectSettings/PerformanceTab.js';
import { AnomaliesTab } from './ProjectSettings/AnomaliesTab.js';
import { RunnersTab } from './ProjectSettings/RunnersTab.js';
import { WordlistsTab } from './ProjectSettings/WordlistsTab.js';
import { ChainingTab } from './ProjectSettings/ChainingTab.js';
import { RawConfigTab } from './ProjectSettings/RawConfigTab.js';
import { AiRemediationTab } from './ProjectSettings/AiRemediationTab.js';
import { MembersRolesTab } from './ProjectSettings/MembersRolesTab.js';
import { DictionariesTab } from './ProjectSettings/DictionariesTab.js';
import { ApiSpecsTab } from './ProjectSettings/ApiSpecsTab.js';
import { KeysTab } from './ProjectSettings/KeysTab.js';
import { ScheduleTab } from './ProjectSettings/ScheduleTab.js';
import { AuditTrailTab } from './ProjectSettings/AuditTrailTab.js';
import { WebhooksTab } from './ProjectSettings/WebhooksTab.js';
import { AuthSequenceTab } from './ProjectSettings/AuthSequenceTab.js';
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
    const [activeSubTab, setActiveSubTab] = useState<'general' | 'members' | 'api_specs' | 'performance' | 'anomalies' | 'runners' | 'wordlists' | 'dictionaries' | 'chaining' | 'ai_remediation' | 'keys' | 'raw_config' | 'schedule' | 'audit_trail' | 'webhooks' | 'auth_sequence'>('general');

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
        <div className="project-settings-layout">
            {/* Header */}
            <div className="project-settings-header">
                <div>
                    <h1 className="project-settings-title">Project Settings</h1>
                    <p className="project-settings-subtitle">
                        Configure project metadata, security defaults, fuzzing thresholds, and active run environments.
                    </p>
                </div>
                <button 
                    className="btn btn-secondary btn-back-dashboard" 
                    onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                    Back to Dashboard
                </button>
            </div>

            {/* Layout with Sub-Tabs */}
            <div className="project-settings-body">
                {/* Navigation Sidebar */}
                <div className="project-settings-nav">
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'general' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('general')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="9" x2="15" y2="9"></line>
                            <line x1="9" y1="13" x2="15" y2="13"></line>
                            <line x1="9" y1="17" x2="13" y2="17"></line>
                        </svg>
                        General & Target
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'members' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('members')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        Members & Roles
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'api_specs' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('api_specs')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                        </svg>
                        API Specifications
                    </button>

                    <button
                        className={`tab-bar-btn ${activeSubTab === 'performance' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('performance')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="6" x2="12" y2="12"></line>
                            <line x1="12" y1="12" x2="16" y2="14"></line>
                        </svg>
                        Fuzzing & Performance
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'anomalies' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('anomalies')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Anomalies & Security
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'wordlists' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('wordlists')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        Wordlist Files
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'dictionaries' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('dictionaries')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                        </svg>
                        Fuzzing Dictionaries
                    </button>

                    <button
                        className={`tab-bar-btn ${activeSubTab === 'auth_sequence' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('auth_sequence')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Auth Sequence
                    </button>

                    <button
                        className={`tab-bar-btn ${activeSubTab === 'chaining' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('chaining')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                        Request Chaining
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'runners' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('runners')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                            <line x1="6" y1="6" x2="6.01" y2="6"></line>
                            <line x1="6" y1="18" x2="6.01" y2="18"></line>
                        </svg>
                        Active Runners
                        {runners.length > 0 && (
                            <span className="tab-bar-count tab-bar-count--accent">
                                {runners.length}
                            </span>
                        )}
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'ai_remediation' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('ai_remediation')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
                            <path d="M12 12L2.1 7.1"></path>
                            <path d="M12 12l9.9 4.9"></path>
                        </svg>
                        AI Remediation
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'keys' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('keys')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Encryption Keys
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'raw_config' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('raw_config')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <polyline points="16 18 22 12 16 6"></polyline>
                            <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>
                        Raw JSON Config
                    </button>
                    <button
                        className={`tab-bar-btn ${activeSubTab === 'schedule' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('schedule')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        Scan Scheduler
                    </button>
                    <button
                        id="tab-audit-trail"
                        className={`tab-bar-btn ${activeSubTab === 'audit_trail' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('audit_trail')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M9 12h6M9 16h6M9 8h6M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
                            <path d="M12 2v4" strokeLinecap="round" />
                        </svg>
                        Audit Trail
                    </button>
                    <button
                        id="tab-webhooks"
                        className={`tab-bar-btn ${activeSubTab === 'webhooks' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('webhooks')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                        Webhooks
                    </button>
                </div>

                {/* Main Content Area */}
                <div className="project-settings-content">
                    {activeSubTab === 'general' && <GeneralTab />}
                    {activeSubTab === 'members' && <MembersRolesTab />}
                    {activeSubTab === 'api_specs' && <ApiSpecsTab />}
                    {activeSubTab === 'performance' && <PerformanceTab />}
                    {activeSubTab === 'anomalies' && <AnomaliesTab />}
                    {activeSubTab === 'wordlists' && <WordlistsTab />}
                    {activeSubTab === 'dictionaries' && <DictionariesTab />}
                    {activeSubTab === 'chaining' && <ChainingTab />}
                    {activeSubTab === 'auth_sequence' && <AuthSequenceTab />}

                    {activeSubTab === 'runners' && (
                        <RunnersTab 
                            runners={runners} 
                            isLoadingRunners={isLoadingRunners} 
                            runnerError={runnerError} 
                        />
                    )}
                    {activeSubTab === 'ai_remediation' && <AiRemediationTab />}
                    {activeSubTab === 'keys' && <KeysTab />}
                    {activeSubTab === 'raw_config' && <RawConfigTab />}
                    {activeSubTab === 'schedule' && <ScheduleTab />}
                    {activeSubTab === 'audit_trail' && <AuditTrailTab />}
                    {activeSubTab === 'webhooks' && <WebhooksTab />}
                </div>
            </div>
        </div>
    );
}
