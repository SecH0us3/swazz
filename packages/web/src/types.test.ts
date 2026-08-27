// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from './types.js';

describe('DEFAULT_SETTINGS', () => {
    it('has max_payload_size_bytes set to 10MB (10485760)', () => {
        expect(DEFAULT_SETTINGS.max_payload_size_bytes).toBe(10485760);
    });

    it('has standard sensible defaults matching Go engine', () => {
        expect(DEFAULT_SETTINGS.iterations_per_profile).toBe(10);
        expect(DEFAULT_SETTINGS.concurrency).toBe(2);
        expect(DEFAULT_SETTINGS.profiles).toEqual(['RANDOM', 'BOUNDARY', 'MALICIOUS']);
    });
});
