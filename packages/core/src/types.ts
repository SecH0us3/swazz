// ─── Fuzzing Profiles ────────────────────────────────────

export type FuzzingProfile = 'RANDOM' | 'BOUNDARY' | 'MALICIOUS';

// ─── JSON Schema Types ──────────────────────────────────

export interface SchemaProperty {
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    format?: 'email' | 'uuid' | 'date-time' | 'uri' | 'ipv4' | string;
    enum?: any[];
    properties?: Record<string, SchemaProperty>;
    items?: SchemaProperty;
    /** List of required property keys (mirrors JSON Schema "required" array). */
    required?: string[];
}

// ─── Dictionary ─────────────────────────────────────────

export type Dictionary = Record<string, any[]>;

// ─── Endpoint Config ────────────────────────────────────

export interface EndpointConfig {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    schema: SchemaProperty;
    /** Schemas for {param} placeholders in the path (e.g. /users/{id}) */
    pathParams?: Record<string, SchemaProperty>;
    /** Schemas for header parameters to be fuzzed (in: 'header' params from spec). */
    headerParams?: Record<string, SchemaProperty>;
    /** Content-Type for the request body (e.g. 'application/x-www-form-urlencoded'). */
    contentType?: string;
}

// ─── Settings ───────────────────────────────────────────

export interface SwazzSettings {
    iterations_per_profile: number;
    concurrency: number;
    timeout_ms: number;
    max_payload_size_bytes: number;
    delay_between_requests_ms: number;
    profiles: FuzzingProfile[];
}

export const DEFAULT_SETTINGS: SwazzSettings = {
    iterations_per_profile: 2,
    concurrency: 2,
    timeout_ms: 2000,
    max_payload_size_bytes: 1048576, // 1MB
    delay_between_requests_ms: 0,
    profiles: ['RANDOM', 'BOUNDARY', 'MALICIOUS'],
};

// ─── Full Config ────────────────────────────────────────

export interface SwazzConfig {
    base_url: string;
    global_headers: Record<string, string>;
    cookies: Record<string, string>;
    dictionaries: Dictionary;
    settings: SwazzSettings;
    endpoints: EndpointConfig[];
    disabled_endpoints?: string[];
}

// ─── Results ────────────────────────────────────────────

export interface FuzzResult {
    id: string;
    endpoint: string;         // original template path e.g. /users/{id}
    resolvedPath: string;     // actual path used e.g. /users/abc123
    method: string;
    profile: FuzzingProfile;
    status: number;
    duration: number;
    payload: any;
    responseBody?: any;
    error?: string;
    timestamp: number;
    retries: number;          // how many 429 retries were needed
}

// ─── Live Stats ─────────────────────────────────────────

export interface RunStats {
    totalRequests: number;
    totalPlanned: number;
    requestsPerSecond: number;
    statusCounts: Record<number, number>;
    profileCounts: Record<FuzzingProfile, number>;
    endpointCounts: Record<string, Record<number, number>>;
    startTime: number;
    isRunning: boolean;
    /** Progress tracking */
    progress: {
        completedEndpoints: number;
        totalEndpoints: number;
        currentEndpoint: string;
        currentProfile: FuzzingProfile | '';
    };
}

// ─── Request abstraction ────────────────────────────────

export interface SendRequestPayload {
    url: string;
    method: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
    body: any;
}

export type SendRequestFn = (req: SendRequestPayload) => Promise<{
    status: number;
    body: any;
    duration: number;
    headers?: Record<string, string>;
}>;
