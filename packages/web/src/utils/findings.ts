import type { AnalysisFinding } from '../types.js';
import { extractErrorSubtype, slugify } from './errors.js';

export interface FindingCategory {
    title: string;
    color: string;
    key: string;
}

export function categorizeFinding(f: AnalysisFinding, responsePreview?: string): FindingCategory {
    let title = 'Other Finding';
    let key = 'other';
    let color = 'var(--color-info)';

    if (f.ruleId === 'swazz/reflected-xss') {
        color = 'var(--color-error)';
        title = 'Reflected XSS';
        key = 'reflected_xss';
    } else if (f.ruleId === 'swazz/null-pointer-exception') {
        color = 'var(--color-error)';
        const langMatch = f.message?.match(/\(([^)]+)\)/);
        const lang = langMatch ? langMatch[1] : 'Generic';
        title = `Null Reference Exception: ${lang}`;
        key = `null_pointer_${slugify(lang)}`;
    } else if (f.ruleId === 'swazz/sql-error-leak') {
        color = 'var(--color-error)';
        const dbMatch = f.message?.match(/\(([^)]+)\)/);
        const dbName = dbMatch ? dbMatch[1] : 'Generic';
        title = `SQLi Error: ${dbName}`;
        key = `sqli_${dbName.toLowerCase()}`;
    } else if (f.ruleId === 'swazz/stack-trace-leak') {
        color = 'var(--color-warning)';
        
        if (responsePreview) {
            const subType = extractErrorSubtype(responsePreview);
            if (subType) {
                const isNPE = subType.key.includes('null_reference') || subType.key.includes('null_pointer');
                return {
                    title: subType.title,
                    key: `stack_sub_${subType.key}`,
                    color: isNPE ? 'var(--color-error)' : color,
                };
            }
        }

        const langMatch = f.message?.match(/\(([^)]+)\)/);
        const lang = langMatch ? langMatch[1] : 'Generic';
        title = `Stack Trace Leak: ${lang}`;
        key = `stack_${lang.toLowerCase()}`;
    } else if (f.ruleId === 'swazz/sensitive-data-leak') {
        color = 'var(--color-warning)';
        const catMatch = f.message?.match(/\(([^)]+)\)/);
        const catName = catMatch ? catMatch[1] : 'Sensitive Data';
        title = `Sensitive Data: ${catName}`;
        key = `sensitive_${slugify(catName)}`;
    } else if (f.ruleId === 'swazz/crlf-injection') {
        color = 'var(--color-error)';
        title = 'CRLF / Header Injection';
        key = 'crlf_injection';
    } else if (f.ruleId === 'swazz/cors-misconfig' || f.ruleId === 'swazz/header-injection') {
        color = 'var(--color-warning)';
        title = 'CORS Misconfiguration';
        key = 'cors_misconfig';
    } else if (f.ruleId === 'swazz/response-size-anomaly') {
        color = 'var(--color-warning)';
        title = 'Response Size Anomaly';
        key = 'response_size_anomaly';
    } else if (f.ruleId === 'swazz/no-rate-limit') {
        color = 'var(--color-warning)';
        title = 'Missing Rate Limiting';
        key = 'no_rate_limit';
    } else if (f.ruleId === 'swazz/rate-limit-active') {
        color = 'var(--color-info)';
        title = 'Rate Limiting Enforced';
        key = 'rate_limit_active';
    } else if (f.ruleId === 'swazz/bola-idor') {
        color = 'var(--color-error)';
        title = 'BOLA / IDOR Vulnerability';
        key = 'bola_idor';
    } else if (f.ruleId === 'swazz/unauthorized-access') {
        color = 'var(--color-error)';
        title = 'Unauthenticated Access Bypass';
        key = 'unauthorized_access';
    } else if (f.ruleId === 'swazz/time-based-sqli') {
        color = 'var(--color-error)';
        title = 'Time-Based SQLi';
        key = 'time_based_sqli';
    } else if (f.ruleId === 'swazz/time-based-cmdi') {
        color = 'var(--color-error)';
        title = 'Time-Based Cmd Injection';
        key = 'time_based_cmdi';
    } else {
        title = f.message || 'Suspicious Anomaly';
        key = `other_${slugify(f.ruleId)}`;
    }

    return { title, color, key };
}
