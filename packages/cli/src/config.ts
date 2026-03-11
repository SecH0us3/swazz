/**
 * Config loader — reads and validates swazz.config.json, fetches Swagger specs,
 * builds SwazzConfig for the FuzzRunner.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSwaggerSpec, DEFAULT_SETTINGS } from '@swazz/core';
import type { SwazzConfig, EndpointConfig } from '@swazz/core';
import type { CliConfig } from './types.js';

export async function loadConfig(configPath: string): Promise<{ cliConfig: CliConfig; runConfig: SwazzConfig }> {
    const fullPath = resolve(configPath);
    const raw = await readFile(fullPath, 'utf-8');
    const cliConfig: CliConfig = JSON.parse(raw);

    // Validate required fields
    if (!cliConfig.swagger_urls?.length) {
        throw new Error('Config must include at least one swagger_urls entry');
    }

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

async function fetchSpec(url: string, headers?: Record<string, string>): Promise<any> {
    // Support local file paths
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        const raw = await readFile(resolve(url), 'utf-8');
        return JSON.parse(raw);
    }

    const res = await fetch(url, {
        headers: headers ?? {},
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch spec from ${url}: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

function filterEndpoints(
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
