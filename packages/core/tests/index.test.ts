import { describe, it, expect } from 'vitest';
import { deepStrip } from '../src/index.js';

describe('deepStrip', () => {
    it('should not truncate strings shorter than maxLen', () => {
        const input = 'hello';
        expect(deepStrip(input, 10)).toBe('hello');
    });

    it('should truncate strings longer than maxLen', () => {
        const input = 'hello world';
        const result = deepStrip(input, 5);
        expect(result).toContain('hello');
        expect(result).toContain('truncated');
        expect(result).toContain('total');
    });

    it('should use default maxLen of 1024', () => {
        const longString = 'a'.repeat(1025);
        const result = deepStrip(longString);
        expect(result).toContain('truncated');
        expect(result.length).toBeGreaterThan(1024);
    });

    it('should recursively truncate strings in an object', () => {
        const input = {
            short: 'hello',
            long: 'this is a very long string'
        };
        const result = deepStrip(input, 10);
        expect(result.short).toBe('hello');
        expect(result.long).toContain('this is a ');
        expect(result.long).toContain('truncated');
    });

    it('should recursively truncate strings in an array', () => {
        const input = ['hello', 'this is a very long string'];
        const result = deepStrip(input, 10);
        expect(result[0]).toBe('hello');
        expect(result[1]).toContain('this is a ');
        expect(result[1]).toContain('truncated');
    });

    it('should handle nested objects and arrays', () => {
        const input = {
            a: [
                { b: 'this is a very long string' },
                'another long string'
            ],
            c: {
                d: 'short'
            }
        };
        const result = deepStrip(input, 10);
        expect(result.a[0].b).toContain('truncated');
        expect(result.a[1]).toContain('truncated');
        expect(result.c.d).toBe('short');
    });

    it('should preserve other types', () => {
        const input = {
            num: 123,
            bool: true,
            nil: null,
            undef: undefined,
            obj: {}
        };
        expect(deepStrip(input)).toEqual(input);
    });

    it('should handle empty objects and arrays', () => {
        expect(deepStrip({})).toEqual({});
        expect(deepStrip([])).toEqual([]);
    });

    it('should show correct KB in truncation message', () => {
        const input = 'a'.repeat(2048);
        const result = deepStrip(input, 1024);
        expect(result).toContain('(2.0KB total)');
    });
});
