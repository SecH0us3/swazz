/**
 * Config loader — reads and validates swazz.config.json, fetches Swagger specs,
 * builds SwazzConfig for the FuzzRunner.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSwaggerSpec, DEFAULT_SETTINGS } from '@swazz/core';
import type { SwazzConfig, EndpointConfig, SwazzSettings } from '@swazz/core';
import type { CliConfig, RulesConfig } from './types.js';

export async function loadConfig(configPath: string): Promise<{ cliConfig: CliConfig; runConfig: SwazzConfig }> {
    const fullPath = resolve(configPath);
    let raw: string;
    try {
        raw = await readFile(fullPath, 'utf-8');
    } catch {
        throw new Error(`Cannot read config file: ${fullPath}`);
    }

    let cliConfig: CliConfig;
    try {
        cliConfig = JSON.parse(raw);
    } catch {
        throw new Error(`Config file is not valid JSON: ${fullPath}`);
    }

    validateCliConfig(cliConfig);

    // Fetch and parse all swagger specs
    let allEndpoints: EndpointConfig[] = [];
    let basePath = cliConfig.base_url || '';

    for (const url of cliConfig.swagger_urls) {
        const spec = await fetchSpec(url, cliConfig.headers);
        const parsed = parseSwaggerSpec(spec);

        if (!basePath && parsed.basePath) {
            basePath = parsed.basePath;
        }

        allEndpoints.push(...parsed.endpoints);
    }

    if (!basePath) {
        throw new Error('No base_url in config and no servers/host found in Swagger specs');
    }

    // Apply endpoint filtering
    if (cliConfig.endpoints) {
        allEndpoints = filterEndpoints(allEndpoints, cliConfig.endpoints);
    }

    if (allEndpoints.length === 0) {
        throw new Error('No endpoints found after parsing specs and applying filters');
    }

    // Merge settings with defaults
    const settings = { ...DEFAULT_SETTINGS, ...cliConfig.settings };

    const runConfig: SwazzConfig = {
        base_url: basePath,
        global_headers: cliConfig.headers ?? {},
        cookies: cliConfig.cookies ?? {},
        dictionaries: cliConfig.dictionaries ?? {},
        settings,
        endpoints: allEndpoints,
    };

    return { cliConfig, runConfig };
}

/**
 * Quick-run loader: build a minimal CliConfig from a single Swagger URL.
 * No config file needed — sensible defaults are applied.
 */
export async function loadConfigFromUrl(
    swaggerUrl: string,
    baseUrlOverride?: string,
): Promise<{ cliConfig: CliConfig; runConfig: SwazzConfig }> {
    const spec = await fetchSpec(swaggerUrl);
    const parsed = parseSwaggerSpec(spec);

    const basePath = baseUrlOverride || parsed.basePath;
    if (!basePath) {
        throw new Error(
            'Could not determine base URL from spec. Use --base-url to provide one.',
        );
    }

    const cliConfig: CliConfig = {
        swagger_urls: [swaggerUrl],
        base_url: basePath,
    };

    if (parsed.endpoints.length === 0) {
        throw new Error('No endpoints found in the provided spec');
    }

    const settings = { ...DEFAULT_SETTINGS };

    const runConfig: SwazzConfig = {
        base_url: basePath,
        global_headers: {},
        cookies: {},
        dictionaries: {},
        settings,
        endpoints: parsed.endpoints,
    };

    return { cliConfig, runConfig };
}

