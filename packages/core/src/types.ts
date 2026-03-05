// ─── Fuzzing Profiles ────────────────────────────────────

export type FuzzingProfile = 'RANDOM' | 'BOUNDARY' | 'MALICIOUS';

// ─── JSON Schema Types ──────────────────────────────────

export interface SchemaProperty {
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    format?: 'email' | 'uuid' | 'date-time' | 'uri' | 'ipv4' | string;
    enum?: any[];
    properties?: Record<string, SchemaProperty>;
    items?: SchemaProperty;
}

// ─── Dictionary ─────────────────────────────────────────

export type Dictionary = Record<string, any[]>;

// ─── Endpoint Config ────────────────────────────────────

export interface EndpointConfig {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    schema: SchemaProperty;
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
    iterations_per_profile: 20,
    concurrency: 5,
    timeout_ms: 10000,
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
}

// ─── Results ────────────────────────────────────────────

export interface FuzzResult {
    id: string;
    endpoint: string;
    method: string;
    profile: FuzzingProfile;
    status: number;
    duration: number;
    payload: any;
    responseBody?: any;
    error?: string;
    timestamp: number;
}

// ─── Live Stats ─────────────────────────────────────────

export interface RunStats {
    totalRequests: number;
    requestsPerSecond: number;
    statusCounts: Record<number, number>;
    profileCounts: Record<FuzzingProfile, number>;
    endpointCounts: Record<string, Record<number, number>>;
    startTime: number;
    isRunning: boolean;
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
}>;
