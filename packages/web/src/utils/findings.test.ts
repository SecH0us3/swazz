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

    it('should categorize swazz/crlf-injection rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/crlf-injection',
            level: 'error',
            message: 'CRLF injection in header'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('CRLF / Header Injection');
        expect(result.key).toBe('crlf_injection');
    });

    it('should categorize swazz/cors-misconfig and swazz/header-injection rules directly', () => {
        const findingCors: AnalysisFinding = {
            ruleId: 'swazz/cors-misconfig',
            level: 'warning',
            message: 'CORS wildcard Origin'
        };
        const resultCors = categorizeFinding(findingCors);
        expect(resultCors.color).toBe('var(--color-warning)');
        expect(resultCors.title).toBe('CORS Misconfiguration');
        expect(resultCors.key).toBe('cors_misconfig');

        const findingHeader: AnalysisFinding = {
            ruleId: 'swazz/header-injection',
            level: 'warning',
            message: 'CORS origin reflection'
        };
        const resultHeader = categorizeFinding(findingHeader);
        expect(resultHeader.color).toBe('var(--color-warning)');
        expect(resultHeader.title).toBe('CORS Misconfiguration');
        expect(resultHeader.key).toBe('cors_misconfig');
    });

    it('should categorize swazz/response-size-anomaly rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/response-size-anomaly',
            level: 'warning',
            message: 'Response size is significantly larger'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-warning)');
        expect(result.title).toBe('Response Size Anomaly');
        expect(result.key).toBe('response_size_anomaly');
    });

    it('should categorize swazz/time-based-sqli rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/time-based-sqli',
            level: 'error',
            message: 'Time-Based SQLi detected'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('Time-Based SQLi');
        expect(result.key).toBe('time_based_sqli');
    });

    it('should categorize swazz/time-based-cmdi rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/time-based-cmdi',
            level: 'error',
            message: 'Time-Based Cmd Injection detected'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('Time-Based Cmd Injection');
        expect(result.key).toBe('time_based_cmdi');
    });

    it('should categorize swazz/path-traversal-leak rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/path-traversal-leak',
            level: 'error',
            message: 'Path Traversal detected'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('Path Traversal / File Inclusion');
        expect(result.key).toBe('path_traversal_leak');
    });

    it('should categorize swazz/cmdi-leak rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/cmdi-leak',
            level: 'error',
            message: 'OS Command Injection detected'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('OS Command Injection');
        expect(result.key).toBe('cmdi_leak');
    });

    it('should categorize swazz/ssti-leak rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/ssti-leak',
            level: 'error',
            message: 'SSTI detected'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('Server-Side Template Injection (SSTI)');
        expect(result.key).toBe('ssti_leak');
    });

    it('should categorize swazz/xxe-leak rule directly', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/xxe-leak',
            level: 'error',
            message: 'XXE detected'
        };
        const result = categorizeFinding(finding);
        expect(result.color).toBe('var(--color-error)');
        expect(result.title).toBe('XML External Entity (XXE)');
        expect(result.key).toBe('xxe_leak');
    });
});
