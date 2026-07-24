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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'MCP' | 'CALL';
    schema: SchemaProperty;
    /** Schemas for {param} placeholders in the path (e.g. /users/{id}) */
    pathParams?: Record<string, SchemaProperty>;
    /** Schemas for query parameters to be fuzzed */
    queryParams?: Record<string, SchemaProperty>;
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
    ai_status?: 'pending' | 'completed' | 'failed';
    ai_relevance?: boolean;
    ai_explanation?: string;
    ai_remediation?: string;
    ai_proposed_patch?: string;
    pr_link?: string;
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
    har_domain_filter?: string;
    data_retention?: string;
    disable_shared_runners?: boolean;
    max_scan_duration_min?: number;
    active_parameter_fuzzing?: boolean;
    proxy_list?: string[];
    randomize_user_agent?: boolean;
    enable_adaptive_rate_limit?: boolean;
    enable_semantic_mutation?: boolean;
    use_llm_prepass?: boolean;
    ai_gateway_url?: string;
    cf_aig_token?: string;
}

export interface AuthStep {
    type?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: any;
    extract_cookies?: string[];
    extract_json?: Record<string, string>;
    extract_variables?: Record<string, string>;
    totp_secret?: string;
    totp_variable?: string;
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
    data_retention: 'forever',
    disable_shared_runners: false,
    max_scan_duration_min: 0,
    active_parameter_fuzzing: false,
    proxy_list: [],
    randomize_user_agent: false,
    enable_adaptive_rate_limit: false,
    enable_semantic_mutation: true,
    use_llm_prepass: false,
    ai_gateway_url: '',
    cf_aig_token: '',
};

// ─── Full Config ────────────────────────────────────────

export interface IgnoreRule {
    rule_id?: string;
    endpoint?: string;
    method?: string;
    payload?: string;
    status?: number | string;
    status_code?: number | string;
}

export interface MCPServerConfig {
    type: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    url?: string;
}

export interface SwazzConfig {
    base_url: string;
    global_headers: Record<string, string>;
    cookies: Record<string, string>;
    dictionaries: Dictionary;
    settings: SwazzSettings;
    endpoints: EndpointConfig[];
    disabled_endpoints?: string[];
    _swagger_urls?: string[];
    _swagger_metadata?: Record<string, { endpointCount: number; status: 'success' | 'error'; lastRefreshed?: string }>;
    wordlist_files?: Record<string, string>;
    auth_sequence?: AuthStep[];
    auth_identities?: Record<string, AuthIdentity>;
    security?: {
        allow_private_ips: boolean;
    };
    rules?: {
        ignore?: number[];
        severity?: Record<string, string>;
        defaults?: Record<string, string>;
        ignore_rules?: IgnoreRule[];
    };
    /** Project this scan belongs to. Stripped before sending to the Go agent. */
    projectId?: string;
    mcp_server?: MCPServerConfig;
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

// ─── Projects ───────────────────────────────────────────

export interface Project {
    id: string;
    name: string;
    description: string;
    url_mappings?: string;
    ai_prompts?: string;
    propose_fixes?: number;
    custom_cli_command?: string;
    auto_fix_rules?: string;
    member_session_timeout?: number;
}

export interface LoginHistoryEntry {
    id: string;
    status: 'success' | 'failed_password' | 'failed_2fa' | 'locked';
    ip_address: string;
    country: string | null;
    city: string | null;
    region: string | null;
    timezone: string | null;
    cf_ray: string | null;
    user_agent: string | null;
    auth_method: 'password' | 'github' | 'gitlab';
    two_factor_active: number;
    created_at: string;
}

export interface Webhook {
    id: string;
    project_id: string;
    url: string;
    headers?: string | null;
    event_types: string[]; // parsed from JSON array
    secret: string;
    created_at?: string;
}

