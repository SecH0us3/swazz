import React from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { ChainingRulesEditor } from '../Sidebar/ChainingRulesEditor.js';

export function ChainingTab() {
    const { config, updateSettings } = useConfig();

    return (
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
            <div className="alert-banner alert-info">
                <div className="alert-banner-header">Совет</div>
                <div className="alert-banner-message">
                    Попроси ИИ ассистента помочь составить конфиг для CI/CD — это будет проще.
                </div>
            </div>
            <ChainingRulesEditor 
                rules={config.settings.chaining_rules || []} 
                onChange={(rules) => updateSettings({ chaining_rules: rules })} 
            />
        </div>
    );
}
