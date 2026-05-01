import { describe, it, expect } from 'vitest';
import * as rand from '../src/random.js';

describe('random utilities', () => {
    it('next() returns a number between 0 and 1', () => {
        for (let i = 0; i < 100; i++) {
            const val = rand.next();
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThan(1);
        }
    });

    it('pick() returns an element from array', () => {
        const arr = [1, 2, 3, 4, 5];
        const val = rand.pick(arr);
        expect(arr).toContain(val);
    });

    it('pick() throws on empty array', () => {
        expect(() => rand.pick([])).toThrow('Cannot pick from empty array');
    });

    it('int() returns integer within range', () => {
        const min = 5;
        const max = 10;
        for (let i = 0; i < 100; i++) {
            const val = rand.int(min, max);
            expect(Number.isInteger(val)).toBe(true);
            expect(val).toBeGreaterThanOrEqual(min);
            expect(val).toBeLessThanOrEqual(max);
        }
    });

    it('float() returns float within range', () => {
        const min = 5.5;
        const max = 10.5;
        for (let i = 0; i < 100; i++) {
            const val = rand.float(min, max);
            expect(val).toBeGreaterThanOrEqual(min);
            expect(val).toBeLessThan(max);
        }
    });

    it('bool() returns boolean', () => {
        const val = rand.bool();
        expect(typeof val).toBe('boolean');
    });

    it('date() returns date within range', () => {
        const from = new Date('2020-01-01');
        const to = new Date('2020-12-31');
        const val = rand.date(from, to);
        expect(val).toBeInstanceOf(Date);
        expect(val.getTime()).toBeGreaterThanOrEqual(from.getTime());
        expect(val.getTime()).toBeLessThanOrEqual(to.getTime());
    });

    it('uuid() returns a valid UUID v4 format', () => {
        const val = rand.uuid();
        expect(val).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('randomString() returns string of correct length', () => {
        const length = 15;
        const val = rand.randomString(length);
        expect(val).toHaveLength(length);
        expect(val).toMatch(/^[a-zA-Z0-9]+$/);
    });
});
