import { describe, it, expect } from 'vitest';
import SwazzScope from './scope.js';

describe('SwazzScope module', () => {
    describe('stripPort', () => {
        it('strips standard ports', () => {
            expect(SwazzScope.stripPort('example.com:8080')).toBe('example.com');
            expect(SwazzScope.stripPort('localhost:3000')).toBe('localhost');
            expect(SwazzScope.stripPort('api.dev:443')).toBe('api.dev');
        });

        it('handles hosts without port', () => {
            expect(SwazzScope.stripPort('example.com')).toBe('example.com');
            expect(SwazzScope.stripPort('localhost')).toBe('localhost');
        });

        it('handles IPv6 bracket form correctly', () => {
            expect(SwazzScope.stripPort('[::1]:8080')).toBe('[::1]');
            expect(SwazzScope.stripPort('[2001:db8::1]:443')).toBe('[2001:db8::1]');
            expect(SwazzScope.stripPort('[::1]')).toBe('[::1]');
        });

        it('handles empty and whitespace input', () => {
            expect(SwazzScope.stripPort('')).toBe('');
            expect(SwazzScope.stripPort('   ')).toBe('');
            expect(SwazzScope.stripPort(null)).toBe('');
            expect(SwazzScope.stripPort(undefined)).toBe('');
        });
    });

    describe('isDomainTargeted', () => {
        const scope = ['example.com', 'localhost:8080', '[::1]:5000'];

        it('matches exact host', () => {
            expect(SwazzScope.isDomainTargeted('example.com', scope)).toBe(true);
        });

        it('matches subdomain of targeted domain', () => {
            expect(SwazzScope.isDomainTargeted('api.example.com', scope)).toBe(true);
            expect(SwazzScope.isDomainTargeted('v1.api.example.com', scope)).toBe(true);
        });

        it('strips port when matching', () => {
            expect(SwazzScope.isDomainTargeted('example.com:443', scope)).toBe(true);
            expect(SwazzScope.isDomainTargeted('localhost:8080', scope)).toBe(true);
            expect(SwazzScope.isDomainTargeted('localhost:9999', scope)).toBe(true);
        });

        it('handles IPv6 bracket form', () => {
            expect(SwazzScope.isDomainTargeted('[::1]', scope)).toBe(true);
            expect(SwazzScope.isDomainTargeted('[::1]:5000', scope)).toBe(true);
            expect(SwazzScope.isDomainTargeted('[::1]:9999', scope)).toBe(true);
        });

        it('returns false when scope is empty or null', () => {
            expect(SwazzScope.isDomainTargeted('example.com', [])).toBe(false);
            expect(SwazzScope.isDomainTargeted('example.com', null)).toBe(false);
            expect(SwazzScope.isDomainTargeted('example.com', undefined)).toBe(false);
        });

        it('prevents substring spoofing (evil-example.com must NOT match example.com)', () => {
            expect(SwazzScope.isDomainTargeted('evil-example.com', ['example.com'])).toBe(false);
            expect(SwazzScope.isDomainTargeted('notexample.com', ['example.com'])).toBe(false);
            expect(SwazzScope.isDomainTargeted('example.com.attacker.com', ['example.com'])).toBe(false);
            expect(SwazzScope.isDomainTargeted('myexample.com', ['example.com'])).toBe(false);
        });
    });
});

describe('targets pasted as URLs', () => {
    // Users copy what is in the address bar. "http://localhost:8080" used to
    // reduce to "http" and match nothing, silently capturing no traffic.
    it.each([
        ['http://localhost:8080', 'localhost:8080'],
        ['https://api.example.com/v1/users?a=1', 'api.example.com'],
        ['HTTPS://API.Example.COM', 'api.example.com'],
        ['api.example.com', 'sub.api.example.com'],
        ['user:pw@host.tld:443', 'host.tld']
    ])('matches host for target %s', (target, host) => {
        expect(SwazzScope.isDomainTargeted(host, [target])).toBe(true);
    });

    it('still refuses a lookalike domain', () => {
        expect(SwazzScope.isDomainTargeted('evil-example.com', ['http://example.com'])).toBe(false);
    });

    it('keeps IPv6 hosts intact', () => {
        expect(SwazzScope.stripPort('[::1]:8788')).toBe('[::1]');
    });
});
