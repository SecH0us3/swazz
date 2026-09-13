// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLicenseStatus,
  fetchTrialStatus,
  activateLicense,
  deactivateLicense,
  claimTrialLicense,
  verifyLicenseKey,
  normalizeLicenseKey,
} from './licenseService.js';
import { useAppStore } from '../store/appStore.js';

describe('licenseService', () => {
  let originalFetch: typeof globalThis.fetch;
  let storeMock: Record<string, string> = {};

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    storeMock = {};
    const localStorageMock = {
      getItem: vi.fn((key: string) => storeMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        storeMock[key] = value.toString();
      }),
      clear: vi.fn(() => {
        storeMock = {};
      }),
      removeItem: vi.fn((key: string) => {
        delete storeMock[key];
      }),
      length: 0,
      key: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);
    useAppStore.setState({ csrfToken: null });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('normalizeLicenseKey', () => {
    it('returns raw JWT unchanged', () => {
      const jwt = 'eyJhbGciOiJFZERTQSI.eyJjb21wYW55IjoiVGVzdCJ9.signature';
      expect(normalizeLicenseKey(jwt)).toBe(jwt);
    });

    it('strips SWAZZ_LICENSE_KEY: prefix', () => {
      const jwt = 'eyJhbGciOiJFZERTQSI.eyJjb21wYW55IjoiVGVzdCJ9.signature';
      expect(normalizeLicenseKey(`SWAZZ_LICENSE_KEY: ${jwt}`)).toBe(jwt);
    });

    it('extracts JWT from multiline block', () => {
      const jwt = 'eyJhbGciOiJFZERTQSI.eyJjb21wYW55IjoiVGVzdCJ9.signature';
      const input = `# Some comments\nexport SWAZZ_LICENSE_KEY="${jwt}"\n# end`;
      expect(normalizeLicenseKey(input)).toBe(jwt);
    });

    it('trims whitespace', () => {
      const jwt = 'eyJhbGciOiJFZERTQSI.eyJjb21wYW55IjoiVGVzdCJ9.signature';
      expect(normalizeLicenseKey(`  \n  ${jwt}  \n  `)).toBe(jwt);
    });

    it('returns trimmed input if not JWT', () => {
      expect(normalizeLicenseKey('   some-plain-string   ')).toBe('some-plain-string');
    });

    it('returns empty string for empty or nullish input', () => {
      expect(normalizeLicenseKey('')).toBe('');
      expect(normalizeLicenseKey(null as unknown as string)).toBe('');
    });
  });

  describe('fetchLicenseStatus', () => {
    it('fetches status with auth header and credentials', async () => {
      storeMock['swazz_token'] = 'test-token';
      const mockData = {
        status: 'active',
        license: {
          company: 'Acme Corp',
          expires_at: '2027-01-01T00:00:00Z',
          features: ['*'],
          kind: 'commercial',
        },
      };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      const res = await fetchLicenseStatus();
      expect(res).toEqual(mockData);
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user/license', {
        headers: { Authorization: 'Bearer test-token' },
        credentials: 'include',
      });
    });

    it('throws on non-ok status', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      );

      await expect(fetchLicenseStatus()).rejects.toThrow('Unauthorized');
    });
  });

  describe('fetchTrialStatus', () => {
    it('fetches trial status successfully', async () => {
      storeMock['swazz_token'] = 'test-token';
      const mockData = { claimed: false, claimed_at: null, can_claim: true };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      const res = await fetchTrialStatus();
      expect(res).toEqual(mockData);
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user/trial-status', {
        headers: { Authorization: 'Bearer test-token' },
        credentials: 'include',
      });
    });
  });

  describe('activateLicense', () => {
    it('sends POST request with normalized key and CSRF token', async () => {
      storeMock['swazz_token'] = 'test-token';
      useAppStore.setState({ csrfToken: 'csrf-123' });
      const mockLicense = { company: 'Acme Corp', expires_at: '2027-01-01T00:00:00Z', features: ['*'], kind: 'commercial' };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ license: mockLicense }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      const res = await activateLicense('   eyJhbGciOiJFZERTQSI.eyJjb21wYW55IjoiQWNtZSJ9.sig   ');
      expect(res).toEqual({ license: mockLicense });
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user/license', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'X-CSRF-Token': 'csrf-123',
        },
        credentials: 'include',
        body: JSON.stringify({ license_key: 'eyJhbGciOiJFZERTQSI.eyJjb21wYW55IjoiQWNtZSJ9.sig' }),
      });
    });

    it('throws with server error message on failure', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Invalid license key' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      );

      await expect(activateLicense('invalid-key')).rejects.toThrow('Invalid license key');
    });
  });

  describe('deactivateLicense', () => {
    it('sends DELETE request with headers', async () => {
      storeMock['swazz_token'] = 'test-token';
      useAppStore.setState({ csrfToken: 'csrf-123' });
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      await deactivateLicense();
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user/license', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer test-token',
          'X-CSRF-Token': 'csrf-123',
        },
        credentials: 'include',
      });
    });
  });

  describe('claimTrialLicense', () => {
    it('sends POST request to /api/user/trial-license', async () => {
      storeMock['swazz_token'] = 'test-token';
      const mockResult = {
        license: { company: 'Swazz (14-Day Trial)', expires_at: '2026-09-24T00:00:00Z', features: ['*'], kind: 'trial' },
        token: 'trial-jwt',
      };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResult), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      const res = await claimTrialLicense();
      expect(res).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user/trial-license', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        credentials: 'include',
      });
    });
  });



  describe('verifyLicenseKey', () => {
    it('returns valid: true with license on success', async () => {
      const mockLicense = { company: 'Acme Corp', expires_at: '2027-01-01T00:00:00Z', features: ['*'], kind: 'commercial' };
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ valid: true, license: mockLicense }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await verifyLicenseKey('eyJhbGciOiJFZERTQSI.test.sig');
      expect(res).toEqual({ valid: true, license: mockLicense });
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/license/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: 'eyJhbGciOiJFZERTQSI.test.sig' }),
      });
    });

    it('returns valid: false on 400 with error message', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ valid: false, error: 'invalid signature' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await verifyLicenseKey('invalid-key');
      expect(res).toEqual({ valid: false, error: 'invalid signature' });
    });
  });
});
