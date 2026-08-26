// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { AccountTab } from './UserSettings/AccountTab.js';
import { SecurityTab } from './UserSettings/SecurityTab.js';
import { DangerZoneTab } from './UserSettings/DangerZoneTab.js';
import { AdminLogsTab } from './UserSettings/AdminLogsTab.js';
import { McpTab } from './UserSettings/McpTab.js';
import { TrafficCaptureTab } from './UserSettings/TrafficCaptureTab.js';
import { LicenseTab } from './UserSettings/LicenseTab.js';

export function UserSettings() {
    const [activeSubTab, setActiveSubTab] = useState<'account' | 'security' | 'danger' | 'admin' | 'mcp' | 'traffic_capture' | 'license'>('account');

    return (
        <div className="settings-page">
            {/* Header */}
            <div className="settings-header">
                <div className="settings-header-info">
                    <h1 className="settings-header-title">Settings</h1>
                    <p className="settings-header-desc">
                        Manage your account details, security settings, and personal options.
                    </p>
                </div>
                <button 
                    className="btn btn-secondary settings-back-btn" 
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
            <div className="settings-body">
                {/* Left Sub-Tab Navigation */}
                <div className="settings-nav">
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'account' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('account')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        Account Details
                    </button>
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'security' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('security')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Security (2FA)
                    </button>
                    <button
                        id="tab-user-license"
                        className={`settings-nav-btn ${activeSubTab === 'license' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('license')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        License & Subscription
                    </button>
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'traffic_capture' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('traffic_capture')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        Traffic Capture
                    </button>
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'mcp' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('mcp')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="logs-nav-icon">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                        </svg>
                        MCP Integration
                    </button>
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'admin' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('admin')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="logs-nav-icon">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        Admin Logs
                    </button>
                    <button
                        className={`settings-nav-btn ${activeSubTab === 'danger' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('danger')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tab-bar-icon">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Danger Zone
                    </button>
                </div>

                {/* Tab Content Cards */}
                <div className="settings-content">
                    {activeSubTab === 'account' && <AccountTab />}
                    {activeSubTab === 'security' && <SecurityTab />}
                    {activeSubTab === 'license' && <LicenseTab />}
                    {activeSubTab === 'traffic_capture' && <TrafficCaptureTab />}
                    {activeSubTab === 'mcp' && <McpTab />}
                    {activeSubTab === 'admin' && <AdminLogsTab />}
                    {activeSubTab === 'danger' && <DangerZoneTab />}
                </div>
            </div>
        </div>
    );
}
