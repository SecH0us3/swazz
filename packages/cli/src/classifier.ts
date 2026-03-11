/**
 * Classifier — converts raw FuzzResult into Finding based on rules config.
 * Decides whether a result is a finding and assigns severity + ruleId.
 */

import type { FuzzResult } from '@swazz/core';
import type { RulesConfig, Severity, Finding } from './types.js';

const DEFAULT_IGNORE = [401, 403, 404, 405, 422, 429];

const DEFAULT_DEFAULTS: Record<string, Severity> = {
    '1xx': 'ignore',
    '2xx': 'ignore',
    '3xx': 'ignore',
    '4xx': 'error',
    '5xx': 'error',
    'timeout': 'error',
    'network_error': 'error',
};

function statusToRange(status: number): string {
    if (status === 0) return 'timeout';
    const hundred = Math.floor(status / 100);
    return `${hundred}xx`;
}

function ruleIdForResult(result: FuzzResult): string {
    if (result.status === 0) {
        return result.error?.includes('timed out') ? 'swazz/timeout' : 'swazz/network-error';
    }
    return `swazz/status-${result.status}`;
}

export class Classifier {
    private ignoreSet: Set<number>;
    private severity: Record<string, Severity>;
    private defaults: Record<string, Severity>;

    constructor(rules?: RulesConfig) {
        this.ignoreSet = new Set(rules?.ignore ?? DEFAULT_IGNORE);
        this.severity = rules?.severity ?? {};
        this.defaults = rules?.defaults ?? DEFAULT_DEFAULTS;
    }

    /**
     * Classify a FuzzResult. Returns a Finding if it's reportable, null if ignored.
     */
    classify(result: FuzzResult): Finding | null {
        const level = this.resolveLevel(result);
        if (level === 'ignore') return null;

        return {
            id: result.id,
            ruleId: ruleIdForResult(result),
            level,
            endpoint: result.endpoint,
            resolvedPath: result.resolvedPath,
            method: result.method,
            profile: result.profile,
            status: result.status,
            duration: result.duration,
            payload: result.payload,
            responseBody: result.responseBody,
            error: result.error,
            timestamp: result.timestamp,
        };
    }

    private resolveLevel(result: FuzzResult): Severity {
        const status = result.status;

        // 1. Explicit ignore list
        if (this.ignoreSet.has(status)) return 'ignore';

        // 2. Explicit severity for this status code
        const statusKey = String(status);
        if (statusKey in this.severity) {
            return this.severity[statusKey];
        }

        // 3. Defaults by range
        const range = status === 0
            ? (result.error?.includes('timed out') ? 'timeout' : 'network_error')
            : statusToRange(status);

        if (range in this.defaults) {
            return this.defaults[range];
        }

        // 4. Fallback
        return 'error';
    }
}
