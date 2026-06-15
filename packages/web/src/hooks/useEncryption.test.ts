import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEncryption, bufferToBase64, base64ToBuffer, KeyStorage, KEY_PRIVATE, KEY_PUBLIC } from './useEncryption.js';

// ─── Helper tests ───────────────────────────────────────

describe('bufferToBase64 / base64ToBuffer', () => {
    it('should round-trip an ArrayBuffer through Base64', () => {
        const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
        const b64 = bufferToBase64(original.buffer);
        const restored = new Uint8Array(base64ToBuffer(b64));
        expect(restored).toEqual(original);
    });

    it('should produce URL-safe Base64 (no +, /, or =)', () => {
        // Use bytes that typically produce +, /, and padding in standard base64
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
            // Simulate unsupported X25519 by making generateKey throw
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
                await result.current.generateKeyPair();
            });

            expect(result.current.error).toBe('X25519 is not supported in this browser.');
            expect(result.current.hasKeyPair).toBe(false);
        });
    });

    describe('when X25519 IS supported', () => {
        // These tests will only pass in browsers/runtimes that support X25519.
        // In jsdom (Node), crypto.subtle may not support X25519.
        // We mock the full flow to test hook logic independently.

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

            // Mock exportKey
            vi.spyOn(crypto.subtle, 'exportKey').mockImplementation(
                (format: string, key: CryptoKey) => {
                    if (format === 'jwk') {
                        return Promise.resolve(
                            (key as any).type === 'public' ? mockPublicJwk : mockPrivateJwk,
                        ) as Promise<JsonWebKey>;
                    }
                    if (format === 'raw') {
                        // Return 32 bytes for raw public key
                        return Promise.resolve(new Uint8Array(32).buffer) as Promise<ArrayBuffer>;
                    }
                    return Promise.reject(new Error('Unsupported format'));
                },
            );

            // Mock importKey
            vi.spyOn(crypto.subtle, 'importKey').mockImplementation(
                (format: string, keyData: any) => {
                    if (format === 'jwk') {
                        const isPublic = !keyData.d;
                        return Promise.resolve(isPublic ? mockPublicKey : mockPrivateKey);
                    }
                    // Raw import for ephemeral key
                    return Promise.resolve(mockPublicKey);
                },
            );
        });

        it('should detect X25519 support and start with no key pair', async () => {
            const { result } = renderHook(() => useEncryption());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.isSupported).toBe(true);
            expect(result.current.hasKeyPair).toBe(false);
            expect(result.current.error).toBeNull();
        });

        it('should generate and persist a key pair', async () => {
            const { result } = renderHook(() => useEncryption());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                await result.current.generateKeyPair();
            });

            expect(result.current.hasKeyPair).toBe(true);
            expect(result.current.error).toBeNull();

            // Verify persistence to KeyStorage
            const privateKey = await KeyStorage.getKey(KEY_PRIVATE);
            const publicKey = await KeyStorage.getKey(KEY_PUBLIC);
            expect(privateKey).toEqual(mockPrivateKey);
            expect(publicKey).toEqual(mockPublicKey);
        });

        it('should restore keys from KeyStorage on mount', async () => {
            // Pre-populate KeyStorage
            await KeyStorage.saveKey(KEY_PRIVATE, mockPrivateKey);
            await KeyStorage.saveKey(KEY_PUBLIC, mockPublicKey);

            const { result } = renderHook(() => useEncryption());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.isSupported).toBe(true);
            expect(result.current.hasKeyPair).toBe(true);
        });

        it('should return Base64-encoded public key', async () => {
            const { result } = renderHook(() => useEncryption());

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
            // URL-safe base64 should not contain +, /, or =
            expect(publicKeyB64!).not.toContain('+');
            expect(publicKeyB64!).not.toContain('/');
            expect(publicKeyB64!).not.toContain('=');
        });

        it('should return null from getPublicKeyBase64 when no key pair exists', async () => {
            const { result } = renderHook(() => useEncryption());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            let publicKeyB64: string | null = 'not-null';
            await act(async () => {
                publicKeyB64 = await result.current.getPublicKeyBase64();
            });

            expect(publicKeyB64).toBeNull();
        });

        it('should handle corrupted KeyStorage gracefully', async () => {
            // Force getKey to throw an error
            vi.spyOn(KeyStorage, 'getKey').mockRejectedValue(
                new Error('Database corruption'),
            );
            const clearSpy = vi.spyOn(KeyStorage, 'clear');

            const { result } = renderHook(() => useEncryption());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.hasKeyPair).toBe(false);
            expect(result.current.error).toContain('Failed to restore');
            expect(clearSpy).toHaveBeenCalled();
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
                const { result } = renderHook(() => useEncryption());

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

            it('should set error when upload fails', async () => {
                vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                    new Response(JSON.stringify({ error: 'Unauthorized' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json' },
                    }),
                );

                const { result } = renderHook(() => useEncryption());

                await waitFor(() => {
                    expect(result.current.isLoading).toBe(false);
                });

                await act(async () => {
                    await result.current.generateKeyPair();
                });

                await act(async () => {
                    try {
                        await result.current.uploadPublicKey('bad-token');
                    } catch {
                        // expected
                    }
                });

                expect(result.current.error).toBe('Unauthorized');
            });

            it('should set error when no key pair exists', async () => {
                const { result } = renderHook(() => useEncryption());

                await waitFor(() => {
                    expect(result.current.isLoading).toBe(false);
                });

                await act(async () => {
                    await result.current.uploadPublicKey('test-token');
                });

                expect(result.current.error).toBe('No public key available. Generate keys first.');
            });
        });
    });
});
