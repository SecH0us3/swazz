/**
 * Unit tests for SmartPayloadGenerator.
 */
import { describe, it, expect } from 'vitest';
import { SmartPayloadGenerator } from '../src/generator.js';
import type { SchemaProperty } from '../src/types.js';

const stringSchema: SchemaProperty = { type: 'string' };
const intSchema: SchemaProperty = { type: 'integer' };
const numberSchema: SchemaProperty = { type: 'number' };
const boolSchema: SchemaProperty = { type: 'boolean' };
const emailSchema: SchemaProperty = { type: 'string', format: 'email' };
const uuidSchema: SchemaProperty = { type: 'string', format: 'uuid' };
const dateSchema: SchemaProperty = { type: 'string', format: 'date-time' };
const enumSchema: SchemaProperty = { enum: ['a', 'b', 'c'] };

// ─── Enum always wins ────────────────────────────────────────

describe('SmartPayloadGenerator.generate — enum', () => {
    it('always returns a value from enum regardless of profile', () => {
        for (const profile of ['RANDOM', 'BOUNDARY', 'MALICIOUS'] as const) {
            const gen = new SmartPayloadGenerator({}, profile);
            for (let i = 0; i < 30; i++) {
                const v = gen.generate('status', enumSchema);
                expect(['a', 'b', 'c']).toContain(v);
            }
        }
    });
});

// ─── Dictionary overrides ────────────────────────────────────

describe('SmartPayloadGenerator.generate — dictionary', () => {
    it('uses dictionary values when key matches', () => {
        const gen = new SmartPayloadGenerator({ username: ['alice', 'bob', 'carol'] }, 'RANDOM');
        for (let i = 0; i < 20; i++) {
            const v = gen.generate('username', stringSchema);
            expect(['alice', 'bob', 'carol']).toContain(v);
        }
    });

    it('dictionary lookup is case-insensitive (key normalised to lower)', () => {
        const gen = new SmartPayloadGenerator({ UserName: ['alice'] }, 'RANDOM');
        expect(gen.generate('username', stringSchema)).toBe('alice');
        expect(gen.generate('USERNAME', stringSchema)).toBe('alice');
    });
});

// ─── RANDOM profile ──────────────────────────────────────────

describe('SmartPayloadGenerator — RANDOM profile', () => {
    const gen = new SmartPayloadGenerator({}, 'RANDOM');

    it('generates a string for string type', () => {
        expect(typeof gen.generate('name', stringSchema)).toBe('string');
    });

    it('generates a number for integer type', () => {
        const v = gen.generate('count', intSchema);
        expect(typeof v).toBe('number');
        expect(Number.isInteger(v)).toBe(true);
    });

    it('generates a number for number type', () => {
        expect(typeof gen.generate('price', numberSchema)).toBe('number');
    });

    it('generates a boolean for boolean type', () => {
        expect(typeof gen.generate('active', boolSchema)).toBe('boolean');
    });

    it('generates valid email for format: email', () => {
        const v = gen.generate('email', emailSchema);
        expect(v).toMatch(/@/);
    });

    it('generates UUID-like string for format: uuid', () => {
        const v = gen.generate('id', uuidSchema);
        expect(v).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('generates ISO date string for format: date-time', () => {
        const v = gen.generate('createdAt', dateSchema);
        expect(() => new Date(v)).not.toThrow();
        expect(new Date(v).toISOString()).toBe(v);
    });
});

// ─── BOUNDARY profile ────────────────────────────────────────

describe('SmartPayloadGenerator — BOUNDARY profile', () => {
    const gen = new SmartPayloadGenerator({}, 'BOUNDARY');

    it('generates a string', () => {
        expect(typeof gen.generate('x', stringSchema)).toBe('string');
    });

    it('generates boundary integers from known list (and they are numbers)', () => {
        const v = gen.generate('count', intSchema);
        expect(typeof v).toBe('number');
    });

    it('generates a boolean', () => {
        expect(typeof gen.generate('flag', boolSchema)).toBe('boolean');
    });
});

// ─── MALICIOUS profile ───────────────────────────────────────

describe('SmartPayloadGenerator — MALICIOUS profile', () => {
    const gen = new SmartPayloadGenerator({}, 'MALICIOUS');

    it('generates a value for string type (may be any type due to type confusion)', () => {
        // Just verify it doesn't throw
        expect(() => gen.generate('input', stringSchema)).not.toThrow();
    });

    it('generates a value for integer type', () => {
        expect(() => gen.generate('count', intSchema)).not.toThrow();
    });

    it('generates various boolean confusion values', () => {
        for (let i = 0; i < 30; i++) {
            expect(() => gen.generate('active', boolSchema)).not.toThrow();
        }
    });
});

// ─── buildObject ─────────────────────────────────────────────

describe('SmartPayloadGenerator.buildObject', () => {
    const gen = new SmartPayloadGenerator({}, 'RANDOM');

    it('builds an object from simple schema', () => {
        const schema: SchemaProperty = {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'integer' },
                active: { type: 'boolean' },
            },
        };
        const obj = gen.buildObject(schema);
        expect(typeof obj.name).toBe('string');
        expect(typeof obj.age).toBe('number');
        expect(typeof obj.active).toBe('boolean');
    });

    it('handles nested object', () => {
        const schema: SchemaProperty = {
            type: 'object',
            properties: {
                address: {
                    type: 'object',
                    properties: {
                        street: { type: 'string' },
                        zip: { type: 'string' },
                    },
                },
            },
        };
        const obj = gen.buildObject(schema);
        expect(typeof obj.address).toBe('object');
        expect(typeof obj.address.street).toBe('string');
    });

    it('handles array property', () => {
        const schema: SchemaProperty = {
            type: 'object',
            properties: {
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                },
            },
        };
        const obj = gen.buildObject(schema);
        expect(Array.isArray(obj.tags)).toBe(true);
        for (const tag of obj.tags as any[]) expect(typeof tag).toBe('string');
    });

    it('returns empty object for non-object schema', () => {
        expect(gen.buildObject({ type: 'string' })).toEqual({});
    });
});
