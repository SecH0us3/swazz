import React, { useState, useEffect } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { stripJSONC } from '../../utils/jsonc.js';

export function RawConfigTab() {
    const { config, importConfig, exportConfig } = useConfig();

    const [rawConfigText, setRawConfigText] = useState('');
    const [rawConfigError, setRawConfigError] = useState('');
    const [isSavingRaw, setIsSavingRaw] = useState(false);
    const [saveRawSuccess, setSaveRawSuccess] = useState(false);

    // Sync rawConfigText when config changes
    useEffect(() => {
        setRawConfigText(exportConfig());
        setRawConfigError('');
    }, [config, exportConfig]);

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
                Raw JSON Configuration
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                View or modify the raw JSON configuration for this project. Validates schema format before saving.
            </p>
            
            <textarea
                className="textarea"
                value={rawConfigText}
                onChange={(e) => {
                    setRawConfigText(e.target.value);
                    try {
                        JSON.parse(stripJSONC(e.target.value));
                        setRawConfigError('');
                    } catch (err: any) {
                        setRawConfigError(`Invalid JSON: ${err.message}`);
                    }
                }}
                style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    minHeight: '400px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px',
                    width: '100%',
                    resize: 'vertical'
                }}
                spellCheck={false}
            />
            
            {rawConfigError && (
                <div style={{
                    color: 'var(--color-error)',
                    fontSize: '13px',
                    backgroundColor: 'rgba(244, 63, 94, 0.08)',
                    border: '1px solid rgba(244, 63, 94, 0.2)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)'
                }}>
                    {rawConfigError}
                </div>
            )}

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!rawConfigError || isSavingRaw}
                    onClick={() => {
                        setIsSavingRaw(true);
                        setSaveRawSuccess(false);
                        try {
                            importConfig(rawConfigText);
                            setSaveRawSuccess(true);
                            setTimeout(() => setSaveRawSuccess(false), 3000);
                        } catch (err: any) {
                            setRawConfigError(err.message || 'Validation failed');
                        } finally {
                            setIsSavingRaw(false);
                        }
                    }}
                >
                    {isSavingRaw ? 'Saving...' : 'Save Configuration'}
                </button>
                {saveRawSuccess && (
                    <span style={{ color: 'var(--color-success)', fontSize: '13px' }}>✓ Configuration updated successfully</span>
                )}
            </div>
        </div>
    );
}
