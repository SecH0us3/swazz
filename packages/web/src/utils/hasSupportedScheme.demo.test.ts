// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { hasSupportedScheme } from './url.js';

describe('hasSupportedScheme', () => {
    it('accepts http and https', () => {
        expect(hasSupportedScheme('http://example.com')).toBe(true);
        expect(hasSupportedScheme('https://example.com')).toBe(true);
    });

    it('accepts ws/wss/grpc/grpcs schemes', () => {
        for (const u of ['ws://h', 'wss://h', 'grpc://h', 'grpcs://h']) {
            expect(hasSupportedScheme(u)).toBe(true);
        }
    });

    it('is case-insensitive and trims whitespace', () => {
        expect(hasSupportedScheme('  HTTPS://Example.com ')).toBe(true);
    });

    it('rejects a bare host or an unsupported scheme', () => {
        expect(hasSupportedScheme('example.com')).toBe(false);
        expect(hasSupportedScheme('ftp://example.com')).toBe(false);
    });
});
