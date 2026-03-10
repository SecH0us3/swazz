// @swazz/core — Smart API Fuzzing Engine
// Zero dependencies, works in browser and Node.js

export type {
    FuzzingProfile,
    SchemaProperty,
    Dictionary,
    EndpointConfig,
    SwazzSettings,
    SwazzConfig,
    FuzzResult,
    RunStats,
    SendRequestPayload,
    SendRequestFn,
} from './types.js';

export { DEFAULT_SETTINGS } from './types.js';
export { SmartPayloadGenerator } from './generator.js';
export { FuzzRunner } from './runner.js';
export { parseSwaggerSpec } from './swagger.js';
export * as random from './random.js';

/**
 * Recursively truncate large strings in an object tree.
 * Useful for stripping oversized payloads/responses before storage.
 */
export function deepStrip(val: any, maxLen: number = 1024): any {
    if (typeof val === 'string' && val.length > maxLen) {
        return val.substring(0, maxLen) + `\n\n… truncated (${(val.length / 1024).toFixed(1)}KB total)`;
    }
    if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
            return val.map(v => deepStrip(v, maxLen));
        }
        const obj: any = {};
        for (const key in val) {
            obj[key] = deepStrip(val[key], maxLen);
        }
        return obj;
    }
    return val;
}
