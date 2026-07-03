import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    useEncryption,
    bufferToBase64,
    base64ToBuffer,
    KeyStorage,
    KEY_PRIVATE,
    KEY_PUBLIC,
    generateMnemonic,
    deriveKeyFromMnemonic,
    validateMnemonicChecksum
} from './useEncryption.js';

// ─── Helper tests ───────────────────────────────────────

describe('bufferToBase64 / base64ToBuffer', () => {
    it('should round-trip an ArrayBuffer through Base64', () => {
        const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
        const b64 = bufferToBase64(original.buffer);
        const restored = new Uint8Array(base64ToBuffer(b64));
        expect(restored).toEqual(original);
    });

    it('should produce URL-safe Base64 (no +, /, or =)', () => {
        const data = new Uint8Array([251, 239, 190]);
        const b64 = bufferToBase64(data.buffer);
        expect(b64).not.toContain('+');
        expect(b64).not.toContain('/');
        expect(b64).not.toContain('=');
    });

    it('should handle empty buffer', () => {
        const empty = new Uint8Array(0);
        const b64 = bufferToBase64(empty.buffer);
        expect(b64).toBe('');
        const restored = new Uint8Array(base64ToBuffer(b64));
        expect(restored.length).toBe(0);
    });
});

describe('Mnemonic helpers', () => {
    it('should generate a 12-word mnemonic with valid checksum', async () => {
        const mnemonic = await generateMnemonic();
        expect(mnemonic.split(' ').length).toBe(12);
        const isValid = await validateMnemonicChecksum(mnemonic);
        expect(isValid).toBe(true);
    });

    it('should derive X25519 key pair from mnemonic', async () => {
        const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
        const pair = await deriveKeyFromMnemonic(mnemonic);
        expect(pair.publicKey).toBeDefined();
        expect(pair.privateKey).toBeDefined();
    });

    it('should fail checksum validation for invalid word order or typo', async () => {
        const invalidMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
        const isValid = await validateMnemonicChecksum(invalidMnemonic);
        expect(isValid).toBe(false);
    });
});

// ─── Hook tests ─────────────────────────────────────────

