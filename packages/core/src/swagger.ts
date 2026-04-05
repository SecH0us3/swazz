/**
 * Swagger/OpenAPI parser — extracts endpoints from a spec URL or JSON.
 * Supports both OpenAPI 3.x and Swagger 2.0.
 */

import type { EndpointConfig, SchemaProperty } from './types.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

interface ParseResult {
    basePath: string;
    endpoints: EndpointConfig[];
}

/**
 * Parse a Swagger/OpenAPI JSON spec into EndpointConfig[].
 */
export function parseSwaggerSpec(spec: unknown): ParseResult {
    const s = spec as Record<string, any>;
    if (!s || typeof s !== 'object') {
        throw new Error('Invalid spec: not a JSON object');
    }

    // Determine base path
    let basePath = '';

    // OpenAPI 3.x
    if (s.openapi && s.servers?.length > 0) {
        basePath = s.servers[0].url || '';
    }
    // Swagger 2.0
    else if (s.swagger) {
        const scheme = s.schemes?.[0] || 'https';
        const host = s.host || '';
        const path = s.basePath || '';
        if (host) {
            basePath = `${scheme}://${host}${path}`;
        } else {
            basePath = path;
        }
    }

    // Normalize URL templates like https://{environment}.api.com → https://default.api.com
    basePath = basePath.replace(/\{([^}]+)\}/g, 'default');

    const paths = s.paths;
    if (!paths || typeof paths !== 'object') {
        throw new Error('Invalid spec: no "paths" found');
    }

    const endpoints: EndpointConfig[] = [];

    for (const [path, pathItem] of Object.entries(paths as Record<string, any>)) {
        for (const method of METHODS) {
            const operation = pathItem[method.toLowerCase()];
            if (!operation) continue;

            // Merge path-level parameters with operation-level parameters
            const allParams = [
                ...(pathItem.parameters ?? []),
                ...(operation.parameters ?? []),
            ];

            // Extract request body schema (returns schema + detected content-type)
            const bodyResult = extractRequestSchema(operation, s);

            // If no body schema (e.g. GET), create from query/path params
            let schema = bodyResult?.schema ?? null;
            if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
                schema = extractParamsSchema(allParams);
            }

            // Extract path parameters separately for URL substitution
            const pathParams = extractPathParams(allParams);

            // Extract header parameters for header-injection fuzzing
            const headerParams = extractHeaderParams(allParams, s);

            endpoints.push({
                path,
                method,
                schema: schema || { type: 'object', properties: {} },
                ...(Object.keys(pathParams).length > 0 ? { pathParams } : {}),
                ...(Object.keys(headerParams).length > 0 ? { headerParams } : {}),
                ...(bodyResult?.contentType ? { contentType: bodyResult.contentType } : {}),
            });
        }
    }

    return { basePath, endpoints };
}


interface BodyResult {
    schema: SchemaProperty;
    contentType: string;
}

/**
 * Extract the request body schema from an operation.
 * Returns both the resolved schema and the actual content-type key found in the spec.
 */
function extractRequestSchema(operation: any, spec: Record<string, any>): BodyResult | null {
    // OpenAPI 3.x: requestBody → content → <mime> → schema
    if (operation.requestBody) {
        const content = operation.requestBody.content as Record<string, any> | undefined;
        if (content) {
            // Prefer JSON, then form-urlencoded, then multipart, then wildcard
            const PREFERRED = [
                'application/json',
                'application/x-www-form-urlencoded',
                'multipart/form-data',
                '*/*',
            ];
            const key =
                PREFERRED.find((k) => content[k]?.schema) ??
                Object.keys(content).find((k) => content[k]?.schema);

            if (key && content[key]?.schema) {
                return {
                    schema: resolveSchema(content[key].schema, spec),
                    contentType: key === '*/*' ? 'application/json' : key,
                };
            }
        }
    }

    // Swagger 2.0: parameters with in: "body"
    if (operation.parameters) {
        const bodyParam = (operation.parameters as any[]).find((p: any) => p.in === 'body');
        if (bodyParam?.schema) {
            return {
                schema: resolveSchema(bodyParam.schema, spec),
                contentType: 'application/json',
            };
        }
    }

    return null;
}

/**
 * Extract schemas from query parameters (for use as fuzz body/query params).
 * Accepts a flat params array (already merged path-level + operation-level).
 */
