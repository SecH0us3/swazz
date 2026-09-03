// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { KeysTab } from './KeysTab.js';
import { useAppStore } from '../../store/appStore.js';
import * as encryptionHook from '../../hooks/useEncryption.js';

describe('KeysTab Component', () => {
    const mockGetPublicKeyBase64 = vi.fn().mockResolvedValue('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...');
    const mockExportAsJwk = vi.fn().mockResolvedValue({ kty: 'RSA', n: 'abc', e: 'AQAB' });
    const mockImportFromMnemonic = vi.fn().mockResolvedValue(undefined);
    const mockImportFromJwk = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            activeProject: { id: 'proj-e2ee-123', name: 'Secure Project', description: '' } as any
        });

        vi.spyOn(encryptionHook, 'useEncryption').mockReturnValue({
            hasKeyPair: true,
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            getPublicKeyBase64: mockGetPublicKeyBase64,
            exportAsJwk: mockExportAsJwk,
            importFromMnemonic: mockImportFromMnemonic,
            importFromJwk: mockImportFromJwk,
            isReady: true,
            isSupported: true,
            publicKey: null,
            privateKey: null,
            encrypt: vi.fn(),
            decrypt: vi.fn(),
            generateKeyPair: vi.fn(),
            clearKeyPair: vi.fn(),
        } as any);
    });

    it('renders public key and allows revealing mnemonic seed phrase', async () => {
        render(<KeysTab />);

        expect(screen.getByText('Encryption & Keys')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByDisplayValue(/MIIBIjANBgkqhki/)).toBeTruthy();
        });

        // Click Reveal Mnemonic
        const revealBtn = screen.getByRole('button', { name: /Reveal 12-Word Seed Phrase/i });
        fireEvent.click(revealBtn);

        expect(screen.getByText('about')).toBeTruthy();

        // Click Hide
        const hideBtn = screen.getByRole('button', { name: /Hide Seed Phrase/i });
        fireEvent.click(hideBtn);

        expect(screen.queryByText('about')).toBeNull();
    });

    it('opens restore form and imports mnemonic', async () => {
        render(<KeysTab />);

        const restoreBtn = screen.getByRole('button', { name: /Restore from Backup \/ Mnemonic/i });
        fireEvent.click(restoreBtn);

        expect(screen.getByText('Use Mnemonic')).toBeTruthy();

        const input = screen.getByPlaceholderText(/Enter your 12-word mnemonic seed phrase/i);
        fireEvent.change(input, { target: { value: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12' } });

        const submitBtn = screen.getByRole('button', { name: 'Import' });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockImportFromMnemonic).toHaveBeenCalledWith('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12');
        });
    });

    it('allows switching restore mode to file backup', async () => {
        render(<KeysTab />);

        const restoreBtn = screen.getByRole('button', { name: /Restore from Backup \/ Mnemonic/i });
        fireEvent.click(restoreBtn);

        // Switch to File mode
        const fileTabBtn = screen.getByRole('button', { name: /Use Backup File/i });
        fireEvent.click(fileTabBtn);

        expect(screen.getByText(/Choose \.swazzkey file/i)).toBeTruthy();

        // Cancel
        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelBtn);
        expect(screen.queryByText(/Choose \.swazzkey file/i)).toBeNull();
    });

    it('handles download backup file', async () => {
        const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/123');
        const revokeObjectURLMock = vi.fn();
        vi.stubGlobal('URL', {
            createObjectURL: createObjectURLMock,
            revokeObjectURL: revokeObjectURLMock
        });

        render(<KeysTab />);

        const downloadBtn = screen.getByRole('button', { name: /Download \.swazzkey File/i });
        fireEvent.click(downloadBtn);

        await waitFor(() => {
            expect(mockExportAsJwk).toHaveBeenCalled();
            expect(createObjectURLMock).toHaveBeenCalled();
        });
    });

    it('handles restore error on mnemonic failure', async () => {
        mockImportFromMnemonic.mockRejectedValueOnce(new Error('Invalid checksum'));

        render(<KeysTab />);
        fireEvent.click(screen.getByRole('button', { name: /Restore from Backup \/ Mnemonic/i }));

        const input = screen.getByPlaceholderText(/Enter your 12-word mnemonic seed phrase/i);
        fireEvent.change(input, { target: { value: 'bad phrase' } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => {
            expect(screen.getByText('Invalid checksum')).toBeTruthy();
        });
    });

    it('renders message when mnemonic is not available', async () => {
        vi.spyOn(encryptionHook, 'useEncryption').mockReturnValue({
            hasKeyPair: true,
            mnemonic: null,
            getPublicKeyBase64: mockGetPublicKeyBase64,
            exportAsJwk: mockExportAsJwk,
            importFromMnemonic: mockImportFromMnemonic,
            importFromJwk: mockImportFromJwk,
            isReady: true,
            isSupported: true,
        } as any);

        render(<KeysTab />);
        fireEvent.click(screen.getByRole('button', { name: /Reveal 12-Word Seed Phrase/i }));

        expect(screen.getByText(/Key pair imported via backup file/i)).toBeTruthy();
    });

    it('returns null if activeProject is not set', () => {
        useAppStore.setState({ activeProject: null });
        const { container } = render(<KeysTab />);
        expect(container.firstChild).toBeNull();
    });
});
