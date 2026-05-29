import { describe, it, expect } from 'vitest';
import { categorizeFinding } from './findings.js';
import type { AnalysisFinding } from '../types.js';

describe('findings utility', () => {
    it('should categorize reflected-xss finding correctly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/reflected-xss',
            level: 'error',
            message: 'Reflected XSS query param'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('Reflected XSS');
        expect(result.key).toBe('reflected_xss');
    });

    it('should categorize generic stack-trace-leak finding if no preview is given', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/stack-trace-leak',
            level: 'warning',
            message: 'Stack trace leak (.NET)'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-warning)');
        expect(result.title).toBe('Stack Trace Leak: .NET');
        expect(result.key).toBe('stack_.net');
    });

    it('should sub-categorize stack-trace-leak finding using responsePreview and detect Null Reference Exception with error severity', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/stack-trace-leak',
            level: 'warning',
            message: 'Stack trace leak (.NET)'
        };
        const preview = JSON.stringify({
            exceptionType: 'apierror',
            message: 'System.NullReferenceException: Object reference not set to an instance of an object.\n   at Bank.Cards.API...'
        });
        const result = categorizeFinding(finding, preview);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('Null Reference Exception');
        expect(result.key).toBe('stack_sub_null_reference_exception');
    });

    it('should categorize swazz/null-pointer-exception rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/null-pointer-exception',
            level: 'error',
            message: 'Null Reference / Pointer Exception (Go) detected'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('Null Reference Exception: Go');
        expect(result.key).toBe('null_pointer_go');
    });
});
