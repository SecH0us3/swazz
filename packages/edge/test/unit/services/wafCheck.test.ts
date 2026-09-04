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

  it('handles not-detected path (no check/patch calls made)', async () => {
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://waf.secmy.app/api/waf-detect?url=https%3A%2F%2Fexample.com',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('handles detected path with single-page results', async () => {
    // 1. Detect
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

    // 2. Check (single page with 5 items < 50)
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

    // 3. Virtual Patch
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
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify virtual-patch payload
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
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
    // 1. Detect
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

    // 2. Page 0 (50 items)
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

    // 3. Page 1 (22 items < 50)
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

    // 4. Virtual patch
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
    expect(mockFetch).toHaveBeenCalledTimes(4);

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('page=0'),
      expect.anything()
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('page=1'),
      expect.anything()
    );
  });

  it('propagates failing detect call as an error', async () => {
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
    // 1. Detect
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

    // 2. Page 0 succeeds (50 items)
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

    // 3. Page 1 fails mid-pagination
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 504,
      json: async () => ({ error: 'Gateway timeout' }),
    });

    // 4. Virtual patch still gets called with the 50 accumulated items
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
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('respects custom WAF_CHECKER_URL environment variable', async () => {
    const customEnv = { WAF_CHECKER_URL: 'https://custom-checker.internal/' } as Env;

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

    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom-checker.internal/api/waf-detect?url=https%3A%2F%2Fexample.com',
      expect.anything()
    );
  });
});