async function fetchSpec(url: string, headers?: Record<string, string>): Promise<any> {
    // Support local file paths
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        let raw: string;
        try {
            raw = await readFile(resolve(url), 'utf-8');
        } catch {
            throw new Error(`Cannot read local spec file: ${url}`);
        }
        try {
            return JSON.parse(raw);
        } catch {
            throw new Error(`Spec file is not valid JSON: ${url}`);
        }
    }

    let res: Response;
    try {
        res = await fetch(url, { headers: headers ?? {} });
    } catch (err) {
        throw new Error(`Network error fetching spec from ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
        throw new Error(`Failed to fetch spec from ${url}: ${res.status} ${res.statusText}`);
    }

    try {
        return await res.json();
    } catch {
        throw new Error(`Spec at ${url} is not valid JSON`);
    }
}

export function filterEndpoints(
    endpoints: EndpointConfig[],
    filter: { include?: string[]; exclude?: string[] },
): EndpointConfig[] {
    let result = endpoints;

    if (filter.include?.length) {
        result = result.filter(ep => {
            const key = `${ep.method} ${ep.path}`;
            return filter.include!.some(pattern => matchPattern(key, pattern) || matchPattern(ep.path, pattern));
        });
    }

    if (filter.exclude?.length) {
        result = result.filter(ep => {
            const key = `${ep.method} ${ep.path}`;
            return !filter.exclude!.some(pattern => matchPattern(key, pattern) || matchPattern(ep.path, pattern));
        });
    }

    return result;
}

/** Simple glob matching: * matches any sequence of non-/ chars, ** matches anything */
function matchPattern(value: string, pattern: string): boolean {
    const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<DOUBLESTAR>>>/g, '.*');
    return new RegExp(`^${regex}$`).test(value);
}

// ─── Config validation ───────────────────────────────────────

function validateCliConfig(cfg: any): asserts cfg is CliConfig {
    if (!cfg || typeof cfg !== 'object') {
        throw new Error('Config must be a JSON object');
    }

    if (!Array.isArray(cfg.swagger_urls) || cfg.swagger_urls.length === 0) {
        throw new Error('Config must include at least one "swagger_urls" entry (array of strings)');
    }

    for (const u of cfg.swagger_urls) {
        if (typeof u !== 'string') {
            throw new Error('"swagger_urls" entries must be strings');
        }
    }

    if (cfg.base_url !== undefined && typeof cfg.base_url !== 'string') {
        throw new Error('"base_url" must be a string');
    }

    if (cfg.headers !== undefined && !isStringRecord(cfg.headers)) {
        throw new Error('"headers" must be an object with string values');
    }

    if (cfg.cookies !== undefined && !isStringRecord(cfg.cookies)) {
        throw new Error('"cookies" must be an object with string values');
    }

    if (cfg.settings !== undefined) {
        validateSettings(cfg.settings);
    }

    if (cfg.endpoints !== undefined) {
        const ep = cfg.endpoints;
        if (typeof ep !== 'object' || Array.isArray(ep)) {
            throw new Error('"endpoints" must be an object with optional "include" and "exclude" arrays');
        }
        if (ep.include !== undefined && !isStringArray(ep.include)) {
            throw new Error('"endpoints.include" must be an array of strings');
        }
        if (ep.exclude !== undefined && !isStringArray(ep.exclude)) {
            throw new Error('"endpoints.exclude" must be an array of strings');
        }
    }
}

function validateSettings(s: any): void {
    const numFields: Array<keyof SwazzSettings> = [
        'iterations_per_profile', 'concurrency', 'timeout_ms',
        'max_payload_size_bytes', 'delay_between_requests_ms',
    ];
    for (const field of numFields) {
        if (s[field] !== undefined && typeof s[field] !== 'number') {
            throw new Error(`"settings.${field}" must be a number, got ${JSON.stringify(s[field])}`);
        }
    }

    if (s.profiles !== undefined) {
        if (!Array.isArray(s.profiles)) {
            throw new Error('"settings.profiles" must be an array');
        }
        const valid = new Set(['RANDOM', 'BOUNDARY', 'MALICIOUS']);
        for (const p of s.profiles) {
            if (!valid.has(p)) {
                throw new Error(`"settings.profiles" contains unknown profile "${p}". Valid: RANDOM, BOUNDARY, MALICIOUS`);
            }
        }
    }
}

function isStringRecord(v: any): boolean {
    return typeof v === 'object' && !Array.isArray(v) && v !== null &&
        Object.values(v).every(x => typeof x === 'string');
}

function isStringArray(v: any): boolean {
    return Array.isArray(v) && v.every(x => typeof x === 'string');
}
