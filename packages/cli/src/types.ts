import type { SwazzSettings, FuzzingProfile } from '@swazz/core';

// ─── CLI Config (swazz.config.json) ─────────────────────

export interface CliConfig {
    /** Swagger/OpenAPI spec URLs to parse */
    swagger_urls: string[];
    /** API base URL (overrides spec's servers/host) */
    base_url?: string;
    /** Global request headers (e.g. Authorization) */
    headers?: Record<string, string>;
    /** Cookies to send with every request */
    cookies?: Record<string, string>;
    /** Custom dictionaries: property name → values */
    dictionaries?: Record<string, any[]>;
    /** Fuzzing settings (iterations, concurrency, etc.) */
    settings?: Partial<SwazzSettings>;
    /** Endpoint filtering */
    endpoints?: {
        include?: string[];
        exclude?: string[];
    };
    /** Finding classification rules */
    rules?: RulesConfig;
}

// ─── Rules Config ────────────────────────────────────────

export type Severity = 'error' | 'warning' | 'note' | 'ignore';

export interface RulesConfig {
    /** Statuses to ignore (not findings). Default: [401, 403, 404, 405, 422, 429] */
    ignore?: number[];
    /** Severity by specific status code or range pattern (e.g. "5xx") */
    severity?: Record<string, Severity>;
    /** Default severity for statuses not in ignore/severity. Default per range. */
    defaults?: Record<string, Severity>;
}

// ─── Finding (classified result) ─────────────────────────

export interface Finding {
    id: string;
    ruleId: string;
    level: 'error' | 'warning' | 'note';
    endpoint: string;
    resolvedPath: string;
    method: string;
    profile: FuzzingProfile;
    status: number;
    duration: number;
    payload: any;
    responseBody?: any;
    error?: string;
    timestamp: number;
}

// ─── CLI Options (parsed from argv) ─────────────────────

export type OutputFormat = 'json' | 'sarif' | 'html' | 'console';

export interface CliOptions {
    config: string;
    format: OutputFormat[];
    output?: string;
    quiet: boolean;
    failOnFindings: boolean;
}
