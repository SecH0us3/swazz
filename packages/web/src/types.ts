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
    example?: any;
}

// ─── Settings ───────────────────────────────────────────

export interface AnalysisFinding {
    ruleId: string;
    level: 'error' | 'warning' | 'note';
    message: string;
    evidence?: string;
    owaspCategory?: string[];
}

export interface ChainingRule {
    source_profile?: string;
    source_endpoint: string;
    extract_type: 'json' | 'header' | 'regex';
    extract_path: string;
    variable_name: string;
}

export interface SwazzSettings {
    iterations_per_profile: number;
    concurrency: number;
    timeout_ms: number;
    max_payload_size_bytes: number;
    delay_between_requests_ms: number;
    profiles: FuzzingProfile[];
    /** Controls which payload subcategories are active per profile. */
    payload_categories?: Record<FuzzingProfile, string[]>;
    analyze_response_body?: boolean;
    response_size_anomaly_multiplier?: number;
    rate_limit_check?: boolean;
    rate_limit_burst_size?: number;
    bola_testing?: boolean;
    auth_headers?: string[];
    auth_cookies?: string[];
    bola_similarity_threshold?: number;
    time_anomaly_threshold_ms?: number;
    oob_server_url?: string;
    debug?: boolean;
    chaining_rules?: ChainingRule[];
}

export interface AuthStep {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: any;
    extract_cookies?: string[];
    extract_json?: Record<string, string>;
    extract_variables?: Record<string, string>;
}

export interface AuthIdentity {
    auth_sequence?: AuthStep[];
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
}

export interface PayloadCategoryDef {
    id: string;
    label: string;
    description: string;
    count: number;
}

export type PayloadCatalog = Record<FuzzingProfile, PayloadCategoryDef[]>;

export const DEFAULT_SETTINGS: SwazzSettings = {
    iterations_per_profile: 10,
    concurrency: 2,
    timeout_ms: 2000,
    max_payload_size_bytes: 1048576, // 1MB
    delay_between_requests_ms: 0,
    profiles: ['RANDOM', 'BOUNDARY', 'MALICIOUS'],
    analyze_response_body: true,
    response_size_anomaly_multiplier: 5.0,
    rate_limit_check: false,
    rate_limit_burst_size: 50,
    bola_testing: false,
    auth_headers: ['Authorization', 'X-API-Key'],
    auth_cookies: ['session', 'token', 'jwt', 'sid', 'JSESSIONID', 'PHPSESSID'],
    bola_similarity_threshold: 0.85,
    time_anomaly_threshold_ms: 4000,
    oob_server_url: '',
    debug: false,
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
    _swagger_urls?: string[];
    wordlist_files?: Record<string, string>;
    auth_sequence?: AuthStep[];
    auth_identities?: Record<string, AuthIdentity>;
    security?: {
        allow_private_ips: boolean;
    };
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
    payloadSize: number;
    responseBody?: any;
    error?: string;
    timestamp: number;
    retries: number;          // how many 429 retries were needed
    responseSize?: number;
    responseHeaders?: Record<string, string[]>;
    requestHeaders?: Record<string, string>;
    analyzerFindings?: AnalysisFinding[];
    identity?: string;
    owaspCategory?: string[];
    triage?: 'false_positive' | 'ignored' | 'acknowledged' | 'none';
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
    totalResponseBytes: number;
    maxResponseSize: number;
    totalDurationMs: number;
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
