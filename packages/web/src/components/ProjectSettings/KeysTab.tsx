import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useEncryption } from '../../hooks/useEncryption.js';

export function KeysTab() {
    const activeProject = useAppStore(state => state.activeProject);
    
    const {
        getPublicKeyBase64,
        exportAsJwk,
        mnemonic,
        hasKeyPair
    } = useEncryption(activeProject?.id);

    const [publicKeyBase64, setPublicKeyBase64] = useState<string | null>(null);
    const [revealMnemonic, setRevealMnemonic] = useState(false);

    useEffect(() => {
        if (hasKeyPair) {
            getPublicKeyBase64().then(setPublicKeyBase64);
        } else {
            setPublicKeyBase64(null);
        }
    }, [hasKeyPair, getPublicKeyBase64]);

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

                <div className="e2ee-sub-section e2ee-text-center">
                    Read the <a href="/docs/encryption_backup" target="_blank" className="e2ee-link">Key Backup & Recovery guide</a> to learn more.
                </div>
            </div>
        </div>
    );
}
