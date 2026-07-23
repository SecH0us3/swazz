import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';

interface UserMenuProps {
    onLogout: () => void;
    isGuest?: boolean;
}

export function UserMenu({ onLogout, isGuest: isGuestProp }: UserMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const userProfile = useAppStore(state => state.userProfile);
    const isGuest = isGuestProp || !!userProfile?.isGuest;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="dropdown-container" ref={dropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <button 
                className="btn btn-secondary user-menu-btn" 
                onClick={() => setIsOpen(!isOpen)}
                title="Account"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="user-menu-avatar-icon">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span className="user-menu-username">{isGuest ? 'Guest' : userProfile?.username || 'User'}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`user-menu-chevron ${isOpen ? 'open' : ''}`}>
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
                    minWidth: '180px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    zIndex: 1000,
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '4px',
                    border: '1px solid var(--border-default)'
                }}>
                    <button 
                        className="dropdown-item" 
                        style={{ padding: '8px 12px', background: 'transparent', border: 'none', textAlign: 'left', color: 'var(--text-default)', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}
                        onClick={() => {
                            setIsOpen(false);
                            useAppStore.setState({ activeTab: 'settings' });
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        Profile Settings
                    </button>
                    <div style={{ height: '1px', background: 'var(--border-default)', margin: '4px 0' }} />
                    <button 
                        className="dropdown-item" 
                        style={{ padding: '8px 12px', background: 'transparent', border: 'none', textAlign: 'left', color: 'var(--color-error)', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }}
                        onClick={() => {
                            setIsOpen(false);
                            onLogout();
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                            <polyline points="16 17 21 12 16 7"></polyline>
                            <line x1="21" y1="12" x2="9" y2="12"></line>
                        </svg>
                        Logout
                    </button>
                </div>
            )}
        </div>
    );
}
