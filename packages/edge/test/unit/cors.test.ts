// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import app from '../../src/index';
import type { Env } from '../../src/env';

describe('CORS Security Hardening', () => {
  const baseEnv: Env = {
    DB: {} as any,
    STORAGE: {} as any,
    COORDINATOR_DO: {} as any,
    JWT_SECRET: 'test-secret',
    NODE_ENV: 'test',
    SCAN_QUEUE: {} as any,
    FINDINGS_QUEUE: {} as any,
  };

  describe('when ALLOWED_ORIGINS is "*"', () => {
    const envWithWildcard: Env = {
      ...baseEnv,
      ALLOWED_ORIGINS: '*',
    };

    it('sets Access-Control-Allow-Origin to "*" and does NOT send credentials', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/version', {
          headers: { Origin: 'https://attacker.com' },
        }),
        envWithWildcard,
        {} as any
      );

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });

    it('does not send credentials on preflight OPTIONS requests', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/version', {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://attacker.com',
            'Access-Control-Request-Method': 'GET',
          },
        }),
        envWithWildcard,
        {} as any
      );

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });
  });

  describe('when ALLOWED_ORIGINS is configured with specific origins', () => {
    const envWithSpecificOrigin: Env = {
      ...baseEnv,
      ALLOWED_ORIGINS: 'https://swazz.secmy.app',
    };

    it('allows trusted origin and sends credentials: true', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/version', {
          headers: { Origin: 'https://swazz.secmy.app' },
        }),
        envWithSpecificOrigin,
        {} as any
      );

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://swazz.secmy.app');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('denies untrusted origin and does NOT send credentials: true or reflect origin', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/version', {
          headers: { Origin: 'https://evil.com' },
        }),
        envWithSpecificOrigin,
        {} as any
      );

      expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.com');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });

    it('never reflects untrusted origin on preflight OPTIONS', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/version', {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://malicious.org',
            'Access-Control-Request-Method': 'POST',
          },
        }),
        envWithSpecificOrigin,
        {} as any
      );

      expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://malicious.org');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });
  });
});
