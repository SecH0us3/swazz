import { useState, useCallback, useEffect, useRef } from 'react';
import { WORDLIST } from '../utils/wordlist.js';

// ─── Constants ──────────────────────────────────────────
const DB_NAME = 'swazz_security';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_PRIVATE = 'private_key';
const KEY_PUBLIC = 'public_key';

// ─── Key Storage Helper ─────────────────────────────────

class KeyStorage {
    private static async getDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    static async saveKey(id: string, key: CryptoKey, projectId?: string): Promise<void> {
        const db = await this.getDB();
        const storeKey = projectId ? `${id}_${projectId}` : id;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(key, storeKey);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    static async getKey(id: string, projectId?: string): Promise<CryptoKey | null> {
        const db = await this.getDB();
        const storeKey = projectId ? `${id}_${projectId}` : id;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(storeKey);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    static async saveMnemonic(mnemonic: string, projectId?: string): Promise<void> {
        const db = await this.getDB();
        const storeKey = projectId ? `mnemonic_${projectId}` : 'mnemonic';
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(mnemonic, storeKey);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    static async getMnemonic(projectId?: string): Promise<string | null> {
        const db = await this.getDB();
        const storeKey = projectId ? `mnemonic_${projectId}` : 'mnemonic';
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(storeKey);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    static async clear(): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    static async deleteKeys(projectId?: string): Promise<void> {
        const db = await this.getDB();
        const privKey = projectId ? `private_key_${projectId}` : 'private_key';
        const pubKey = projectId ? `public_key_${projectId}` : 'public_key';
        const mnemonicKey = projectId ? `mnemonic_${projectId}` : 'mnemonic';

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete(privKey);
            store.delete(pubKey);
            store.delete(mnemonicKey);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

// ─── Types ──────────────────────────────────────────────
export interface EncryptionKeyPair {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
}

export interface UseEncryptionReturn {
    /** Whether the browser supports X25519 key exchange */
    isSupported: boolean;
    /** Whether support detection is still in progress */
    isLoading: boolean;
    /** Whether a key pair currently exists */
    hasKeyPair: boolean;
    /** Generate a new X25519 key pair, generate mnemonic and persist */
    generateKeyPair: () => Promise<void>;
    /** Get the public key encoded as a URL-safe Base64 string (raw bytes) */
    getPublicKeyBase64: () => Promise<string | null>;
    /** Decrypt an encrypted runner result using the stored private key */
    decryptResult: (encryptedData: ArrayBuffer, ephemeralPublicKey: ArrayBuffer) => Promise<ArrayBuffer>;
    /** Upload the public key to the user profile via PUT /api/users/me/public-key */
    uploadPublicKey: (token: string) => Promise<void>;
    /** Error message if the last operation failed */
    error: string | null;

    // Project E2EE Key Backup & Recovery fields
    mnemonic: string | null;
    importFromMnemonic: (mnemonic: string) => Promise<void>;
    importFromJwk: (jwk: JsonWebKey) => Promise<void>;
    exportAsJwk: () => Promise<JsonWebKey | null>;
}

// ─── Helpers ────────────────────────────────────────────

/** Convert an ArrayBuffer to a URL-safe Base64 string */
function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/** Convert a URL-safe Base64 string back to an ArrayBuffer */
function base64ToBuffer(base64: string): ArrayBuffer {
    const standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standardBase64 + '='.repeat((4 - (standardBase64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/** Check whether the browser supports X25519 via crypto.subtle */
async function checkX25519Support(): Promise<boolean> {
    try {
        const testKeyPair = await crypto.subtle.generateKey(
            { name: 'X25519' },
            false,
            ['deriveBits'],
        );
        return testKeyPair != null;
    } catch {
        return false;
    }
}

/** Derive a shared secret from our private key and the peer's public key, then derive AES-GCM key */
async function deriveDecryptionKey(
    privateKey: CryptoKey,
    ephemeralPublicKey: CryptoKey,
): Promise<CryptoKey> {
    const sharedBits = await crypto.subtle.deriveBits(
        {
            name: 'X25519',
            public: ephemeralPublicKey,
        } as any,
        privateKey,
        256,
    );

    const hkdfKey = await crypto.subtle.importKey(
        'raw',
        sharedBits,
        'HKDF',
        false,
        ['deriveKey'],
    );

    const aesKey = await crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(32),
            info: new TextEncoder().encode('swazz-runner-encryption-v1'),
        },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
    );

    return aesKey;
}

/** Generate a random 12-word mnemonic phrase from our wordlist with standard BIP-39 checksum */
async function generateMnemonic(): Promise<string> {
    const entropy = new Uint8Array(16);
    crypto.getRandomValues(entropy);

    const hashBuffer = await crypto.subtle.digest('SHA-256', entropy);
    const hashArray = new Uint8Array(hashBuffer);
    const checksum = hashArray[0] >> 4;

    let binary = '';
    for (let i = 0; i < entropy.length; i++) {
        binary += entropy[i].toString(2).padStart(8, '0');
    }
    binary += checksum.toString(2).padStart(4, '0');

    const words: string[] = [];
    for (let i = 0; i < binary.length; i += 11) {
        const chunk = binary.slice(i, i + 11);
        words.push(WORDLIST[parseInt(chunk, 2)]);
    }
    return words.join(' ');
}

/** Validate standard BIP-39 checksum for a 12-word mnemonic phrase */
async function validateMnemonicChecksum(mnemonic: string): Promise<boolean> {
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12) return false;

    let binary = '';
    for (const word of words) {
        const index = WORDLIST.indexOf(word);
        if (index === -1) return false;
        binary += index.toString(2).padStart(11, '0');
    }

    const entropyBinary = binary.slice(0, 128);
    const checksumBinary = binary.slice(128);

    const entropyBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        entropyBytes[i] = parseInt(entropyBinary.slice(i * 8, (i + 1) * 8), 2);
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', entropyBytes);
    const hashArray = new Uint8Array(hashBuffer);
    const calculatedChecksum = hashArray[0] >> 4;

    return parseInt(checksumBinary, 2) === calculatedChecksum;
}

/** Derive X25519 key pair from a mnemonic seed phrase */
async function deriveKeyFromMnemonic(mnemonic: string): Promise<EncryptionKeyPair> {
    const encoder = new TextEncoder();
    const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(normalized),
        'PBKDF2',
        false,
        ['deriveBits'],
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encoder.encode('mnemonic'),
            iterations: 2048,
            hash: 'SHA-256',
        },
        baseKey,
        256,
    );

    const pkcs8 = new Uint8Array(48);
    pkcs8.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20], 0);
    pkcs8.set(new Uint8Array(derivedBits), 16);

    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8.buffer,
        { name: 'X25519' },
        true,
        ['deriveBits'],
    );

    const jwk = await crypto.subtle.exportKey('jwk', privateKey);

    const publicKey = await crypto.subtle.importKey(
        'jwk',
        {
            kty: 'OKP',
            crv: 'X25519',
            x: jwk.x,
            ext: true,
        },
        { name: 'X25519' },
        true,
        [],
    );

    return { publicKey, privateKey };
}

// ─── Hook ───────────────────────────────────────────────

export function useEncryption(projectId?: string): UseEncryptionReturn {
    const [isSupported, setIsSupported] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [hasKeyPair, setHasKeyPair] = useState(false);
    const [mnemonic, setMnemonic] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const keyPairRef = useRef<EncryptionKeyPair | null>(null);

    // Restore persisted keys on mount & detect support
    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setError(null);
        setHasKeyPair(false);
        setMnemonic(null);
        keyPairRef.current = null;

        (async () => {
            const supported = await checkX25519Support();
            if (cancelled) return;
            setIsSupported(supported);

            if (!supported) {
                setIsLoading(false);
                return;
            }

            try {
                const privateKey = await KeyStorage.getKey(KEY_PRIVATE, projectId);
                const publicKey = await KeyStorage.getKey(KEY_PUBLIC, projectId);
                const savedMnemonic = await KeyStorage.getMnemonic(projectId);

                if (privateKey && publicKey) {
                    if (!cancelled) {
                        keyPairRef.current = { publicKey, privateKey };
                        setHasKeyPair(true);
                        setMnemonic(savedMnemonic || null);
                    }
                } else {
                    if (!cancelled) {
                        const mnemonicPhrase = await generateMnemonic();
                        const keys = await deriveKeyFromMnemonic(mnemonicPhrase);
                        await KeyStorage.saveKey(KEY_PRIVATE, keys.privateKey, projectId);
                        await KeyStorage.saveKey(KEY_PUBLIC, keys.publicKey, projectId);
                        await KeyStorage.saveMnemonic(mnemonicPhrase, projectId);

                        keyPairRef.current = keys;
                        setHasKeyPair(true);
                        setMnemonic(mnemonicPhrase);
                    }
                }
            } catch (err) {
                await KeyStorage.deleteKeys(projectId);
                if (!cancelled) {
                    setError('Failed to restore encryption keys — please regenerate.');
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [projectId]);

    const generateKeyPair = useCallback(async () => {
        setError(null);

        if (!isSupported) {
            setError('X25519 is not supported in this browser.');
            return;
        }

        try {
            const mnemonicPhrase = await generateMnemonic();
            const keyPair = await deriveKeyFromMnemonic(mnemonicPhrase);

            await KeyStorage.saveKey(KEY_PRIVATE, keyPair.privateKey, projectId);
            await KeyStorage.saveKey(KEY_PUBLIC, keyPair.publicKey, projectId);
            await KeyStorage.saveMnemonic(mnemonicPhrase, projectId);

            keyPairRef.current = keyPair;
            setHasKeyPair(true);
            setMnemonic(mnemonicPhrase);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Key generation failed';
            setError(msg);
            throw err;
        }
    }, [isSupported, projectId]);

    const importFromMnemonic = useCallback(async (mnemonicPhrase: string) => {
        setError(null);
        if (!isSupported) {
            const msg = 'X25519 is not supported in this browser.';
            setError(msg);
            throw new Error(msg);
        }

        const words = mnemonicPhrase.trim().split(/\s+/);
        if (words.length !== 12) {
            throw new Error('Mnemonic phrase must be exactly 12 words.');
        }

        const invalidWords = words.filter(word => !WORDLIST.includes(word.toLowerCase()));
        if (invalidWords.length > 0) {
            throw new Error('Mnemonic contains invalid words: ' + invalidWords.join(', '));
        }

        const isValidChecksum = await validateMnemonicChecksum(mnemonicPhrase);
        if (!isValidChecksum) {
            throw new Error('Invalid mnemonic checksum (verify word order/spelling).');
        }

        try {
            const keyPair = await deriveKeyFromMnemonic(mnemonicPhrase);

            await KeyStorage.saveKey(KEY_PRIVATE, keyPair.privateKey, projectId);
            await KeyStorage.saveKey(KEY_PUBLIC, keyPair.publicKey, projectId);
            await KeyStorage.saveMnemonic(mnemonicPhrase, projectId);

            keyPairRef.current = keyPair;
            setHasKeyPair(true);
            setMnemonic(mnemonicPhrase);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to import from mnemonic';
            setError(msg);
            throw err;
        }
    }, [isSupported, projectId]);

    const importFromJwk = useCallback(async (jwk: JsonWebKey) => {
        setError(null);
        if (!isSupported) {
            const msg = 'X25519 is not supported in this browser.';
            setError(msg);
            throw new Error(msg);
        }

        if (!jwk || typeof jwk.d !== 'string') {
            const msg = 'Invalid backup file: private key component (d) is missing or invalid.';
            setError(msg);
            throw new TypeError(msg);
        }

        try {
            const privateKey = await crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'X25519' },
                true,
                ['deriveBits']
            );

            const publicKey = await crypto.subtle.importKey(
                'jwk',
                {
                    kty: 'OKP',
                    crv: 'X25519',
                    x: jwk.x,
                    ext: true
                },
                { name: 'X25519' },
                true,
                []
            );

            await KeyStorage.saveKey(KEY_PRIVATE, privateKey, projectId);
            await KeyStorage.saveKey(KEY_PUBLIC, publicKey, projectId);
            await KeyStorage.saveMnemonic('', projectId); // Clear/no mnemonic for direct JWK

            keyPairRef.current = { publicKey, privateKey };
            setHasKeyPair(true);
            setMnemonic(null);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to import backup file';
            setError(msg);
            throw err;
        }
    }, [isSupported, projectId]);

    const exportAsJwk = useCallback(async (): Promise<JsonWebKey | null> => {
        if (!keyPairRef.current) return null;
        try {
            return await crypto.subtle.exportKey('jwk', keyPairRef.current.privateKey);
        } catch (err) {
            console.error('Failed to export key:', err);
            return null;
        }
    }, []);

    // ── Get public key as Base64 ──
    const getPublicKeyBase64 = useCallback(async (): Promise<string | null> => {
        if (!keyPairRef.current) return null;

        try {
            const rawPublic = await crypto.subtle.exportKey('raw', keyPairRef.current.publicKey);
            return bufferToBase64(rawPublic);
        } catch {
            return null;
        }
    }, []);

    // ── Decrypt an encrypted result ──
    const decryptResult = useCallback(
        async (encryptedData: ArrayBuffer, ephemeralPublicKeyRaw: ArrayBuffer): Promise<ArrayBuffer> => {
            if (!keyPairRef.current) {
                throw new Error('No encryption key pair available. Generate keys first.');
            }

            const ephemeralPublicKey = await crypto.subtle.importKey(
                'raw',
                ephemeralPublicKeyRaw,
                { name: 'X25519' },
                false,
                [],
            );

            const aesKey = await deriveDecryptionKey(keyPairRef.current.privateKey, ephemeralPublicKey);

            if (encryptedData.byteLength < 12) {
                throw new Error('Encrypted data is too short (minimum 12 bytes for IV)');
            }

            const iv = encryptedData.slice(0, 12);
            const ciphertext = encryptedData.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: new Uint8Array(iv) },
                aesKey,
                ciphertext,
            );

            return decrypted;
        },
        [],
    );

    // ── Upload public key to user profile ──
    const uploadPublicKey = useCallback(async (token: string): Promise<void> => {
        setError(null);

        const publicKeyB64 = await getPublicKeyBase64();
        if (!publicKeyB64) {
            setError('No public key available. Generate keys first.');
            return;
        }

        try {
            const res = await fetch('/api/users/me/public-key', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ public_key: publicKeyB64 }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Upload failed (${res.status})`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to upload public key';
            setError(msg);
            throw err;
        }
    }, [getPublicKeyBase64]);

    return {
        isSupported,
        isLoading,
        hasKeyPair,
        generateKeyPair,
        getPublicKeyBase64,
        decryptResult,
        uploadPublicKey,
        error,
        mnemonic,
        importFromMnemonic,
        importFromJwk,
        exportAsJwk,
    };
}

export { bufferToBase64, base64ToBuffer, checkX25519Support, KeyStorage, KEY_PRIVATE, KEY_PUBLIC, generateMnemonic, deriveKeyFromMnemonic, validateMnemonicChecksum };