function extractParamsSchema(params: any[]): SchemaProperty | null {
    if (!params || params.length === 0) {
        return null;
    }

    const properties: Record<string, SchemaProperty> = {};

    for (const param of params) {
        if (param.in === 'body') continue;    // Already handled
        if (param.in === 'header') continue;  // Handled by extractHeaderParams
        if (param.in === 'path') continue;    // Handled by extractPathParams

        const name = param.name as string | undefined;
        if (!name) continue;

        properties[name] = {
            type: param.type || param.schema?.type || 'string',
            format: param.format || param.schema?.format,
            enum: param.enum || param.schema?.enum,
            // Preserve nested schemas so the generator can produce correct values
            // for array and object query parameters.
            items: param.items || param.schema?.items,
            properties: param.properties || param.schema?.properties,
        };
    }

    if (Object.keys(properties).length === 0) return null;

    return { type: 'object', properties };
}

/**
 * Extract path parameters (in: 'path') as a SchemaProperty map for URL substitution.
 */
function extractPathParams(params: any[]): Record<string, SchemaProperty> {
    const result: Record<string, SchemaProperty> = {};

    for (const param of params) {
        if (param.in !== 'path') continue;
        const name = param.name;
        if (!name) continue;

        result[name] = {
            type: (param.schema?.type ?? param.type ?? 'string') as SchemaProperty['type'],
            format: param.schema?.format ?? param.format,
            enum: param.schema?.enum ?? param.enum,
        };
    }

    return result;
}

/**
 * Extract header parameters (in: 'header') for injection fuzzing.
 */
function extractHeaderParams(
    params: any[],
    spec: Record<string, any>,
): Record<string, SchemaProperty> {
    const result: Record<string, SchemaProperty> = {};

    for (const param of params) {
        if (param.in !== 'header') continue;
        const name = param.name as string | undefined;
        if (!name) continue;

        result[name] = resolveSchema(
            param.schema ?? {
                type: param.type ?? 'string',
                format: param.format,
                enum: param.enum,
            },
            spec,
        );
    }

    return result;
}

/**
 * Resolve $ref references in a schema with cycle detection.
 * `seenRefs` tracks all $ref strings currently on the call stack; if we
 * encounter the same ref again we return a safe fallback to prevent
 * Maximum Call Stack Size Exceeded errors on circular specs.
 */
function resolveSchema(
    schema: any,
    spec: Record<string, any>,
    seenRefs: Set<string> = new Set(),
): SchemaProperty {
    if (!schema) return { type: 'object', properties: {} };

    // Handle $ref with cycle detection
    if (schema.$ref) {
        if (seenRefs.has(schema.$ref)) {
            // Circular reference — return a safe fallback
            return { type: 'object' };
        }
        const nextSeen = new Set(seenRefs);
        nextSeen.add(schema.$ref);
        const resolved = resolveRef(schema.$ref, spec);
        if (resolved) return resolveSchema(resolved, spec, nextSeen);
        return { type: 'object', properties: {} };
    }

    const result: SchemaProperty = {
        type: schema.type,
        format: schema.format,
        enum: schema.enum,
    };

    // Object with properties
    if (schema.properties) {
        result.type = 'object';
        result.properties = {};
        for (const [key, propSchema] of Object.entries(schema.properties as Record<string, any>)) {
            result.properties[key] = resolveSchema(propSchema, spec, seenRefs);
        }
    }

    // Propagate required field list so buildObject can omit optional fields
    if (Array.isArray(schema.required) && schema.required.length > 0) {
        result.required = schema.required as string[];
    }

    // allOf — merge properties and required lists
    if (schema.allOf) {
        result.type = 'object';
        result.properties = result.properties || {};
        for (const sub of schema.allOf) {
            const resolved = resolveSchema(sub, spec, seenRefs);
            if (resolved.properties) {
                Object.assign(result.properties, resolved.properties);
            }
            if (resolved.required) {
                result.required = [...(result.required ?? []), ...resolved.required];
            }
        }
    }

    // Array items
    if (schema.items) {
        result.type = 'array';
        result.items = resolveSchema(schema.items, spec, seenRefs);
    }

    return result;
}

/**
 * Resolve a JSON pointer $ref like "#/definitions/User" or "#/components/schemas/User".
 */
function resolveRef(ref: string, spec: Record<string, any>): unknown {
    if (!ref.startsWith('#/')) return null;

    const path = ref.slice(2).split('/');
    let current: unknown = spec;

    for (const segment of path) {
        if (!current || typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[segment];
    }

    return current;
}
