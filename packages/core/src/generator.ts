/**
 * SmartPayloadGenerator — generates payloads based on JSON Schema
 * and the selected fuzzing profile (RANDOM / BOUNDARY / MALICIOUS).
 *
 * BOUNDARY and MALICIOUS profiles use sequential iteration through their
 * payload arrays to guarantee full coverage. RANDOM uses true randomness.
 */

import type { Dictionary, FuzzingProfile, SchemaProperty } from './types.js';
import * as rand from './random.js';
import {
    BOUNDARY_STRINGS,
    BOUNDARY_INTEGERS,
    BOUNDARY_NUMBERS,
    BOUNDARY_DATES,
    BOUNDARY_BOOLEANS,
    BOUNDARY_ARRAY_SIZES,
} from './payloads/boundary.js';
import {
    ALL_MALICIOUS_STRINGS,
    MALICIOUS_NUMBERS,
    MALICIOUS_DATES,
    MALICIOUS_BOOLEANS,
    MALICIOUS_TYPE_CONFUSION,
} from './payloads/malicious.js';

// ─── Sequential counter key types ──────────────────────────

type BoundaryCounter = '_bStrIdx' | '_bIntIdx' | '_bNumIdx' | '_bDateIdx' | '_bArrIdx' | '_bBoolIdx';
type MaliciousCounter = '_mStrIdx' | '_mNumIdx' | '_mDateIdx' | '_mBoolIdx' | '_mTypeIdx';
type SeqCounter = BoundaryCounter | MaliciousCounter;

export class SmartPayloadGenerator {
    private dictionaries: Dictionary;
    private profile: FuzzingProfile;

    // ─── Sequential counters: BOUNDARY ──────────────────────
    private _bStrIdx = 0;
    private _bIntIdx = 0;
    private _bNumIdx = 0;
    private _bDateIdx = 0;
    private _bArrIdx = 0;
    private _bBoolIdx = 0;

    // ─── Sequential counters: MALICIOUS ─────────────────────
    private _mStrIdx = 0;
    private _mNumIdx = 0;
    private _mDateIdx = 0;
    private _mBoolIdx = 0;
    private _mTypeIdx = 0;

    constructor(dictionaries: Dictionary = {}, profile: FuzzingProfile = 'RANDOM') {
        // Normalize dictionary keys to lowercase
        this.dictionaries = Object.keys(dictionaries).reduce((acc, key) => {
            acc[key.toLowerCase()] = dictionaries[key];
            return acc;
        }, {} as Dictionary);
        this.profile = profile;
    }

    // ─── Static helpers ────────────────────────────────────

    /**
     * Minimum iterations needed to cover every payload in the given profile.
     * Returns 0 for RANDOM (no fixed set to exhaust).
     */
    public static minIterationsNeeded(profile: FuzzingProfile): number {
        switch (profile) {
            case 'BOUNDARY':
                return Math.max(
                    BOUNDARY_STRINGS.length,
                    BOUNDARY_INTEGERS.length,
                    BOUNDARY_NUMBERS.length,
                    BOUNDARY_DATES.length,
                    BOUNDARY_BOOLEANS.length,
                    BOUNDARY_ARRAY_SIZES.length,
                );
            case 'MALICIOUS':
                return Math.max(
                    ALL_MALICIOUS_STRINGS.length,
                    MALICIOUS_NUMBERS.length,
                    MALICIOUS_DATES.length,
                    MALICIOUS_BOOLEANS.length,
                    MALICIOUS_TYPE_CONFUSION.length,
                );
            default:
                return 0;
        }
    }

    /** @deprecated Use minIterationsNeeded('BOUNDARY') instead. */
    public static boundaryIterationsNeeded(): number {
        return SmartPayloadGenerator.minIterationsNeeded('BOUNDARY');
    }

    // ─── Sequential pick ───────────────────────────────────

