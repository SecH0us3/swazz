import React, { useState, useEffect } from 'react';
import { Modal } from '../Shared/Modal';
import { useConfig } from '../../hooks/useConfig';
import type { PayloadCatalog, FuzzingProfile } from '../../types';

interface PayloadSettingsModalProps {
    onClose: () => void;
}

const API_BASE = ((import.meta.env.VITE_PROXY_URL as string) || '').replace(/\/$/, '');

export const PayloadSettingsModal: React.FC<PayloadSettingsModalProps> = ({ onClose }) => {
    const { config, updatePayloadCategories } = useConfig();
    const [catalog, setCatalog] = useState<PayloadCatalog | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<FuzzingProfile>('RANDOM');

    useEffect(() => {
        fetch(`${API_BASE}/api/payload-catalog`)
            .then(res => {
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                return res.json();
            })
            .then(data => {
                setCatalog(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, []);

    const enabledCategories = (config.settings.payload_categories || {}) as Record<FuzzingProfile, string[]>;

    const toggleCategory = (profile: FuzzingProfile, categoryId: string) => {
        const currentIds = enabledCategories[profile] ?? (catalog?.[profile].map(c => c.id) || []);
        
        let newIds: string[];
        if (currentIds.includes(categoryId)) {
            newIds = currentIds.filter(id => id !== categoryId);
        } else {
            newIds = [...currentIds, categoryId];
        }

        const newPayloadCategories = {
            ...enabledCategories,
            [profile]: newIds
        };
        
        updatePayloadCategories(newPayloadCategories);
    };

    if (loading) return <Modal title="Payload Settings" onClose={onClose}><div className="loading-spinner">Loading catalog...</div></Modal>;
    if (error) return <Modal title="Payload Settings" onClose={onClose}><div className="error-message">{error}</div></Modal>;
    if (!catalog) return null;

    const profiles: FuzzingProfile[] = ['RANDOM', 'BOUNDARY', 'MALICIOUS'];

    return (
        <Modal title="Payload Settings" onClose={onClose} width="800px">
            <div className="payload-catalog-container">
                <div className="tabs-header">
                    {profiles.map(p => (
                        <button 
                            key={p}
                            className={`tab-button ${activeTab === p ? 'active' : ''}`}
                            onClick={() => setActiveTab(p)}
                        >
                            {p.charAt(0) + p.slice(1).toLowerCase()}
                        </button>
                    ))}
                </div>

                <div className="tab-content">
                    <div className="catalog-profile-section">
                        <div className="catalog-profile-header">
                            <div className={`status-dot profile-${activeTab.toLowerCase()}`} />
                            <h3>{activeTab} Profile Configuration</h3>
                        </div>
                        <div className="catalog-grid">
                            {catalog[activeTab]?.map(category => {
                                const isActive = !enabledCategories[activeTab] || enabledCategories[activeTab].includes(category.id);
                                
                                return (
                                    <div 
                                        key={category.id} 
                                        className={`catalog-item ${isActive ? 'active' : ''}`}
                                        onClick={() => toggleCategory(activeTab, category.id)}
                                    >
                                        <div className="toggle-switch" aria-hidden="true" />
                                        <input 
                                            type="checkbox" 
                                            checked={isActive} 
                                            readOnly
                                            onClick={e => e.stopPropagation()}
                                        />
                                        <div className="catalog-item-info">
                                            <div className="catalog-item-label">
                                                <span className="catalog-item-name">{category.label}</span>
                                                {category.count !== -1 && (
                                                    <span className="catalog-item-count">{category.count} payloads</span>
                                                )}
                                            </div>
                                            <div className="catalog-item-desc">{category.description}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {activeTab === 'MALICIOUS' && (
                        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
                            <a 
                                href="https://waf.secmy.app/" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={{ color: 'var(--accent-light)', fontSize: '0.9rem', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                </svg>
                                More thorough WAF testing at waf.secmy.app
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};
