// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { sanitizeTargetUrl } from './url.js';

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

    it('handles empty or whitespace input gracefully', () => {
        expect(sanitizeTargetUrl('')).toBe('');
        expect(sanitizeTargetUrl('   ')).toBe('');
    });
});