    /** Advances the counter each call, wraps around at array length. */
    private seqPick<T>(arr: readonly T[], counter: SeqCounter): T {
        const val = arr[this[counter] % arr.length];
        (this as any)[counter]++;
        return val;
    }

    // ─── Public API ────────────────────────────────────────

    /**
     * Generate a value for a single property.
     * Priority: enum → dictionary → format-aware → profile-based
     */
    public generate(propertyName: string, schema: SchemaProperty): any {
        // 1. Enum — respect explicit enum values, but allow bypass in security profiles
        if (schema.enum && schema.enum.length > 0) {
            const shouldBypass =
                (this.profile === 'MALICIOUS' || this.profile === 'BOUNDARY') &&
                rand.next() < 0.3;
            if (!shouldBypass) {
                return rand.pick(schema.enum);
            }
            // Fall through to standard profile-based generation to probe out-of-spec values
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
            const isRequired = schema.required?.includes(key) ?? false;

            // 30% chance to omit optional fields in intensive profiles
            if (
                !isRequired &&
                (this.profile === 'BOUNDARY' || this.profile === 'MALICIOUS') &&
                rand.next() < 0.3
            ) {
                continue;
            }

            // 5% chance to omit REQUIRED fields in MALICIOUS profile to test server validation
            if (isRequired && this.profile === 'MALICIOUS' && rand.next() < 0.05) {
                continue;
            }

            if (propSchema.type === 'object' && propSchema.properties) {
                payload[key] = this.buildObject(propSchema);
            } else if (propSchema.type === 'array' && propSchema.items) {
                const count = this.getArraySize(propSchema.items);
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

    private getArraySize(itemSchema?: SchemaProperty): number {
        if (this.profile === 'BOUNDARY') {
            const size = this.seqPick(BOUNDARY_ARRAY_SIZES, '_bArrIdx');
            // Cap complex object arrays to prevent OOM; primitives can be huge
            return itemSchema?.type === 'object' ? Math.min(size, 50) : size;
        }
        return rand.int(1, 5);
    }

    private generateByProfile(type?: string, format?: string, propName?: string): any {
        // MALICIOUS: 5% chance to completely break the expected type
        if (this.profile === 'MALICIOUS' && rand.next() < 0.05) {
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
                return this.seqPick(BOUNDARY_STRINGS, '_bStrIdx');

            case 'MALICIOUS':
                return this.seqPick(ALL_MALICIOUS_STRINGS, '_mStrIdx');

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
                    ? this.seqPick(BOUNDARY_INTEGERS, '_bIntIdx')
                    : this.seqPick([...BOUNDARY_INTEGERS, ...BOUNDARY_NUMBERS], '_bNumIdx');

            case 'MALICIOUS':
                return this.seqPick(MALICIOUS_NUMBERS, '_mNumIdx');

            case 'RANDOM':
            default:
                return type === 'integer'
                    ? rand.int(1, 1000)
                    : rand.float(0, 1000);
        }
    }

    private generateBoolean(): any {
        switch (this.profile) {
            case 'BOUNDARY':
                return this.seqPick(BOUNDARY_BOOLEANS, '_bBoolIdx');

            case 'MALICIOUS':
                return this.seqPick(MALICIOUS_BOOLEANS, '_mBoolIdx');

            case 'RANDOM':
            default:
                return rand.bool();
        }
    }

    private generateDate(): any {
        switch (this.profile) {
            case 'BOUNDARY':
                return this.seqPick(BOUNDARY_DATES, '_bDateIdx');

            case 'MALICIOUS':
                return this.seqPick(MALICIOUS_DATES, '_mDateIdx');

            case 'RANDOM':
            default:
                return rand.date().toISOString();
        }
    }

    /** MALICIOUS: intentionally return wrong type to test strict typing */
    private breakType(): any {
        return this.seqPick(MALICIOUS_TYPE_CONFUSION, '_mTypeIdx');
    }
}
