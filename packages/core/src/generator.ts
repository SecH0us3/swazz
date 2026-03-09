/**
 * SmartPayloadGenerator — generates payloads based on JSON Schema
 * and the selected fuzzing profile (RANDOM / BOUNDARY / MALICIOUS).
 */

import type { Dictionary, FuzzingProfile, SchemaProperty } from './types.js';
import * as rand from './random.js';
import {
    BOUNDARY_STRINGS,
    BOUNDARY_INTEGERS,
    BOUNDARY_NUMBERS,
    BOUNDARY_DATES,
    BOUNDARY_ARRAY_SIZES,
} from './payloads/boundary.js';
import {
    ALL_MALICIOUS_STRINGS,
    MALICIOUS_NUMBERS,
    MALICIOUS_DATES,
    MALICIOUS_BOOLEANS,
    MALICIOUS_TYPE_CONFUSION,
} from './payloads/malicious.js';

export class SmartPayloadGenerator {
    private dictionaries: Dictionary;
    private profile: FuzzingProfile;

    constructor(dictionaries: Dictionary = {}, profile: FuzzingProfile = 'RANDOM') {
        // Normalize dictionary keys to lowercase
        this.dictionaries = Object.keys(dictionaries).reduce((acc, key) => {
            acc[key.toLowerCase()] = dictionaries[key];
            return acc;
        }, {} as Dictionary);
        this.profile = profile;
    }

    /**
     * Generate a value for a single property.
     * Priority: enum → dictionary → format-aware → profile-based
     */
    public generate(propertyName: string, schema: SchemaProperty): any {
        // 1. Enum — always respect explicit enum values
        if (schema.enum && schema.enum.length > 0) {
            return rand.pick(schema.enum);
        }

        // 2. User dictionary (highest priority after enum)
        const normalizedName = propertyName.toLowerCase();
        if (this.dictionaries[normalizedName] && this.dictionaries[normalizedName].length > 0) {
            return rand.pick(this.dictionaries[normalizedName]);
        }

        // 3. Profile-based generation
        return this.generateByProfile(schema.type, schema.format, propertyName);
    }

    /**
     * Recursively build a full object from JSON Schema.
     */
    public buildObject(schema: SchemaProperty): Record<string, any> {
        if (schema.type !== 'object' || !schema.properties) return {};

        const payload: Record<string, any> = {};

        for (const [key, propSchema] of Object.entries(schema.properties)) {
            if (propSchema.type === 'object' && propSchema.properties) {
                payload[key] = this.buildObject(propSchema);
            } else if (propSchema.type === 'array' && propSchema.items) {
                const count = this.getArraySize();
                payload[key] = Array.from({ length: count }, () =>
                    propSchema.items!.type === 'object'
                        ? this.buildObject(propSchema.items!)
                        : this.generate(key, propSchema.items!),
                );
            } else {
                payload[key] = this.generate(key, propSchema);
            }
        }

        return payload;
    }

    // ─── Private ────────────────────────────────────────────

    private getArraySize(): number {
        if (this.profile === 'BOUNDARY') {
            return rand.pick(BOUNDARY_ARRAY_SIZES);
        }
        return rand.int(1, 5);
    }

    private generateByProfile(type?: string, format?: string, propName?: string): any {
        // MALICIOUS: 5% chance to completely break the expected type
        if (this.profile === 'MALICIOUS' && Math.random() < 0.05) {
            return this.breakType();
        }

        // Handle format-specific date-time before generic string
        if (type === 'string' && format === 'date-time') {
            return this.generateDate();
        }

        switch (type) {
            case 'string':
                return this.generateString(format, propName);
            case 'integer':
            case 'number':
                return this.generateNumber(type);
            case 'boolean':
                return this.generateBoolean();
            default:
                // Fallback for unknown type — try to guess by name
                if (propName) {
                    const lower = propName.toLowerCase();
                    if (lower.includes('id') || lower.includes('uuid')) return rand.uuid();
                    if (lower.includes('slug') || lower.includes('name')) return rand.word();
                    if (lower.includes('num') || lower.includes('count') || lower.includes('page')) return rand.int(1, 100);
                }
                return rand.randomString(rand.int(3, 10));
        }
    }

    private generateString(format?: string, propName?: string): any {
        // If it's a generic string without format, check name-based heuristics first
        if (!format && propName) {
            const lower = propName.toLowerCase();
            if (lower.includes('id') || lower.includes('uuid')) return rand.uuid();
            if (lower.includes('slug') || lower.includes('name')) return rand.word();
            if (lower.includes('num') || lower.includes('count') || lower.includes('page')) return String(rand.int(1, 100));
        }

        switch (this.profile) {
            case 'BOUNDARY':
                return rand.pick(BOUNDARY_STRINGS);

            case 'MALICIOUS':
                return rand.pick(ALL_MALICIOUS_STRINGS);

            case 'RANDOM':
            default:
                return this.generateRandomString(format);
        }
    }

    private generateRandomString(format?: string): string {
        switch (format) {
            case 'uuid':
                return rand.uuid();
            case 'email':
                return rand.email();
            case 'uri':
            case 'url':
                return rand.uri();
            case 'ipv4':
            case 'ip':
                return rand.ipv4();
            case 'date-time':
                return rand.date().toISOString();
            default:
                return rand.word();
        }
    }

    private generateNumber(type?: string): any {
        switch (this.profile) {
            case 'BOUNDARY':
                return type === 'integer'
                    ? rand.pick(BOUNDARY_INTEGERS)
                    : rand.pick([...BOUNDARY_INTEGERS, ...BOUNDARY_NUMBERS]);

            case 'MALICIOUS':
                return rand.pick(MALICIOUS_NUMBERS);

            case 'RANDOM':
            default:
                return type === 'integer'
                    ? rand.int(1, 1000)
                    : rand.float(0, 1000);
        }
    }

    private generateBoolean(): any {
        switch (this.profile) {
            case 'MALICIOUS':
                return rand.pick(MALICIOUS_BOOLEANS);

            case 'BOUNDARY':
            case 'RANDOM':
            default:
                return rand.bool();
        }
    }

    private generateDate(): any {
        switch (this.profile) {
            case 'BOUNDARY':
                return rand.pick(BOUNDARY_DATES);

            case 'MALICIOUS':
                return rand.pick(MALICIOUS_DATES);

            case 'RANDOM':
            default:
                return rand.date().toISOString();
        }
    }

    /** MALICIOUS: intentionally return wrong type to test strict typing */
    private breakType(): any {
        return rand.pick(MALICIOUS_TYPE_CONFUSION);
    }
}
