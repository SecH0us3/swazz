import React, { useState, useEffect } from 'react';
import { useConfig } from '../../hooks/useConfig.js';

export function DictionariesTab() {
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
                    Custom Fuzzing Dictionaries
                </h2>
                
                <div className="alert-banner alert-info" style={{ marginTop: '16px' }}>
                    <div className="alert-banner-header">How Dictionaries Work</div>
                    <div className="alert-banner-message">
                        Dictionaries map parameter names (keys) to arrays of custom values. When the fuzzer encounters an API parameter matching a dictionary key, it will inject these specific payloads during scan execution:
                        <ul className="dictionary-help-list">
                            <li className="dictionary-help-item">Provide custom usernames, emails, or IDs to match your application's domain logic.</li>
                            <li className="dictionary-help-item">Fuzzing fields with valid/known inputs improves code path coverage behind authorization walls.</li>
                            <li className="dictionary-help-item">Ensure the dictionary is a single valid JSON object of string arrays.</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="dictionary-textarea-container">
                <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>Dictionaries JSON Configuration</label>
                <textarea
                    className="textarea"
                    value={dictText}
                    onChange={(e) => setDictText(e.target.value)}
                    onBlur={handleDictBlur}
                    placeholder={`{\n  "email": ["test@test.com"],\n  "role": ["admin", "member"]\n}`}
                    spellCheck={false}
                    style={{ width: '100%', minHeight: '220px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
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
