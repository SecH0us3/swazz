// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWafCheck } from '../../../src/services/wafCheck';
import { Env } from '../../../src/env';

describe('runWafCheck service', () => {
  let mockEnv: Env;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockEnv = {} as Env;
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Legacy fallback path (when /api/audit fails or is unsupported)', () => {
    it('handles not-detected path (no check/patch calls made)', async () => {
      // 1. Audit fails (500) -> triggers fallback
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: false,
            wafType: 'None',
            confidence: 0,
            evidence: [],
          },
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.detection.detected).toBe(false);
      expect(result.recommendation).toContain('No Web Application Firewall was detected');
      expect(result.sensitiveFiles).toBeUndefined();
      expect(result.patches).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://waf.secmy.app/api/waf-detect?url=https%3A%2F%2Fexample.com',
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    it('handles detected path with single-page results', async () => {
      // 1. Audit fails (500) -> triggers fallback
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidence: 0.95,
            evidence: ['cf-ray header'],
          },
        }),
      });

      // 3. Check (single page with 5 items < 50)
      const mockItems = [
        { category: 'Sensitive Files', payload: '/.env', method: 'GET', status: 200, responseTime: 120 },
        { category: 'Sensitive Files', payload: '/.git', method: 'GET', status: 403, responseTime: 110 },
        { category: 'Sensitive Files', payload: '/wp-config.php', method: 'GET', status: 404, responseTime: 105 },
        { category: 'Sensitive Files', payload: '/config.json', method: 'GET', status: 404, responseTime: 95 },
        { category: 'Sensitive Files', payload: '/.aws/credentials', method: 'GET', status: 404, responseTime: 100 },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItems,
      });

      // 4. Virtual Patch
      const mockPatches = {
        targetUrl: 'https://example.com',
        generatedAt: '2026-09-04T12:00:00Z',
        totalBypasses: 1,
        bundles: {
          cloudflare: { vendor: 'cloudflare', native: 'rule', ruleCount: 1 },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPatches,
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.detection.detected).toBe(true);
      expect(result.detection.wafType).toBe('Cloudflare');
      expect(result.sensitiveFiles).toEqual({
        total: 5,
        results: mockItems,
      });
      expect(result.patches).toEqual(mockPatches);
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify virtual-patch payload
      expect(mockFetch).toHaveBeenNthCalledWith(
        4,
        'https://waf.secmy.app/api/virtual-patch',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            results: mockItems,
            options: { vendor: 'all', targetUrl: 'https://example.com', includeTerraform: true, includeMisses: true },
          }),
        })
      );
    });

    it('handles detected path requiring pagination and merges all pages', async () => {
      // 1. Audit fails (500) -> triggers fallback
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'AWS WAF',
            confidence: 0.88,
            evidence: ['x-amzn-requestid'],
          },
        }),
      });

      // 3. Page 0 (50 items)
      const page0Items = Array.from({ length: 50 }, (_, i) => ({
        category: 'Sensitive Files',
        payload: `/.env.${i}`,
        method: 'GET',
        status: 200,
        responseTime: 100,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => page0Items,
      });

      // 4. Page 1 (22 items < 50)
      const page1Items = Array.from({ length: 22 }, (_, i) => ({
        category: 'Sensitive Files',
        payload: `/secret.${i}`,
        method: 'GET',
        status: 403,
        responseTime: 100,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => page1Items,
      });

      // 5. Virtual patch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 50,
          bundles: {},
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.sensitiveFiles?.total).toBe(72);
      expect(result.sensitiveFiles?.results).toHaveLength(72);
      expect(result.sensitiveFiles?.results[0].payload).toBe('/.env.0');
      expect(result.sensitiveFiles?.results[50].payload).toBe('/secret.0');
      expect(mockFetch).toHaveBeenCalledTimes(5);

      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('page=0'),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('page=1'),
        expect.anything()
      );
    });

    it('propagates failing detect call as an error', async () => {
      // 1. Audit fails (500) -> triggers fallback
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Upstream WAF checker failed' }),
      });

      await expect(runWafCheck(mockEnv, 'https://example.com')).rejects.toThrow(
        'WAF check failed: Upstream WAF checker failed|502'
      );
    });

    it('handles failing check call mid-pagination by returning what was accumulated so far', async () => {
      // 1. Audit fails (500) -> triggers fallback
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidence: 0.9,
            evidence: [],
          },
        }),
      });

      // 3. Page 0 succeeds (50 items)
      const page0Items = Array.from({ length: 50 }, (_, i) => ({
        category: 'Sensitive Files',
        payload: `/leak.${i}`,
        method: 'GET',
        status: 200,
        responseTime: 100,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => page0Items,
      });

      // 4. Page 1 fails mid-pagination
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({ error: 'Gateway timeout' }),
      });

      // 5. Virtual patch still gets called with the 50 accumulated items
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 50,
          bundles: { cloudflare: { vendor: 'cloudflare', native: 'rule', ruleCount: 1 } },
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.sensitiveFiles?.total).toBe(50);
      expect(result.sensitiveFiles?.results).toHaveLength(50);
      expect(result.patches).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('respects custom WAF_CHECKER_URL environment variable', async () => {
      const customEnv = { WAF_CHECKER_URL: 'https://custom-checker.internal/' } as Env;

      // 1. Audit fails (500)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: false,
            wafType: 'None',
            confidence: 0,
            evidence: [],
          },
        }),
      });

      await runWafCheck(customEnv, 'https://example.com');

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://custom-checker.internal/api/waf-detect?url=https%3A%2F%2Fexample.com',
        expect.anything()
      );
    });

    it('handles envelope pagination and stops when hasMore is false', async () => {
      // 1. Audit fails (500) -> triggers fallback
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidence: 95,
            evidence: [],
          },
        }),
      });

      // 3. Page 0 with envelope (hasMore: true)
      const page0Items = Array.from({ length: 10 }, (_, i) => ({
        category: 'Sensitive Files',
        payload: `/.env.${i}`,
        method: 'GET',
        status: 200,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: page0Items,
          page: 0,
          pageSize: 10,
          total: 15,
          hasMore: true,
        }),
      });

      // 4. Page 1 with envelope (hasMore: false)
      const page1Items = Array.from({ length: 5 }, (_, i) => ({
        category: 'Sensitive Files',
        payload: `/secret.${i}`,
        method: 'GET',
        status: 403,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: page1Items,
          page: 1,
          pageSize: 10,
          total: 15,
          hasMore: false,
        }),
      });

      // 5. Virtual patch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 15,
          bundles: {},
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.sensitiveFiles?.total).toBe(15);
      expect(result.sensitiveFiles?.results).toHaveLength(15);
      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('envelope=1'),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('envelope=1'),
        expect.anything()
      );
    });

    it('handles bare-array pagination via legacy length < 50 rule', async () => {
      // 1. Audit fails (500) -> triggers fallback
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit unsupported' }),
      });

      // 2. Detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidence: 90,
            evidence: [],
          },
        }),
      });

      // 3. Single bare array with 10 items (< 50)
      const bareItems = Array.from({ length: 10 }, (_, i) => ({
        category: 'Sensitive Files',
        payload: `/.file.${i}`,
        method: 'GET',
        status: 200,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => bareItems,
      });

      // 4. Virtual patch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 10,
          bundles: {},
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.sensitiveFiles?.total).toBe(10);
      expect(result.sensitiveFiles?.results).toHaveLength(10);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('Confidence normalization', () => {
    it('prefers confidencePercent over raw out-of-range confidence', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidence: 160,
            confidencePercent: 100,
            evidence: [],
          },
          results: [],
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 0,
          bundles: {},
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');
      expect(result.detection.confidence).toBe(100);
    });
  });

  describe('Field passthrough', () => {
    it('passes through blocked, verdict, and error untouched', async () => {
      const mockResultItems = [
        {
          category: 'Sensitive Files',
          method: 'GET',
          status: 403,
          payload: '/.git/HEAD',
          blocked: true,
          verdict: 'blocked' as const,
          error: null,
          responseTime: 50,
        },
        {
          category: 'Sensitive Files',
          method: 'GET',
          status: null,
          payload: '/.env',
          blocked: false,
          verdict: 'passed' as const,
          error: 'timeout',
          responseTime: 1000,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidencePercent: 95,
            evidence: [],
          },
          results: mockResultItems,
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 1,
          bundles: {},
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');
      expect(result.sensitiveFiles?.results).toEqual(mockResultItems);
      expect(result.sensitiveFiles?.results[0].blocked).toBe(true);
      expect(result.sensitiveFiles?.results[0].verdict).toBe('blocked');
      expect(result.sensitiveFiles?.results[0].error).toBeNull();
      expect(result.sensitiveFiles?.results[1].status).toBeNull();
      expect(result.sensitiveFiles?.results[1].error).toBe('timeout');
      expect(result.sensitiveFiles?.results[1].verdict).toBe('passed');
    });
  });

  describe('Primary path (/api/audit)', () => {
    it('happy path: uses /api/audit without calling /api/waf-detect and returns audit results', async () => {
      const mockAuditResults = [
        { category: 'Sensitive Files', method: 'GET', status: 200, payload: '/.env', verdict: 'exposed' as const, blocked: false },
        { category: 'Sensitive Files', method: 'GET', status: 403, payload: '/.git', verdict: 'blocked' as const, blocked: true },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidencePercent: 92,
            confidenceThreshold: 50,
            evidence: ['cf-ray'],
          },
          results: mockAuditResults,
          patches: {
            marker: 'audit-patches-marker',
          },
        }),
      });

      const mockPatches = {
        targetUrl: 'https://example.com',
        generatedAt: '2026-09-04T12:00:00Z',
        totalBypasses: 1,
        bundles: {
          cloudflare: { vendor: 'cloudflare', native: 'rule', ruleCount: 1 },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPatches,
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://waf.secmy.app/api/audit?url=https%3A%2F%2Fexample.com&categories=Sensitive%20Files',
        expect.objectContaining({ signal: expect.anything() })
      );
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/waf-detect'),
        expect.anything()
      );
      expect(result.detection.detected).toBe(true);
      expect(result.detection.wafType).toBe('Cloudflare');
      expect(result.detection.confidence).toBe(92);
      expect(result.sensitiveFiles?.results).toEqual(mockAuditResults);
    });

    it('audit.patches is discarded in favor of patches from /api/virtual-patch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidencePercent: 90,
            evidence: [],
          },
          results: [{ category: 'Sensitive Files', method: 'GET', status: 200, payload: '/.env', verdict: 'exposed' as const }],
          patches: {
            targetUrl: 'https://example.com',
            generatedAt: '2026-09-04T12:00:00Z',
            totalBypasses: 0,
            bundles: {
              dummy: { vendor: 'audit-dummy', native: 'audit-rule', ruleCount: 0 },
            },
          },
        }),
      });

      const virtualPatchReport = {
        targetUrl: 'https://example.com',
        generatedAt: '2026-09-04T12:00:00Z',
        totalBypasses: 1,
        bundles: {
          cloudflare: { vendor: 'cloudflare', native: 'actual-virtual-patch-rule', ruleCount: 1 },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => virtualPatchReport,
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.patches).toEqual(virtualPatchReport);
      expect(result.patches?.bundles.cloudflare.native).toBe('actual-virtual-patch-rule');
      expect((result.patches as any)?.bundles?.dummy).toBeUndefined();
    });

    it('sends includeMisses: true to /api/virtual-patch', async () => {
      const mockResults = [
        { category: 'Sensitive Files', method: 'GET', status: 404, payload: '/.env', verdict: 'passed' as const },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidencePercent: 90,
            evidence: [],
          },
          results: mockResults,
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 0,
          bundles: {},
        }),
      });

      await runWafCheck(mockEnv, 'https://example.com');

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://waf.secmy.app/api/virtual-patch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            results: mockResults,
            options: {
              vendor: 'all',
              targetUrl: 'https://example.com',
              includeTerraform: true,
              includeMisses: true,
            },
          }),
        })
      );
    });

    it('falls back to legacy sequence when audit responds 500', async () => {
      // 1. Audit responds 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Audit internal server error' }),
      });

      // 2. Legacy waf-detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: true,
            wafType: 'Cloudflare',
            confidence: 85,
            evidence: [],
          },
        }),
      });

      // 3. Legacy check
      const checkItems = [{ category: 'Sensitive Files', method: 'GET', status: 200, payload: '/.env' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => checkItems,
      });

      // 4. Virtual patch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          targetUrl: 'https://example.com',
          generatedAt: '2026-09-04T12:00:00Z',
          totalBypasses: 1,
          bundles: {},
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.detection.detected).toBe(true);
      expect(result.sensitiveFiles?.results).toEqual(checkItems);
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/audit'), expect.anything());
      expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/waf-detect'), expect.anything());
    });

    it('falls back to legacy sequence when audit responds 200 with body lacking detection', async () => {
      // 1. Audit responds 200 without detection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      // 2. Legacy waf-detect
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          detection: {
            detected: false,
            wafType: 'None',
            confidence: 0,
            evidence: [],
          },
        }),
      });

      const result = await runWafCheck(mockEnv, 'https://example.com');

      expect(result.detection.detected).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/audit'), expect.anything());
      expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/waf-detect'), expect.anything());
    });

    it('handles 422 SELF_SCAN_REFUSED from audit as terminal error with |422 without fallback', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          error: 'self-scan refused',
          code: 'SELF_SCAN_REFUSED',
        }),
      });

      await expect(runWafCheck(mockEnv, 'https://example.com')).rejects.toThrow('self-scan refused|422');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/waf-detect'), expect.anything());
    });
  });
});
