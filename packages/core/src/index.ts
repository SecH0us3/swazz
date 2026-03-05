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
