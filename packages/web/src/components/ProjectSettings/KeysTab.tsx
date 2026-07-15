import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useEncryption } from '../../hooks/useEncryption.js';

export function KeysTab() {
    const activeProject = useAppStore(state => state.activeProject);
    
    const {
        getPublicKeyBase64,
        exportAsJwk,
        mnemonic,
        hasKeyPair,
        importFromMnemonic,
        importFromJwk
    } = useEncryption(activeProject?.id);

    const [publicKeyBase64, setPublicKeyBase64] = useState<string | null>(null);
    const [revealMnemonic, setRevealMnemonic] = useState(false);
    
    const [isRestoring, setIsRestoring] = useState(false);
    const [restoreMode, setRestoreMode] = useState<'mnemonic' | 'file'>('mnemonic');
    const [restoreMnemonicPhrase, setRestoreMnemonicPhrase] = useState('');
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (hasKeyPair) {
            getPublicKeyBase64().then(setPublicKeyBase64);
        } else {
            setPublicKeyBase64(null);
        }
    }, [hasKeyPair, getPublicKeyBase64]);

    const handleRestoreMnemonic = async (e: React.FormEvent) => {
        e.preventDefault();
        setRestoreError(null);
        setIsProcessing(true);
        try {
            await importFromMnemonic(restoreMnemonicPhrase);
            setIsRestoring(false);
            setRestoreMnemonicPhrase('');
        } catch (err: any) {
            setRestoreError(err.message || 'Failed to restore key pair from mnemonic.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setRestoreError(null);
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target?.result as string;
                const jwk = JSON.parse(text);
                await importFromJwk(jwk);
                setIsRestoring(false);
            } catch (err: any) {
                setRestoreError(err.message || 'Failed to parse or import backup file. Ensure it is a valid .swazzkey file.');
            }
        };
        reader.readAsText(file);
    };

    const handleDownloadBackup = async () => {
        if (!activeProject) return;
        try {
            const jwk = await exportAsJwk();
            if (!jwk) return;
            const blob = new Blob([JSON.stringify(jwk, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.swazzkey`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to download backup:', err);
        }
    };

    if (!activeProject) return null;

    return (
        <div className="card e2ee-card-container">
            <div className="e2ee-header e2ee-card-body">
                <h2 className="e2ee-title">Encryption & Keys</h2>
                <p className="e2ee-description">
                    Manage client-side encryption keys for <strong>{activeProject.name}</strong>.
                    Swazz uses zero-knowledge End-to-End Encryption (E2EE) to protect scan reports.
                </p>
            </div>

            <div className="e2ee-card-body">
                <div>
                    <label className="e2ee-label">Project Public Key (X25519)</label>
                    <input 
                        type="text" 
                        className="input e2ee-mono-input" 
                        value={publicKeyBase64 || 'No public key generated'} 
                        readOnly
                    />
                    <span className="form-help-text e2ee-margin-top-sm">
                        This public key is stored on the edge coordinator so runners can encrypt reports for this project.
                    </span>
                </div>

                <div className="e2ee-sub-section">
                    <h3>Mnemonic Seed Phrase</h3>
                    <p className="e2ee-description e2ee-margin-top-sm">
                        Use this 12-word mnemonic seed phrase to restore your private key on a new device. Keep it secret!
                    </p>

                    {revealMnemonic ? (
                        <div className="e2ee-margin-top-md">
                            {mnemonic ? (
                                <div className="mnemonic-grid">
                                    {mnemonic.split(' ').map((word, idx) => (
                                        <div key={idx} className="mnemonic-word-badge">
                                            <span className="mnemonic-word-index">{idx + 1}</span>
                                            <span>{word}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="alert alert-info">
                                    Key pair imported via backup file; mnemonic phrase is not available.
                                </div>
                            )}
                            <button 
                                className="btn btn-ghost e2ee-margin-top-md" 
                                onClick={() => setRevealMnemonic(false)}
                            >
                                Hide Seed Phrase
                            </button>
                        </div>
                    ) : (
                        <button 
                            className="btn btn-ghost e2ee-margin-top-md" 
                            onClick={() => setRevealMnemonic(true)}
                        >
                            Reveal 12-Word Seed Phrase
                        </button>
                    )}
                </div>

                <div className="e2ee-sub-section">
                    <h3>Backup File</h3>
                    <p className="e2ee-description e2ee-margin-top-sm">
                        Download the project key pair as a <code>.swazzkey</code> backup file (JWK format) for quick restoration.
                    </p>
                    <button className="btn btn-ghost e2ee-margin-top-md" onClick={handleDownloadBackup}>
                        Download .swazzkey File
                    </button>
                </div>

                <div className="e2ee-sub-section">
                    <h3>Restore / Import Key</h3>
                    <p className="e2ee-description e2ee-margin-top-sm">
                        Need to restore your private key on this device? Import a 12-word seed phrase or upload a <code>.swazzkey</code> backup file to replace the current project key pair.
                    </p>
                    {isRestoring ? (
                        <div className="e2ee-margin-top-md">
                            <div className="e2ee-tabs">
                                <button 
                                    className={`e2ee-tab-btn ${restoreMode === 'mnemonic' ? 'active' : ''}`}
                                    onClick={() => setRestoreMode('mnemonic')}
                                >
                                    Use Mnemonic
                                </button>
                                <button 
                                    className={`e2ee-tab-btn ${restoreMode === 'file' ? 'active' : ''}`}
                                    onClick={() => setRestoreMode('file')}
                                >
                                    Use Backup File
                                </button>
                            </div>
                            
                            {restoreMode === 'mnemonic' ? (
                                <form onSubmit={handleRestoreMnemonic} className="e2ee-margin-top-md">
                                    <textarea
                                        className="textarea"
                                        placeholder="Enter your 12-word mnemonic seed phrase, separated by spaces..."
                                        value={restoreMnemonicPhrase}
                                        onChange={(e) => setRestoreMnemonicPhrase(e.target.value)}
                                        rows={3}
                                    />
                                    {restoreError && <div className="alert alert-danger e2ee-margin-top-sm">{restoreError}</div>}
                                    <div className="e2ee-margin-top-md e2ee-flex-row" style={{ display: 'flex', gap: '8px' }}>
                                        <button type="submit" className="btn btn-primary" disabled={isProcessing}>
                                            {isProcessing ? 'Importing...' : 'Import'}
                                        </button>
                                        <button type="button" className="btn btn-ghost" onClick={() => setIsRestoring(false)}>
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <div className="e2ee-margin-top-md">
                                    <div className="file-upload-container">
                                        <input 
                                            type="file" 
                                            accept=".swazzkey,application/json" 
                                            onChange={handleRestoreFile}
                                            id="swazzkey-upload-input"
                                            className="file-upload-input"
                                        />
                                        <label htmlFor="swazzkey-upload-input" className="file-upload-label">
                                            <span>📁 Choose .swazzkey file</span>
                                        </label>
                                    </div>
                                    {restoreError && <div className="alert alert-danger e2ee-margin-top-sm">{restoreError}</div>}
                                    <button 
                                        type="button" 
                                        className="btn btn-ghost e2ee-margin-top-md" 
                                        onClick={() => setIsRestoring(false)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <button className="btn btn-ghost e2ee-margin-top-md" onClick={() => setIsRestoring(true)}>
                            Restore from Backup / Mnemonic
                        </button>
                    )}
                </div>

                <div className="e2ee-sub-section e2ee-text-center">
                    Read the <a href="/docs/encryption_backup" target="_blank" className="e2ee-link">Key Backup & Recovery guide</a> to learn more.
                </div>
            </div>
        </div>
    );
}
