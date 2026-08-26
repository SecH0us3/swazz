// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function DangerZoneTab() {
    const [deleteState, setDeleteState] = useState<'idle' | 'warning' | 'deleting'>('idle');
    const [deleteError, setDeleteError] = useState('');

    const handleDeleteAccount = async () => {
        if (deleteState === 'idle') {
            setDeleteState('warning');
            return;
        }
        if (deleteState === 'warning') {
            setDeleteState('deleting');
            setDeleteError('');
            const token = localStorage.getItem('swazz_token');
            const csrfToken = useAppStore.getState().csrfToken;
            const headers: Record<string, string> = {
                'Authorization': `Bearer ${token}`
            };
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
            try {
                const res = await fetch(`${PROXY_URL}/api/users/me`, {
                    method: 'DELETE',
                    headers
                });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Failed to delete account');
                }
                
                useAppStore.setState(state => ({
                    userProfile: state.userProfile ? {
                        ...state.userProfile,
                        deleteRequestedAt: new Date().toISOString()
                    } : null
                }));
                
                setDeleteState('idle');
            } catch (err: any) {
                console.error(err);
                setDeleteError(err.message || 'An error occurred during account deletion');
                setDeleteState('idle');
            }
        }
    };

    return (
        <div className="settings-card settings-danger-card">
            <h2 className="settings-danger-title">
                Danger Zone
            </h2>
            
            {deleteState === 'idle' ? (
                <div className="settings-delete-container">
                    <p className="settings-danger-text">
                        Permanently delete your account and all associated resources. This action is irreversible.
                    </p>
                    <button 
                        className="btn btn-danger btn-sm settings-btn-w-full"
                        onClick={handleDeleteAccount}
                        type="button"
                    >
                        Delete My Account & Data
                    </button>
                </div>
            ) : deleteState === 'warning' ? (
                <div className="settings-delete-container">
                    <h3 className="settings-delete-title">⚠️ Irreversible Action!</h3>
                    <p className="settings-delete-desc">
                        This will immediately delete all your scan histories, projects, configurations, and private runners from the platform. There is no backup and this cannot be undone.
                    </p>
                    <div className="settings-delete-actions">
                        <button 
                            className="btn btn-danger btn-sm"
                            onClick={handleDeleteAccount}
                            type="button"
                        >
                            Yes, delete permanently
                        </button>
                        <button 
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setDeleteState('idle'); setDeleteError(''); }}
                            type="button"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div className="settings-delete-container">
                    <p className="settings-danger-text">
                        Executing data purge. Please wait...
                    </p>
                    <button 
                        className="btn btn-danger btn-sm settings-btn-w-full"
                        disabled
                        type="button"
                    >
                        Deleting account...
                    </button>
                </div>
            )}
            
            {deleteError && (
                <p className="settings-delete-error">
                    Error: {deleteError}
                </p>
            )}
        </div>
    );
}
