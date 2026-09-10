// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { sanitizeTargetUrl, normalizeSpecUrl, hasSupportedScheme } from './url.js';

describe('sanitizeTargetUrl utility', () => {
    it('sanitizes full URLs with paths down to scheme + domain', () => {
        expect(sanitizeTargetUrl('https://example.com/swagger.json')).toBe('https://example.com');
        expect(sanitizeTargetUrl('https://example.com/v1/api/docs')).toBe('https://example.com');
        expect(sanitizeTargetUrl('http://127.0.0.1:8788/swagger.json')).toBe('http://127.0.0.1:8788');
        expect(sanitizeTargetUrl('http://localhost:5173/test/path')).toBe('http://localhost:5173');
    });

    it('adds missing scheme and extracts domain', () => {
        expect(sanitizeTargetUrl('example.com/swagger.json')).toBe('https://example.com');
        expect(sanitizeTargetUrl('api.service.io/graphql')).toBe('https://api.service.io');
        expect(sanitizeTargetUrl('localhost:8788/swagger.json')).toBe('http://localhost:8788');
        expect(sanitizeTargetUrl('127.0.0.1:8787/api')).toBe('http://127.0.0.1:8787');
    });

    // ws:// and grpc:// used to fall into the "no scheme" branch, so a WebSocket
    // target became https://ws and the fuzzer was pointed at a host called "ws".
    it('keeps non-HTTP target schemes and trims them to the origin', () => {
        expect(sanitizeTargetUrl('ws://localhost:50052/ws')).toBe('ws://localhost:50052');
        expect(sanitizeTargetUrl('wss://api.example.com/socket')).toBe('wss://api.example.com');
        expect(sanitizeTargetUrl('grpc://localhost:50051')).toBe('grpc://localhost:50051');
        expect(sanitizeTargetUrl('grpcs://api.example.com:443')).toBe('grpcs://api.example.com:443');
    });

    it('handles empty or whitespace input gracefully', () => {
        expect(sanitizeTargetUrl('')).toBe('');
        expect(sanitizeTargetUrl('   ')).toBe('');
    });

    describe('normalizeSpecUrl', () => {
        it('leaves supported schemes untouched', () => {
            expect(normalizeSpecUrl('ws://api.example.com/socket')).toBe('ws://api.example.com/socket');
            expect(normalizeSpecUrl('grpcs://api.example.com:443')).toBe('grpcs://api.example.com:443');
            expect(normalizeSpecUrl('https://example.com/swagger.json')).toBe('https://example.com/swagger.json');
        });

        it('defaults to https when no scheme is present', () => {
            expect(normalizeSpecUrl('example.com/swagger.json')).toBe('https://example.com/swagger.json');
        });

        it('leaves localhost alone so a plain host:port keeps working', () => {
            expect(normalizeSpecUrl('localhost:8788/swagger.json')).toBe('localhost:8788/swagger.json');
        });
    });

    describe('hasSupportedScheme', () => {
        it('recognises every scheme the engine targets', () => {
            for (const u of ['http://a', 'https://a', 'ws://a', 'wss://a', 'grpc://a', 'grpcs://a']) {
                expect(hasSupportedScheme(u)).toBe(true);
            }
            expect(hasSupportedScheme('example.com')).toBe(false);
            expect(hasSupportedScheme('ftp://example.com')).toBe(false);
        });
    });
});
