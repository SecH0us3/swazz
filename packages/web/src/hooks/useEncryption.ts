import { useState, useCallback, useEffect, useRef } from 'react';

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

    static async saveKey(id: string, key: CryptoKey): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(key, id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    static async getKey(id: string): Promise<CryptoKey | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(id);
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
    /** Whether a key pair currently exists (in memory + localStorage) */
    hasKeyPair: boolean;
    /** Generate a new X25519 key pair and persist to localStorage as JWK */
    generateKeyPair: () => Promise<void>;
    /** Get the public key encoded as a URL-safe Base64 string (raw bytes) */
    getPublicKeyBase64: () => Promise<string | null>;
    /** Decrypt an encrypted runner result using the stored private key */
    decryptResult: (encryptedData: ArrayBuffer, ephemeralPublicKey: ArrayBuffer) => Promise<ArrayBuffer>;
    /** Upload the public key to the user profile via PUT /api/users/me/public-key */
    uploadPublicKey: (token: string) => Promise<void>;
    /** Error message if the last operation failed */
    error: string | null;
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
    // Restore standard base64 from URL-safe variant
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
            'X25519' as any,
            false,
            ['deriveBits'],
        );
        // If we get here, X25519 is supported
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
    // Derive raw shared secret via X25519 ECDH
    const sharedBits = await crypto.subtle.deriveBits(
        {
            name: 'X25519',
            public: ephemeralPublicKey,
        } as any,
        privateKey,
        256,
    );

    // Import the shared secret as HKDF key material
    const hkdfKey = await crypto.subtle.importKey(
        'raw',
        sharedBits,
        'HKDF',
        false,
        ['deriveKey'],
    );

    // Derive AES-256-GCM key via HKDF
    const aesKey = await crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(32), // zero salt — the ephemeral key provides uniqueness
            info: new TextEncoder().encode('swazz-runner-encryption-v1'),
        },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
    );

    return aesKey;
}

// ─── Hook ───────────────────────────────────────────────

export function useEncryption(): UseEncryptionReturn {
    const [isSupported, setIsSupported] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [hasKeyPair, setHasKeyPair] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Keep the in-memory key pair in a ref to avoid re-renders on every key access
    const keyPairRef = useRef<EncryptionKeyPair | null>(null);

    // ── Restore persisted keys on mount & detect support ──
    useEffect(() => {
        let cancelled = false;

        (async () => {
            const supported = await checkX25519Support();
            if (cancelled) return;
            setIsSupported(supported);

            if (!supported) {
                setIsLoading(false);
                return;
            }

            // Try to restore from KeyStorage (IndexedDB)
            try {
                const privateKey = await KeyStorage.getKey(KEY_PRIVATE);
                const publicKey = await KeyStorage.getKey(KEY_PUBLIC);

                if (privateKey && publicKey) {
                    if (!cancelled) {
                        keyPairRef.current = { publicKey, privateKey };
                        setHasKeyPair(true);
                    }
                }
            } catch (err) {
                // Corrupted keys in DB
                await KeyStorage.clear();
                if (!cancelled) {
                    setError('Failed to restore encryption keys — please regenerate.');
                }
            }

            if (!cancelled) {
                setIsLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, []);

    // ── Generate a new key pair ──
    const generateKeyPair = useCallback(async () => {
        setError(null);

        if (!isSupported) {
            setError('X25519 is not supported in this browser.');
            return;
        }

        try {
            const keyPair = await crypto.subtle.generateKey(
                'X25519' as any,
                true, // Keep extractable for public key export and derivation
                ['deriveBits'],
            ) as CryptoKeyPair;

            // Persist CryptoKey objects directly to IndexedDB
            await KeyStorage.saveKey(KEY_PRIVATE, keyPair.privateKey);
            await KeyStorage.saveKey(KEY_PUBLIC, keyPair.publicKey);

            keyPairRef.current = {
                publicKey: keyPair.publicKey,
                privateKey: keyPair.privateKey,
            };
            setHasKeyPair(true);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Key generation failed';
            setError(msg);
        }
    }, [isSupported]);

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

            // Import the ephemeral public key from raw bytes
            const ephemeralPublicKey = await crypto.subtle.importKey(
                'raw',
                ephemeralPublicKeyRaw,
                'X25519' as any,
                false,
                [],
            );

            // Derive the AES-GCM decryption key
            const aesKey = await deriveDecryptionKey(keyPairRef.current.privateKey, ephemeralPublicKey);

            if (encryptedData.byteLength < 12) {
                throw new Error('Encrypted data is too short (minimum 12 bytes for IV)');
            }

            // The encrypted data format: [12-byte IV] [ciphertext+tag]
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
    };
}

// Re-export helpers for testing
export { bufferToBase64, base64ToBuffer, checkX25519Support, KeyStorage, KEY_PRIVATE, KEY_PUBLIC };
