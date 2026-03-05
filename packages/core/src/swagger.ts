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
export function parseSwaggerSpec(spec: any): ParseResult {
    if (!spec || typeof spec !== 'object') {
        throw new Error('Invalid spec: not a JSON object');
    }

    // Determine base path
    let basePath = '';

    // OpenAPI 3.x
    if (spec.openapi && spec.servers?.length > 0) {
        basePath = spec.servers[0].url || '';
    }
    // Swagger 2.0
    else if (spec.swagger) {
        const scheme = spec.schemes?.[0] || 'https';
        const host = spec.host || '';
        const path = spec.basePath || '';
        if (host) {
            basePath = `${scheme}://${host}${path}`;
        } else {
            basePath = path;
        }
    }

    const paths = spec.paths;
    if (!paths || typeof paths !== 'object') {
        throw new Error('Invalid spec: no "paths" found');
    }

    const endpoints: EndpointConfig[] = [];

    for (const [path, pathItem] of Object.entries(paths as Record<string, any>)) {
        for (const method of METHODS) {
            const operation = pathItem[method.toLowerCase()];
            if (!operation) continue;

            // Extract request body schema
            let schema = extractRequestSchema(operation, spec);

            // If no body schema (e.g. GET), create from query/path params
            if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
                schema = extractParamsSchema(operation);
            }

            // Only add if we have some schema to work with
            // (for GET requests without params, we still add them with empty schema)
            endpoints.push({
                path,
                method,
                schema: schema || { type: 'object', properties: {} },
            });
        }
    }

    return { basePath, endpoints };
}

/**
 * Extract the request body schema from an operation.
 */
function extractRequestSchema(operation: any, spec: any): SchemaProperty | null {
    // OpenAPI 3.x: requestBody → content → application/json → schema
    if (operation.requestBody) {
        const content = operation.requestBody.content;
        if (content) {
            const jsonContent = content['application/json'] || content['*/*'];
            if (jsonContent?.schema) {
                return resolveSchema(jsonContent.schema, spec);
            }
        }
    }

    // Swagger 2.0: parameters with in: "body"
    if (operation.parameters) {
        const bodyParam = operation.parameters.find((p: any) => p.in === 'body');
        if (bodyParam?.schema) {
            return resolveSchema(bodyParam.schema, spec);
        }
    }

    return null;
}

/**
 * Extract schemas from query/path parameters.
 */
function extractParamsSchema(operation: any): SchemaProperty | null {
    if (!operation.parameters || operation.parameters.length === 0) {
        return null;
    }

    const properties: Record<string, SchemaProperty> = {};

    for (const param of operation.parameters) {
        if (param.in === 'body') continue; // Already handled
        if (param.in === 'header') continue; // Not relevant for fuzzing payload

        const name = param.name;
        if (!name) continue;

        properties[name] = {
            type: param.type || param.schema?.type || 'string',
            format: param.format || param.schema?.format,
            enum: param.enum || param.schema?.enum,
        };
    }

    if (Object.keys(properties).length === 0) return null;

    return { type: 'object', properties };
}

/**
 * Resolve $ref references in a schema (simple, 1-level deep).
 */
function resolveSchema(schema: any, spec: any): SchemaProperty {
    if (!schema) return { type: 'object', properties: {} };

    // Handle $ref
    if (schema.$ref) {
        const resolved = resolveRef(schema.$ref, spec);
        if (resolved) return resolveSchema(resolved, spec);
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
            result.properties[key] = resolveSchema(propSchema, spec);
        }
    }

    // allOf — merge properties
    if (schema.allOf) {
        result.type = 'object';
        result.properties = result.properties || {};
        for (const sub of schema.allOf) {
            const resolved = resolveSchema(sub, spec);
            if (resolved.properties) {
                Object.assign(result.properties, resolved.properties);
            }
        }
    }

    // Array items
    if (schema.items) {
        result.type = 'array';
        result.items = resolveSchema(schema.items, spec);
    }

    return result;
}

/**
 * Resolve a JSON pointer $ref like "#/definitions/User" or "#/components/schemas/User".
 */
function resolveRef(ref: string, spec: any): any {
    if (!ref.startsWith('#/')) return null;

    const path = ref.slice(2).split('/');
    let current = spec;

    for (const segment of path) {
        if (!current || typeof current !== 'object') return null;
        current = current[segment];
    }

    return current;
}
