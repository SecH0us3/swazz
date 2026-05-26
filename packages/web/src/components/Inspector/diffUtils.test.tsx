import { describe, it, expect } from 'vitest';
import { generateTemplateFromSchema, parseQueryParams, renderJsonDiff } from './diffUtils.js';
import type { SchemaProperty } from '../../types.js';

describe('diffUtils', () => {
    describe('generateTemplateFromSchema', () => {
        it('should generate template for primitive types', () => {
            const stringSchema: SchemaProperty = { type: 'string' };
            const numberSchema: SchemaProperty = { type: 'number' };
            const booleanSchema: SchemaProperty = { type: 'boolean' };

            expect(generateTemplateFromSchema(stringSchema)).toBe('string');
            expect(generateTemplateFromSchema(numberSchema)).toBe(0);
            expect(generateTemplateFromSchema(booleanSchema)).toBe(false);
        });

        it('should handle enum and formats', () => {
            const enumSchema: SchemaProperty = { type: 'string', enum: ['first', 'second'] };
            const emailSchema: SchemaProperty = { type: 'string', format: 'email' };
            const uuidSchema: SchemaProperty = { type: 'string', format: 'uuid' };

            expect(generateTemplateFromSchema(enumSchema)).toBe('first');
            expect(generateTemplateFromSchema(emailSchema)).toBe('user@example.com');
            expect(generateTemplateFromSchema(uuidSchema)).toBe('00000000-0000-0000-0000-000000000000');
        });

        it('should generate templates for deep objects and arrays', () => {
            const schema: SchemaProperty = {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    roles: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    profile: {
                        type: 'object',
                        properties: {
                            age: { type: 'integer' }
                        }
                    }
                }
            };

            const expected = {
                id: '00000000-0000-0000-0000-000000000000',
                name: 'string',
                roles: ['string'],
                profile: {
                    age: 0
                }
            };

            expect(generateTemplateFromSchema(schema)).toEqual(expected);
        });
    });

    describe('parseQueryParams', () => {
        it('should parse query params correctly from resolved path', () => {
            const path = '/api/v1/users?search=fuzz&limit=10&active=true';
            const expected = {
                search: 'fuzz',
                limit: '10',
                active: 'true'
            };
            expect(parseQueryParams(path)).toEqual(expected);
        });

        it('should return empty object if no query params', () => {
            expect(parseQueryParams('/api/v1/users')).toEqual({});
            expect(parseQueryParams('/api/v1/users?')).toEqual({});
        });
    });

    describe('renderJsonDiff', () => {
        it('should render standard primitive values without mutations', () => {
            const node = renderJsonDiff('hello', 'hello', false);
            expect(typeof node).toBe('object');
            const element = node as any;
            expect(element.props.style.color).toBe('var(--color-success)');
            expect(element.props.children).toBe('"hello"');
        });

        it('should detect mutations for boundary/random profiles', () => {
            const node = renderJsonDiff('mutated', 'original', false);
            const element = node as any;
            expect(element.props.style.backgroundColor).toBe('var(--color-warning-bg)');
            expect(element.props.style.color).toBe('var(--color-warning)');
            expect(element.props.children).toBe('"mutated"');
        });

        it('should detect mutations for malicious profiles', () => {
            const node = renderJsonDiff('mutated', 'original', true);
            const element = node as any;
            expect(element.props.style.backgroundColor).toBe('var(--color-error-bg)');
            expect(element.props.style.color).toBe('var(--color-error)');
            expect(element.props.children).toBe('"mutated"');
        });
    });

    describe('generateTemplateFromSchema - Edge Cases', () => {
        it('should handle undefined schema', () => {
            expect(generateTemplateFromSchema(undefined)).toBeUndefined();
        });

        it('should handle date-time format', () => {
            const schema: SchemaProperty = { type: 'string', format: 'date-time' };
            expect(generateTemplateFromSchema(schema)).toBe('2026-05-26T21:30:00Z');
        });

        it('should handle integer type', () => {
            const schema: SchemaProperty = { type: 'integer' };
            expect(generateTemplateFromSchema(schema)).toBe(0);
        });

        it('should handle array without items', () => {
            const schema: SchemaProperty = { type: 'array' };
            expect(generateTemplateFromSchema(schema)).toEqual([]);
        });

        it('should handle object without properties', () => {
            const schema: SchemaProperty = { type: 'object' };
            expect(generateTemplateFromSchema(schema)).toEqual({});
        });

        it('should handle empty enum array', () => {
            const schema: SchemaProperty = { type: 'string', enum: [] };
            expect(generateTemplateFromSchema(schema)).toBe('string');
        });

        it('should fallback to object if properties is present but type is omitted', () => {
            const schema: any = {
                properties: {
                    name: { type: 'string' }
                }
            };
            expect(generateTemplateFromSchema(schema)).toEqual({ name: 'string' });
        });

        it('should fallback to empty string if type is unknown and no properties', () => {
            const schema: any = { type: 'unknown' };
            expect(generateTemplateFromSchema(schema)).toBe('');
        });

        it('should terminate recursion on recursive schemas', () => {
            const schema: any = {
                type: 'object',
                properties: {}
            };
            schema.properties.self = schema; // recursive reference
            const result = generateTemplateFromSchema(schema);
            expect(result).toBeDefined();
            expect(result.self).toBeDefined();
            
            // Traverse down 11 levels
            let current = result;
            for (let i = 0; i < 11; i++) {
                if (current) current = current.self;
            }
            expect(current).toBeUndefined(); // Recursion stops at depth limit 10
        });
    });

    describe('renderJsonDiff - Complex Data & Edge Cases', () => {
        it('should handle undefined fuzzed value', () => {
            const node = renderJsonDiff(undefined, 'template', false) as any;
            expect(node.props.children).toBe('undefined');
            expect(node.props.style.color).toBe('var(--text-disabled)');
        });

        it('should handle type mismatches', () => {
            const node = renderJsonDiff(123, '123', false) as any;
            expect(node.props.style.backgroundColor).toBe('var(--color-warning-bg)');
            expect(node.props.children).toBe('123');
        });

        it('should handle null mismatches', () => {
            const node1 = renderJsonDiff(null, 'hello', false) as any;
            expect(node1.props.style.backgroundColor).toBe('var(--color-warning-bg)');
            expect(node1.props.children).toBe('null');

            const node2 = renderJsonDiff('hello', null, false) as any;
            expect(node2.props.style.backgroundColor).toBe('var(--color-warning-bg)');
            expect(node2.props.children).toBe('"hello"');
        });

        it('should style numbers and booleans correctly', () => {
            const numNode = renderJsonDiff(42, 42, false) as any;
            expect(numNode.props.style.color).toBe('var(--color-warning)');
            expect(numNode.props.children).toBe('42');

            const boolNode = renderJsonDiff(true, true, false) as any;
            expect(boolNode.props.style.color).toBe('var(--color-warning)');
            expect(boolNode.props.children).toBe('true');
        });

        it('should style null values correctly when not mutated', () => {
            const node = renderJsonDiff(null, null, false) as any;
            expect(node.props.style.color).toBe('var(--color-error)');
            expect(node.props.children).toBe('null');
        });

        it('should handle array mismatches and empty arrays', () => {
            const nodeMismatch = renderJsonDiff([1, 2], 'not-array', false) as any;
            expect(nodeMismatch.props.style.backgroundColor).toBe('var(--color-warning-bg)');

            const nodeObjVsArrMismatch = renderJsonDiff({ a: 1 }, [1, 2], false) as any;
            expect(nodeObjVsArrMismatch.props.style.backgroundColor).toBe('var(--color-warning-bg)');

            const nodeEmpty = renderJsonDiff([], [], false) as any;
            expect(nodeEmpty.props.children).toBe('[]');
        });

        it('should render and format populated arrays recursively', () => {
            const node = renderJsonDiff([1, 2], [1, 2], false) as any;
            expect(node.props.children).toContain('[\n');
            expect(node.props.children).toContain(']');
        });

        it('should handle fuzzed array being longer than template array', () => {
            const node = renderJsonDiff([1, 2], [1], false) as any;
            expect(node.props.children).toBeDefined();
        });

        it('should handle empty objects', () => {
            const node = renderJsonDiff({}, {}, false) as any;
            expect(node.props.children).toBe('{}');
        });

        it('should render deleted keys with line-through decoration', () => {
            const node = renderJsonDiff({}, { deletedKey: 'value' }, false) as any;
            const childSpan = node.props.children[1];
            expect(childSpan.props.style.textDecoration).toBe('line-through');
            expect(childSpan.props.style.color).toBe('var(--text-disabled)');
        });

        it('should render added keys with success background', () => {
            const node = renderJsonDiff({ addedKey: 'value' }, {}, false) as any;
            const childSpan = node.props.children[1];
            expect(childSpan.props.style.backgroundColor).toBe('var(--color-success-bg)');
        });

        it('should render shared keys with same value', () => {
            const node = renderJsonDiff({ key: 'val' }, { key: 'val' }, false) as any;
            const childSpan = node.props.children[1];
            const keySpan = childSpan.props.children[1];
            expect(keySpan.props.style.color).toBe('var(--accent-light)');
        });
    });
});
