import React from 'react';
import { useAppStore } from '../store/appStore.js';
import { useShallow } from 'zustand/react/shallow';

export function UserProfileModal() {
    const isUserProfileOpen = useAppStore(state => state.isUserProfileOpen);
    const close = () => useAppStore.setState({ isUserProfileOpen: false });

    if (!isUserProfileOpen) return null;

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
                width: '400px',
                maxWidth: '90vw',
                border: '1px solid var(--border-default)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, fontSize: '18px' }}>User Profile Settings</h2>
                    <button className="btn btn-ghost btn-icon" onClick={close}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Email Address</label>
                    <input type="text" className="input" value="user@example.com" disabled style={{ width: '100%', opacity: 0.7 }} />
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>API Key</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input type="password" className="input" value="swazz_live_XXXXXXXXXXXXXXXX" disabled style={{ flex: 1, opacity: 0.7 }} />
                        <button className="btn btn-secondary">Regenerate</button>
                    </div>
                    <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Use this key for CLI authentication.</p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                    <button className="btn btn-primary" onClick={close}>Done</button>
                </div>
            </div>
        </div>
    );
}
