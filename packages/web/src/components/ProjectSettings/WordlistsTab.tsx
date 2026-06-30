import React, { useState, useEffect } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { KVEditor } from '../Sidebar/Shared.js';

export function WordlistsTab() {
    const { config, updateConfig } = useConfig();
    const [dictText, setDictText] = useState(JSON.stringify(config.dictionaries || {}, null, 2));
    const [dictError, setDictError] = useState('');

    useEffect(() => {
        setDictText(JSON.stringify(config.dictionaries || {}, null, 2));
    }, [config.dictionaries]);

    const handleDictBlur = () => {
        try {
            const parsed = JSON.parse(dictText);
            updateConfig({ dictionaries: parsed });
            setDictError('');
        } catch {
            setDictError('Invalid JSON format');
        }
    };

    return (
        <div className="card" style={{
            backgroundColor: 'var(--bg-elevated)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
        }}>
            <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
                    Wordlist Files Configuration
                </h2>
                <p style={{ margin: '12px 0 16px 0', fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                    Map custom payload categories to specific wordlist files in the runner's `wordlists/` directory.
                </p>
                <KVEditor
                    entries={config.wordlist_files || {}}
                    onChange={(w) => updateConfig({ wordlist_files: w })}
                    keyPlaceholder="Category (e.g. xss)"
                    valuePlaceholder="Filename (in wordlists/ dir)"
                />
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Custom Fuzzing Dictionaries</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                    Configure custom literal value mapping dictionaries used by the fuzzing engine.
                </p>
                <textarea
                    className="textarea"
                    value={dictText}
                    onChange={(e) => setDictText(e.target.value)}
                    onBlur={handleDictBlur}
                    placeholder={`{\n  "email": ["test@test.com"],\n  ...\n}`}
                    spellCheck={false}
                    style={{ width: '100%', minHeight: '150px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                />
                {dictError && (
                    <div style={{ color: 'var(--color-error)', fontSize: '12px', marginTop: 2 }}>
                        {dictError}
                    </div>
                )}
            </div>
        </div>
    );
}
