// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 *
 * Real-crypto coverage for useEncryption.decryptResult. Isolated from
 * useEncryption.test.ts (which mocks crypto) so this file exercises the genuine
 * X25519 + HKDF + AES-GCM path and its boundary errors. Requires a runtime with
 * native X25519 WebCrypto (Node 20+), which the CI uses.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { useEncryption } from './useEncryption.js';

function b64urlToBytes(b64url: string): Uint8Array {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((b64url.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Sender side: encrypt `plaintext` to the recipient's raw X25519 public key,
 *  mirroring deriveDecryptionKey (HKDF salt=32 zero bytes, info tag, AES-GCM). */
async function encryptTo(recipientPublicRaw: Uint8Array, plaintext: Uint8Array) {
    const recipientPublic = await crypto.subtle.importKey('raw', recipientPublicRaw as BufferSource, { name: 'X25519' } as any, false, []);
    const ephemeral = await crypto.subtle.generateKey({ name: 'X25519' } as any, true, ['deriveBits']) as CryptoKeyPair;
    const sharedBits = await crypto.subtle.deriveBits({ name: 'X25519', public: recipientPublic } as any, ephemeral.privateKey, 256);
    const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('swazz-runner-encryption-v1') },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext as BufferSource));
    const packed = new Uint8Array(iv.length + ct.length);
    packed.set(iv, 0);
    packed.set(ct, iv.length);
    const ephemeralPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
    return { packed, ephemeralPublicRaw };
}

async function mountReady() {
    const hook = renderHook(() => useEncryption('decrypt-test-project'));
    await waitFor(() => expect(hook.result.current.isSupported).toBe(true), { timeout: 4000 });
    await waitFor(() => expect(hook.result.current.getPublicKeyBase64).toBeTypeOf('function'));
    let pub: string | null = null;
    await act(async () => { pub = await hook.result.current.getPublicKeyBase64(); });
    await waitFor(() => expect(pub).toBeTruthy(), { timeout: 4000 });
    return { hook, pub: pub! };
}

describe('useEncryption.decryptResult (real crypto)', () => {
    beforeEach(() => {
        // Fresh IndexedDB per test so key state does not leak between cases.
        (globalThis as any).indexedDB = new IDBFactory();
        vi.restoreAllMocks();
    });

    it('round-trips a message encrypted to the generated public key', async () => {
        const { hook, pub } = await mountReady();
        const message = new TextEncoder().encode('top-secret-finding');
        const { packed, ephemeralPublicRaw } = await encryptTo(b64urlToBytes(pub), message);

        let out: ArrayBuffer | undefined;
        await act(async () => {
            out = await hook.result.current.decryptResult(packed.buffer as ArrayBuffer, ephemeralPublicRaw.buffer as ArrayBuffer);
        });
        expect(Array.from(new Uint8Array(out!))).toEqual(Array.from(message));
    });

    it('rejects when the encrypted data is shorter than the 12-byte IV', async () => {
        const { hook, pub } = await mountReady();
        // A valid ephemeral key so the length guard (after key agreement) is reached.
        const { ephemeralPublicRaw } = await encryptTo(b64urlToBytes(pub), new Uint8Array([1]));
        await expect(
            hook.result.current.decryptResult(new Uint8Array(8).buffer as ArrayBuffer, ephemeralPublicRaw.buffer as ArrayBuffer)
        ).rejects.toThrow(/too short/i);
    });

    it('rejects a corrupted ciphertext (AES-GCM auth failure)', async () => {
        const { hook, pub } = await mountReady();
        const { packed, ephemeralPublicRaw } = await encryptTo(b64urlToBytes(pub), new TextEncoder().encode('tamper me'));
        packed[packed.length - 1] ^= 0xff; // flip a ciphertext byte
        await expect(
            hook.result.current.decryptResult(packed.buffer as ArrayBuffer, ephemeralPublicRaw.buffer as ArrayBuffer)
        ).rejects.toThrow();
    });
});
