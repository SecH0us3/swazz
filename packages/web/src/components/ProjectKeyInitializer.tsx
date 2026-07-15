import React, { useState, useRef } from 'react';
import { UseEncryptionReturn } from '../hooks/useEncryption.js';

interface ProjectKeyInitializerProps {
    projectName: string;
    onSuccess: () => void;
    onSkip?: () => void;
    encryption: UseEncryptionReturn;
}

export function ProjectKeyInitializer({ projectName, onSuccess, onSkip, encryption }: ProjectKeyInitializerProps) {
    const {
        generateKeyPair,
        importFromMnemonic,
        importFromJwk,
        error: encryptionError,
        mnemonic,
        exportAsJwk
    } = encryption;

    const [mode, setMode] = useState<'options' | 'generate' | 'mnemonic' | 'file'>('options');
    const [mnemonicInput, setMnemonicInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleGenerate = async () => {
        setIsProcessing(true);
        setError(null);
        try {
            await generateKeyPair();
            setMode('generate');
        } catch (err: any) {
            setError(err.message || 'Key generation failed.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleImportMnemonic = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsProcessing(true);
        setError(null);
        try {
            await importFromMnemonic(mnemonicInput);
            onSuccess();
        } catch (err: any) {
            setError(err.message || 'Failed to import from mnemonic.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const target = e.target;
        const file = target.files?.[0];
        if (!file) return;

        setIsProcessing(true);
        setError(null);

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target?.result as string;
                const jwk = JSON.parse(text);
                await importFromJwk(jwk);
                onSuccess();
            } catch (err: any) {
                setError(err.message || 'Invalid backup file format.');
            } finally {
                setIsProcessing(false);
                target.value = '';
            }
        };
        reader.onerror = () => {
            setError('Failed to read file.');
            setIsProcessing(false);
            target.value = '';
        };
        reader.readAsText(file);
    };

    const handleDownloadBackup = async () => {
        try {
            const jwk = await exportAsJwk();
            if (!jwk) return;
            const blob = new Blob([JSON.stringify(jwk, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.swazzkey`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to download backup:', err);
        }
    };

    return (
        <div className="e2ee-container">
            <div className="e2ee-header">
                <h1 className="e2ee-title">Project Key Setup: {projectName}</h1>
                <p className="e2ee-description">
                    Swazz uses zero-knowledge End-to-End Encryption (E2EE) to protect scan reports. 
                    You must initialize or restore the X25519 private key to start fuzzing.
                </p>
            </div>

            {(error || encryptionError) && (
                <div className="alert alert-error e2ee-alert-error">
                    {error || encryptionError}
                </div>
            )}

            {mode === 'options' && (
                <div className="e2ee-options">
                    <div className="e2ee-card">
                        <h3>Option A: Generate New Keypair</h3>
                        <p className="e2ee-guideline">
                            Recommended for new projects. This will generate a fresh keypair and reveal your 12-word mnemonic.
                        </p>
                        <button 
                            className="btn btn-primary e2ee-margin-top-sm" 
                            onClick={handleGenerate}
                            disabled={isProcessing}
                        >
                            {isProcessing ? 'Generating...' : 'Generate Keys'}
                        </button>
                    </div>

                    <div className="e2ee-card">
                        <h3>Option B: Restore from Mnemonic</h3>
                        <p className="e2ee-guideline">
                            Auditing from another device? Enter the 12-word seed phrase generated during project setup.
                        </p>
                        <button 
                            className="btn btn-ghost e2ee-margin-top-sm" 
                            onClick={() => setMode('mnemonic')}
                        >
                            Restore Mnemonic
                        </button>
                    </div>

                    <div className="e2ee-card">
                        <h3>Option C: Upload Backup File</h3>
                        <p className="e2ee-guideline">
                            Restore using a downloaded <code>.swazzkey</code> backup file.
                        </p>
                        <button 
                            className="btn btn-ghost e2ee-margin-top-sm" 
                            onClick={() => setMode('file')}
                        >
                            Upload .swazzkey File
                        </button>
                    </div>

                    <div className="e2ee-guideline e2ee-text-center e2ee-margin-top-sm">
                        Read the <a href="/docs/encryption_backup" target="_blank" className="e2ee-link">Key Backup & Recovery guide</a> to learn more.
                    </div>

                    {onSkip && (
                        <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
                            <button className="btn btn-ghost" onClick={onSkip}>
                                Skip for now
                            </button>
                            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                                You can set this up later when you need to encrypt findings.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {mode === 'generate' && (
                <div>
                    <h3>Setup Successful! 🔑</h3>
                    <p className="e2ee-description e2ee-margin-top-sm">
                        Please save this 12-word seed phrase or download the backup file. Without them, you cannot decrypt findings on a new device.
                    </p>

                    <div className="mnemonic-grid">
                        {mnemonic ? mnemonic.split(' ').map((word, idx) => (
                            <div key={idx} className="mnemonic-word-badge">
                                <span className="mnemonic-word-index">{idx + 1}</span>
                                <span>{word}</span>
                            </div>
                        )) : null}
                    </div>

                    <div className="e2ee-footer e2ee-margin-top-lg">
                        <button className="btn btn-ghost" onClick={handleDownloadBackup}>
                            Download .swazzkey File
                        </button>
                        <button className="btn btn-primary" onClick={onSuccess}>
                            Continue to Workspace
                        </button>
                    </div>
                </div>
            )}

            {mode === 'mnemonic' && (
                <form onSubmit={handleImportMnemonic}>
                    <h3>Restore Mnemonic Phrase</h3>
                    <p className="e2ee-description e2ee-margin-top-sm">
                        Enter the space-separated 12-word seed phrase below.
                    </p>

                    <div className="e2ee-input-group">
                        <textarea
                            className="input e2ee-textarea"
                            placeholder="word1 word2 ... word12"
                            value={mnemonicInput}
                            onChange={(e) => setMnemonicInput(e.target.value)}
                            required
                            data-1p-ignore
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                        />
                    </div>

                    <div className="e2ee-footer e2ee-margin-top-lg">
                        <button type="button" className="btn btn-ghost" onClick={() => setMode('options')}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isProcessing}>
                            {isProcessing ? 'Restoring...' : 'Restore Key'}
                        </button>
                    </div>
                </form>
            )}

            {mode === 'file' && (
                <div>
                    <h3>Upload Backup File</h3>
                    <p className="e2ee-description e2ee-margin-top-sm">
                        Select the <code>.swazzkey</code> backup file containing your project private key.
                    </p>

                    <div 
                        className="e2ee-file-drop e2ee-margin-top-sm" 
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <span>📁 Click to browse `.swazzkey` file</span>
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleFileUpload} 
                            accept=".swazzkey,application/json" 
                            className="hidden-input"
                        />
                    </div>

                    <div className="e2ee-footer e2ee-margin-top-lg">
                        <button className="btn btn-ghost" onClick={() => setMode('options')}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
