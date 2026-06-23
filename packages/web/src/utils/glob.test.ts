import { describe, it, expect } from 'vitest';
import { matchesPattern } from './glob.js';

describe('glob matching utility', () => {
    it('should match exact paths case-insensitively', () => {
        expect(matchesPattern('GET', '/api/admin', ['/api/admin'])).toBe(true);
        expect(matchesPattern('GET', '/API/ADMIN', ['/api/admin'])).toBe(true);
        expect(matchesPattern('GET', '/api/admin', ['/API/ADMIN'])).toBe(true);
        expect(matchesPattern('GET', '/api/users', ['/api/admin'])).toBe(false);
    });

    it('should match single-segment wildcards (*)', () => {
        expect(matchesPattern('GET', '/api/v1/users', ['/api/*/users'])).toBe(true);
        expect(matchesPattern('GET', '/api/V1/USERS', ['/api/*/users'])).toBe(true);
        expect(matchesPattern('GET', '/api/v1/sub/users', ['/api/*/users'])).toBe(false);
    });

    it('should match cross-segment wildcards (**)', () => {
        expect(matchesPattern('GET', '/api/admin/users/123', ['/api/admin/**'])).toBe(true);
        expect(matchesPattern('GET', '/API/ADMIN/USERS/123', ['/api/admin/**'])).toBe(true);
        expect(matchesPattern('GET', '/api/users/123', ['/api/admin/**'])).toBe(false);
    });

    it('should match method prefixes', () => {
        expect(matchesPattern('GET', '/api/admin', ['GET /api/admin'])).toBe(true);
        expect(matchesPattern('GET', '/API/ADMIN', ['GET /api/admin'])).toBe(true);
        expect(matchesPattern('POST', '/api/admin', ['GET /api/admin'])).toBe(false);
    });

    it('should match any patterns in the list', () => {
        const patterns = ['/api/users', '/api/admin/**'];
        expect(matchesPattern('GET', '/api/users', patterns)).toBe(true);
        expect(matchesPattern('GET', '/api/admin/roles', patterns)).toBe(true);
        expect(matchesPattern('GET', '/api/health', patterns)).toBe(false);
    });

    it('should match method prefixes case-insensitively', () => {
        expect(matchesPattern('GET', '/api/admin', ['get /api/admin'])).toBe(true);
        expect(matchesPattern('POST', '/api/admin', ['post /api/admin'])).toBe(true);
    });

    it('should escape literal question mark characters', () => {
        expect(matchesPattern('GET', '/api/search?q=test', ['/api/search?q=test'])).toBe(true);
    });
});
