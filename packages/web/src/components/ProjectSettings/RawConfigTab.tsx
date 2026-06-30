import React, { useState, useEffect } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { stripJSONC } from '../../utils/jsonc.js';
import { useDb } from '../../hooks/useDb.js';
import { useToast } from '../../hooks/useToast.js';

export function RawConfigTab() {
    const { config, importConfig, exportConfig } = useConfig();
    const { getAllTriaged } = useDb();
    const { showToast } = useToast();

    const [rawConfigText, setRawConfigText] = useState('');
    const [rawConfigError, setRawConfigError] = useState('');
    const [isSavingRaw, setIsSavingRaw] = useState(false);
    const [saveRawSuccess, setSaveRawSuccess] = useState(false);
    const lastSyncedConfigRef = React.useRef('');
    const rawConfigTextRef = React.useRef(rawConfigText);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result as string;
                JSON.parse(stripJSONC(text));
                setRawConfigText(text);
                setRawConfigError('');
            } catch (err: any) {
                setRawConfigError(`Invalid imported JSON: ${err.message}`);
            }
        };
        reader.readAsText(file);
    };

    const handleExportIgnoreRules = async () => {
        const triaged = await getAllTriaged();
        if (triaged.length === 0) {
            showToast('No triaged findings to export.', 'info');
            return;
        }

        const ignoreRules = triaged.map(f => {
            const ruleId = f.analyzerFindings?.[0]?.ruleId || (f.status > 0 ? `swazz/status-${f.status}` : 'swazz/network-error');
            const rule: any = {
                rule_id: ruleId,
                endpoint: f.endpoint,
                method: f.method,
            };
            if (f.payloadPreview && f.payloadPreview.length > 0 && f.payloadPreview.length < 150) {
                let cleanPayload = f.payloadPreview.trim();
                if (cleanPayload.includes('…')) {
                    cleanPayload = cleanPayload.split('…')[0].trim();
                }
                if (!cleanPayload.startsWith('{') && !cleanPayload.startsWith('[')) {
                    if (cleanPayload.startsWith('"') && cleanPayload.endsWith('"')) {
                        try {
                            const parsed = JSON.parse(cleanPayload);
                            if (typeof parsed === 'string') {
                                cleanPayload = parsed;
                            }
                        } catch { /* */ }
                    }
                    if (typeof cleanPayload === 'string' && cleanPayload.trim().length > 0) {
                        rule.payload = cleanPayload;
                    }
                }
            }
            return rule;
        });

        const blob = new Blob([JSON.stringify(ignoreRules, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'swazz.ignore.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Ignore rules exported', 'success');
    };


    useEffect(() => {
        rawConfigTextRef.current = rawConfigText;
    }, [rawConfigText]);

    // Sync rawConfigText when config changes, but only if user hasn't edited it
    useEffect(() => {
        const exported = exportConfig();
        const currentText = rawConfigTextRef.current;
        if (currentText === lastSyncedConfigRef.current || currentText === '') {
            setRawConfigText(exported);
            lastSyncedConfigRef.current = exported;
            setRawConfigError('');
        }
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

            <div className="raw-config-actions-bar">
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

                <div className="raw-config-actions-right">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.yaml,.yml,.har"
                        style={{ display: 'none' }}
                        onChange={handleImportFile}
                    />
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="16"/>
                        </svg>
                        Import File
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                            const json = exportConfig();
                            const blob = new Blob([json], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'swazz.config.json';
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Export File
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={handleExportIgnoreRules}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <line x1="9" y1="9" x2="15" y2="15"/>
                            <line x1="15" y1="9" x2="9" y2="15"/>
                        </svg>
                        Export Ignore Rules
                    </button>
                </div>

            </div>

        </div>
    );
}
