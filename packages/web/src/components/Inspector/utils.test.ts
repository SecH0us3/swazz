// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import {
    getStatusClass,
    getBadgeClass,
    formatBytes,
    formatTime,
    formatIdentityName,
    isTruePositiveVerdict
} from './utils.js';

describe('Inspector utils', () => {
    describe('isTruePositiveVerdict', () => {
        it('handles boolean values', () => {
            expect(isTruePositiveVerdict(true)).toBe(true);
            expect(isTruePositiveVerdict(false)).toBe(false);
        });

        it('handles string variants of True Positive', () => {
            expect(isTruePositiveVerdict('True Positive')).toBe(true);
            expect(isTruePositiveVerdict('true positive')).toBe(true);
            expect(isTruePositiveVerdict('TRUE POSITIVE')).toBe(true);
            expect(isTruePositiveVerdict('true_positive')).toBe(true);
            expect(isTruePositiveVerdict('TRUE_POSITIVE')).toBe(true);
            expect(isTruePositiveVerdict('true')).toBe(true);
            expect(isTruePositiveVerdict('TRUE')).toBe(true);
            expect(isTruePositiveVerdict('tp')).toBe(true);
            expect(isTruePositiveVerdict('TP')).toBe(true);
        });

        it('handles string variants of False Positive', () => {
            expect(isTruePositiveVerdict('False Positive')).toBe(false);
            expect(isTruePositiveVerdict('false positive')).toBe(false);
            expect(isTruePositiveVerdict('false_positive')).toBe(false);
            expect(isTruePositiveVerdict('false')).toBe(false);
            expect(isTruePositiveVerdict('fp')).toBe(false);
        });

        it('handles undefined, null, and empty/unrecognized values', () => {
            expect(isTruePositiveVerdict(undefined)).toBe(false);
            expect(isTruePositiveVerdict('')).toBe(false);
            expect(isTruePositiveVerdict('unknown')).toBe(false);
        });
    });

    describe('getStatusClass', () => {
        it('returns correct class for 5xx and 0', () => {
            expect(getStatusClass(500)).toBe('status-5xx');
            expect(getStatusClass(502)).toBe('status-5xx');
            expect(getStatusClass(0)).toBe('status-5xx');
        });

        it('returns correct class for 4xx', () => {
            expect(getStatusClass(400)).toBe('status-4xx');
            expect(getStatusClass(404)).toBe('status-4xx');
        });

        it('returns empty string for 2xx/3xx', () => {
            expect(getStatusClass(200)).toBe('');
            expect(getStatusClass(302)).toBe('');
        });
    });

    describe('getBadgeClass', () => {
        it('returns badge-error for 5xx and 0', () => {
            expect(getBadgeClass(500)).toBe('badge badge-error');
            expect(getBadgeClass(0)).toBe('badge badge-error');
        });

        it('returns badge-warning for 4xx', () => {
            expect(getBadgeClass(404)).toBe('badge badge-warning');
        });

        it('returns badge-success for 2xx', () => {
            expect(getBadgeClass(200)).toBe('badge badge-success');
            expect(getBadgeClass(204)).toBe('badge badge-success');
        });

        it('returns default badge for others', () => {
            expect(getBadgeClass(302)).toBe('badge');
        });
    });

    describe('formatBytes', () => {
        it('formats zero/falsy bytes', () => {
            expect(formatBytes(0)).toBe('0 B');
        });

        it('formats bytes, KB, MB', () => {
            expect(formatBytes(500)).toBe('500 B');
            expect(formatBytes(1024)).toBe('1 KB');
            expect(formatBytes(1048576)).toBe('1 MB');
        });
    });

    describe('formatTime', () => {
        it('formats timestamp with milliseconds', () => {
            const time = formatTime(1600000000000);
            expect(time).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
        });
    });

    describe('formatIdentityName', () => {
        it('formats special identities', () => {
            expect(formatIdentityName('user a')).toBe('User A (Primary)');
            expect(formatIdentityName('USER B')).toBe('User B');
            expect(formatIdentityName('anonymous')).toBe('Anonymous');
            expect(formatIdentityName('userC')).toBe('User C');
            expect(formatIdentityName('custom_role')).toBe('custom_role');
        });
    });
});