describe('useEncryption', () => {
    beforeEach(async () => {
        await KeyStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('when X25519 is NOT supported', () => {
        beforeEach(() => {
            const realGenerateKey = crypto.subtle.generateKey.bind(crypto.subtle);
            vi.spyOn(crypto.subtle, 'generateKey').mockImplementation(
                (algorithm: any, ...args: any[]) => {
                    if (algorithm === 'X25519' || algorithm?.name === 'X25519') {
                        return Promise.reject(new DOMException('Not supported', 'NotSupportedError'));
                    }
                    return (realGenerateKey as any)(algorithm, ...args);
                },
            );
        });

        it('should detect unsupported browser and set isSupported=false', async () => {
            const { result } = renderHook(() => useEncryption());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.isSupported).toBe(false);
            expect(result.current.hasKeyPair).toBe(false);
        });

        it('should set error when trying to generate keys', async () => {
            const { result } = renderHook(() => useEncryption());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                try {
                    await result.current.generateKeyPair();
                } catch {
                    // expected
                }
            });

            expect(result.current.error).toBe('X25519 is not supported in this browser.');
            expect(result.current.hasKeyPair).toBe(false);
        });
    });

    describe('when X25519 IS supported', () => {
        const mockPublicJwk = {
            kty: 'OKP',
            crv: 'X25519',
            x: 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo',
        };
        const mockPrivateJwk = {
            kty: 'OKP',
            crv: 'X25519',
            x: 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo',
            d: 'dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo',
        };

        const mockPublicKey = { type: 'public', algorithm: { name: 'X25519' } } as unknown as CryptoKey;
        const mockPrivateKey = { type: 'private', algorithm: { name: 'X25519' } } as unknown as CryptoKey;

        beforeEach(() => {
            // Mock generateKey to succeed for X25519
            vi.spyOn(crypto.subtle, 'generateKey').mockResolvedValue({
                publicKey: mockPublicKey,
                privateKey: mockPrivateKey,
            } as CryptoKeyPair);

            // Mock exportKey with pass-through for PBKDF2/HKDF keys if any
            const realExportKey = crypto.subtle.exportKey.bind(crypto.subtle);
            vi.spyOn(crypto.subtle, 'exportKey').mockImplementation(
                async (format: string, key: CryptoKey) => {
                    if (format === 'jwk' && (key as any).type !== 'private' && (key as any).type !== 'public') {
                        return realExportKey(format, key);
                    }
                    if (format === 'jwk') {
                        return ((key as any).type === 'public' ? mockPublicJwk : mockPrivateJwk) as JsonWebKey;
                    }
                    if (format === 'raw') {
                        return new Uint8Array(32).buffer;
                    }
                    throw new Error('Unsupported format');
                },
            );

            // Mock importKey with pass-through for PBKDF2/HKDF
            const realImportKey = crypto.subtle.importKey.bind(crypto.subtle);
            vi.spyOn(crypto.subtle, 'importKey').mockImplementation(
                async (format: any, keyData: any, algorithm: any, extractable: boolean, keyUsages: any) => {
                    const algName = typeof algorithm === 'string' ? algorithm : algorithm?.name;
                    if (algName === 'PBKDF2' || algName === 'HKDF') {
                        return realImportKey(format, keyData, algorithm, extractable, keyUsages);
                    }
                    if (format === 'jwk') {
                        const isPublic = !keyData.d;
                        return isPublic ? mockPublicKey : mockPrivateKey;
                    }
                    if (format === 'pkcs8') {
                        return mockPrivateKey;
                    }
                    return mockPublicKey;
                },
            );

            // Mock deriveBits with pass-through for PBKDF2/HKDF
            const realDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
            vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(
                async (algorithm: any, baseKey: CryptoKey, length: any) => {
                    const algName = typeof algorithm === 'string' ? algorithm : algorithm?.name;
                    if (algName === 'PBKDF2' || algName === 'HKDF') {
                        return realDeriveBits(algorithm, baseKey, length);
                    }
                    return new Uint8Array(32).buffer;
                }
            );
        });

        it('should detect X25519 support and start with no key pair', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.isSupported).toBe(true);
            expect(result.current.hasKeyPair).toBe(false);
            expect(result.current.error).toBeNull();
        });

        it('should generate and persist a key pair with mnemonic', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                await result.current.generateKeyPair();
            });

            expect(result.current.hasKeyPair).toBe(true);
            expect(result.current.mnemonic).toBeDefined();
            expect(result.current.mnemonic?.split(' ').length).toBe(12);
            expect(result.current.error).toBeNull();

            // Verify persistence to KeyStorage
            const privateKey = await KeyStorage.getKey(KEY_PRIVATE, 'proj_123');
            const publicKey = await KeyStorage.getKey(KEY_PUBLIC, 'proj_123');
            const mnemonic = await KeyStorage.getMnemonic('proj_123');
            expect(privateKey).toEqual(mockPrivateKey);
            expect(publicKey).toEqual(mockPublicKey);
            expect(mnemonic).toBe(result.current.mnemonic);
        });

        it('should restore keys from KeyStorage on mount scoped to project', async () => {
            // Pre-populate KeyStorage for proj_123
            await KeyStorage.saveKey(KEY_PRIVATE, mockPrivateKey, 'proj_123');
            await KeyStorage.saveKey(KEY_PUBLIC, mockPublicKey, 'proj_123');
            await KeyStorage.saveMnemonic('test mnemonic phrase', 'proj_123');

            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.isSupported).toBe(true);
            expect(result.current.hasKeyPair).toBe(true);
            expect(result.current.mnemonic).toBe('test mnemonic phrase');
        });

        it('should return Base64-encoded public key', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                await result.current.generateKeyPair();
            });

            let publicKeyB64: string | null = null;
            await act(async () => {
                publicKeyB64 = await result.current.getPublicKeyBase64();
            });

            expect(publicKeyB64).not.toBeNull();
            expect(typeof publicKeyB64).toBe('string');
        });

        it('should import from 12-word mnemonic phrase', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
            await act(async () => {
                await result.current.importFromMnemonic(testMnemonic);
            });

            expect(result.current.hasKeyPair).toBe(true);
            expect(result.current.mnemonic).toBe(testMnemonic);
            expect(result.current.error).toBeNull();
        });

        it('should throw error for invalid mnemonic length', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await expect(
                act(async () => {
                    await result.current.importFromMnemonic('abandon abandon');
                })
            ).rejects.toThrow('Mnemonic phrase must be exactly 12 words.');
        });

        it('should throw error for invalid words in mnemonic', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await expect(
                act(async () => {
                    await result.current.importFromMnemonic(
                        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon xyz123'
                    );
                })
            ).rejects.toThrow('Mnemonic contains invalid words: xyz123');
        });

        it('should throw error for invalid mnemonic checksum', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await expect(
                act(async () => {
                    await result.current.importFromMnemonic(
                        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
                    );
                })
            ).rejects.toThrow('Invalid mnemonic checksum (verify word order/spelling).');
        });

        it('should import and export JWK', async () => {
            const { result } = renderHook(() => useEncryption('proj_123'));

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                await result.current.importFromJwk(mockPrivateJwk);
            });

            expect(result.current.hasKeyPair).toBe(true);
            expect(result.current.mnemonic).toBeNull();

            let exportedJwk: JsonWebKey | null = null;
            await act(async () => {
                exportedJwk = await result.current.exportAsJwk();
            });

            expect(exportedJwk).toEqual(mockPrivateJwk);
        });

        describe('uploadPublicKey', () => {
            beforeEach(() => {
                vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                    new Response(JSON.stringify({ ok: true }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }),
                );
            });

            it('should PUT the public key to /api/users/me/public-key', async () => {
                const { result } = renderHook(() => useEncryption('proj_123'));

                await waitFor(() => {
                    expect(result.current.isLoading).toBe(false);
                });

                await act(async () => {
                    await result.current.generateKeyPair();
                });

                await act(async () => {
                    await result.current.uploadPublicKey('test-jwt-token');
                });

                expect(fetch).toHaveBeenCalledWith(
                    '/api/users/me/public-key',
                    expect.objectContaining({
                        method: 'PUT',
                        headers: expect.objectContaining({
                            'Authorization': 'Bearer test-jwt-token',
                            'Content-Type': 'application/json',
                        }),
                    }),
                );

                expect(result.current.error).toBeNull();
            });
        });
    });
});
