import React from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { KVEditor } from '../Sidebar/Shared.js';

export function WordlistsTab() {
    const { config, updateConfig } = useConfig();

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
    );
}
