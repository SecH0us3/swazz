import { ReactNode, createElement } from 'react';
import type { SchemaProperty } from '../../types.js';

/**
 * Generates a default/mock template object based on a JSON Schema.
 */
export function generateTemplateFromSchema(schema?: SchemaProperty): any {
    if (!schema) return undefined;
    if (schema.enum && schema.enum.length > 0) {
        return schema.enum[0];
    }
    switch (schema.type) {
        case 'object':
            const obj: Record<string, any> = {};
            if (schema.properties) {
                for (const [k, prop] of Object.entries(schema.properties)) {
                    obj[k] = generateTemplateFromSchema(prop);
                }
            }
            return obj;
        case 'array':
            return schema.items ? [generateTemplateFromSchema(schema.items)] : [];
        case 'string':
            if (schema.format === 'date-time') return '2026-05-26T21:30:00Z';
            if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
            if (schema.format === 'email') return 'user@example.com';
            return 'string';
        case 'number':
        case 'integer':
            return 0;
        case 'boolean':
            return false;
        default:
            // Fallback for simple values or undefined type
            if (schema.properties) {
                return generateTemplateFromSchema({ ...schema, type: 'object' });
            }
            return '';
    }
}

/**
 * Extracts query parameters as a key-value record from a URL or resolved path.
 */
export function parseQueryParams(resolvedPath: string): Record<string, string> {
    const params: Record<string, string> = {};
    try {
        const queryIndex = resolvedPath.indexOf('?');
        if (queryIndex !== -1) {
            const queryString = resolvedPath.substring(queryIndex + 1);
            const searchParams = new URLSearchParams(queryString);
            searchParams.forEach((val, key) => {
                params[key] = val;
            });
        }
    } catch { /* ignore */ }
    return params;
}

/**
 * Recursively diffs fuzzed vs template values and renders standard React Nodes with highlights.
 */
export function renderJsonDiff(
    fuzzed: any,
    template: any,
    isMalicious: boolean,
    depth: number = 0
): ReactNode {
    const indent = '  '.repeat(depth);

    const renderPrimitiveValue = (val: any, isMutated: boolean) => {
        let color = 'var(--text-primary)';
        if (typeof val === 'string') {
            color = 'var(--color-success)';
        } else if (typeof val === 'number' || typeof val === 'boolean') {
            color = 'var(--color-warning)';
        } else if (val === null) {
            color = 'var(--color-error)';
        }

        const valueString = JSON.stringify(val);

        if (isMutated) {
            const highlightBg = isMalicious ? 'var(--color-error-bg)' : 'var(--color-warning-bg)';
            const highlightBorder = isMalicious ? '1px dashed var(--color-error)' : '1px dashed var(--color-warning)';
            const highlightColor = isMalicious ? 'var(--color-error)' : 'var(--color-warning)';
            return createElement(
                'span',
                {
                    style: {
                        backgroundColor: highlightBg,
                        border: highlightBorder,
                        color: highlightColor,
                        padding: '2px 4px',
                        borderRadius: '4px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 500,
                    },
                },
                valueString
            );
        }

        return createElement('span', { style: { color } }, valueString);
    };

    if (fuzzed === undefined) {
        return createElement('span', { style: { color: 'var(--text-disabled)' } }, 'undefined');
    }

    // Handle primitive mismatch or nulls
    if (
        typeof fuzzed !== typeof template ||
        (fuzzed === null && template !== null) ||
        (fuzzed !== null && template === null)
    ) {
        return renderPrimitiveValue(fuzzed, true);
    }

    // Primitives
    if (typeof fuzzed !== 'object' || fuzzed === null) {
        const isMutated = fuzzed !== template;
        return renderPrimitiveValue(fuzzed, isMutated);
    }

    // Arrays
    if (Array.isArray(fuzzed)) {
        if (!Array.isArray(template)) {
            return renderPrimitiveValue(fuzzed, true);
        }
        if (fuzzed.length === 0) {
            return createElement('span', null, '[]');
        }

        const arrayNodes: ReactNode[] = [];
        arrayNodes.push('[\n');

        fuzzed.forEach((item, idx) => {
            const tempItem = idx < template.length ? template[idx] : template[0];
            arrayNodes.push(indent + '  ');
            arrayNodes.push(renderJsonDiff(item, tempItem, isMalicious, depth + 1));
            if (idx < fuzzed.length - 1) {
                arrayNodes.push(',\n');
            } else {
                arrayNodes.push('\n');
            }
        });

        arrayNodes.push(indent + ']');
        return createElement('span', null, ...arrayNodes);
    }

    // Objects
    const fuzzedKeys = Object.keys(fuzzed);
    const templateKeys = Object.keys(template || {});
    const allKeys = Array.from(new Set([...fuzzedKeys, ...templateKeys]));

    if (allKeys.length === 0) {
        return createElement('span', null, '{}');
    }

    const objNodes: ReactNode[] = [];
    objNodes.push('{\n');

    allKeys.forEach((key, idx) => {
        const isKeyInFuzzed = key in fuzzed;
        const isKeyInTemplate = key in (template || {});

        const comma = idx < allKeys.length - 1 ? ',\n' : '\n';

        if (!isKeyInFuzzed) {
            // Deleted key
            objNodes.push(
                createElement(
                    'span',
                    {
                        key,
                        style: {
                            color: 'var(--text-disabled)',
                            textDecoration: 'line-through',
                        },
                    },
                    `${indent}  "${key}": ${JSON.stringify(template[key])}${comma}`
                )
            );
            return;
        }

        if (!isKeyInTemplate) {
            // Added key (structural addition)
            objNodes.push(
                createElement(
                    'span',
                    {
                        key,
                        style: {
                            backgroundColor: 'var(--color-success-bg)',
                            border: '1px dashed var(--color-success)',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            display: 'inline-block',
                            margin: '2px 0',
                        },
                    },
                    `${indent}  `,
                    createElement('span', { style: { color: 'var(--color-success)', fontWeight: 600 } }, `"${key}"`),
                    `: ${JSON.stringify(fuzzed[key])}${idx < allKeys.length - 1 ? ',' : ''}`
                )
            );
            // Append line break separately to keep markup clean
            objNodes.push('\n');
            return;
        }

        // Exists in both
        const valFuzzed = fuzzed[key];
        const valTemplate = template[key];

        objNodes.push(
            createElement(
                'span',
                { key },
                `${indent}  `,
                createElement('span', { style: { color: 'var(--accent-light)' } }, `"${key}"`),
                ': ',
                renderJsonDiff(valFuzzed, valTemplate, isMalicious, depth + 1),
                comma
            )
        );
    });

    objNodes.push(indent + '}');
    return createElement('span', null, ...objNodes);
}
