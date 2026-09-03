// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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

    it('should categorize swazz/sql-error-leak with and without db match', () => {
        const withDb: AnalysisFinding = {
            ruleId: 'swazz/sql-error-leak',
            level: 'error',
            message: 'SQL error syntax (PostgreSQL) detected'
        };
        const resWithDb = categorizeFinding(withDb);
        expect(resWithDb.color).toBe('var(--color-error)');
        expect(resWithDb.title).toBe('SQLi Error: PostgreSQL');
        expect(resWithDb.key).toBe('sqli_postgresql');

        const withoutDb: AnalysisFinding = {
            ruleId: 'swazz/sql-error-leak',
            level: 'error',
            message: 'SQL error syntax'
        };
        const resWithoutDb = categorizeFinding(withoutDb);
        expect(resWithoutDb.title).toBe('SQLi Error: Generic');
        expect(resWithoutDb.key).toBe('sqli_generic');
    });

    it('should categorize swazz/null-pointer-exception without language match', () => {
        const finding: AnalysisFinding = {
            ruleId: 'swazz/null-pointer-exception',
            level: 'error',
            message: 'Null dereference detected'
        };
        const result = categorizeFinding(finding);
        expect(result.title).toBe('Null Reference Exception: Generic');
        expect(result.key).toBe('null_pointer_generic');
    });

    it('should categorize swazz/sensitive-data-leak with and without category match', () => {
        const withCat: AnalysisFinding = {
            ruleId: 'swazz/sensitive-data-leak',
            level: 'warning',
            message: 'Leaked API token (AWS Secret Key)'
        };
        const resWith = categorizeFinding(withCat);
        expect(resWith.color).toBe('var(--color-warning)');
        expect(resWith.title).toBe('Sensitive Data: AWS Secret Key');
        expect(resWith.key).toBe('sensitive_aws_secret_key');

        const withoutCat: AnalysisFinding = {
            ruleId: 'swazz/sensitive-data-leak',
            level: 'warning',
            message: 'Plain token leak'
        };
        const resWithout = categorizeFinding(withoutCat);
        expect(resWithout.title).toBe('Sensitive Data: Sensitive Data');
        expect(resWithout.key).toBe('sensitive_sensitive_data');
    });

    it('should handle stack-trace-leak without language match and non-NPE subtype', () => {
        const noLang: AnalysisFinding = {
            ruleId: 'swazz/stack-trace-leak',
            level: 'warning',
            message: 'Raw stack trace'
        };
        const resNoLang = categorizeFinding(noLang);
        expect(resNoLang.title).toBe('Stack Trace Leak: Generic');
        expect(resNoLang.key).toBe('stack_generic');

        const nonNpePreview = JSON.stringify({ exceptionType: 'CustomException', message: 'Something went wrong' });
        const resNonNpe = categorizeFinding(noLang, nonNpePreview);
        expect(resNonNpe.color).toBe('var(--color-warning)');
        expect(resNonNpe.key).toBe('stack_sub_customexception_something_went_wrong');
    });

    it('should categorize rate limiting rules', () => {
        const noRate: AnalysisFinding = {
            ruleId: 'swazz/no-rate-limit',
            level: 'warning',
            message: 'No rate limiting observed'
        };
        const resNo = categorizeFinding(noRate);
        expect(resNo.color).toBe('var(--color-warning)');
        expect(resNo.title).toBe('Missing Rate Limiting');
        expect(resNo.key).toBe('no_rate_limit');

        const rateActive: AnalysisFinding = {
            ruleId: 'swazz/rate-limit-active',
            level: 'note',
            message: 'Rate limit enforced'
        };
        const resActive = categorizeFinding(rateActive);
        expect(resActive.color).toBe('var(--color-info)');
        expect(resActive.title).toBe('Rate Limiting Enforced');
        expect(resActive.key).toBe('rate_limit_active');
    });

    it('should categorize authorization and OOB SSRF rules', () => {
        const bola: AnalysisFinding = {
            ruleId: 'swazz/bola-idor',
            level: 'error',
            message: 'Object level authorization issue'
        };
        const resBola = categorizeFinding(bola);
        expect(resBola.color).toBe('var(--color-error)');
        expect(resBola.title).toBe('BOLA / IDOR Vulnerability');
        expect(resBola.key).toBe('bola_idor');

        const unauth: AnalysisFinding = {
            ruleId: 'swazz/unauthorized-access',
            level: 'error',
            message: 'Unauth bypass'
        };
        const resUnauth = categorizeFinding(unauth);
        expect(resUnauth.color).toBe('var(--color-error)');
        expect(resUnauth.title).toBe('Unauthenticated Access Bypass');
        expect(resUnauth.key).toBe('unauthorized_access');

        const oob: AnalysisFinding = {
            ruleId: 'swazz/oob-interaction',
            level: 'error',
            message: 'SSRF DNS callback'
        };
        const resOob = categorizeFinding(oob);
        expect(resOob.color).toBe('var(--color-error)');
        expect(resOob.title).toBe('Out-of-Band Interaction (SSRF)');
        expect(resOob.key).toBe('oob_interaction');
    });

    it('should categorize unknown rules in the fallback branch', () => {
        const custom: AnalysisFinding = {
            ruleId: 'custom/proto-pollution',
            level: 'warning',
            message: 'Prototype pollution detected'
        };
        const resCustom = categorizeFinding(custom);
        expect(resCustom.color).toBe('var(--color-info)');
        expect(resCustom.title).toBe('Prototype pollution detected');
        expect(resCustom.key).toBe('other_custom_proto_pollution');

        const withoutMsg: AnalysisFinding = {
            ruleId: 'custom/unknown-anomaly',
            level: 'warning',
            message: ''
        };
        const resWithoutMsg = categorizeFinding(withoutMsg);
        expect(resWithoutMsg.title).toBe('Suspicious Anomaly');
        expect(resWithoutMsg.key).toBe('other_custom_unknown_anomaly');
    });
});
