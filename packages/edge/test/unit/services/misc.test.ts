// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MiscService, normalizeHostname } from '../../../src/services/misc';
import type { IMiscRepository } from '../../../src/repositories/misc';
import type { IAuthRepository } from '../../../src/repositories/auth';
import type { Env } from '../../../src/env';

describe('normalizeHostname', () => {
  it('normalizes hostnames to lowercase without trailing dot', () => {
    expect(normalizeHostname('https://EXAMPLE.COM/path')).toBe('example.com');
    expect(normalizeHostname('http://api.swazz.dev:8080/v1')).toBe('api.swazz.dev');
    expect(normalizeHostname('https://test.local.')).toBe('test.local');
    expect(normalizeHostname('http://127.0.0.1:3000/')).toBe('127.0.0.1');
  });

  it('handles urls without scheme gracefully', () => {
    expect(normalizeHostname('example.com/api')).toBe('example.com');
  });

  it('returns null for empty or invalid inputs', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname(null as any)).toBeNull();
    expect(normalizeHostname('   ')).toBeNull();
  });
});

describe('MiscService.proxy', () => {
  let mockEnv: Env;
  let mockMiscRepo: Partial<IMiscRepository>;
  let mockAuthRepo: Partial<IAuthRepository>;
  let miscService: MiscService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockEnv = {} as Env;
    mockMiscRepo = {
      getUserScanTargetUrls: vi.fn().mockResolvedValue(['https://api.example.com/v1', 'http://127.0.0.1:8788']),
    };
    mockAuthRepo = {
      checkIpRateLimit: vi.fn().mockResolvedValue({ limited: false }),
    };
    miscService = new MiscService(mockEnv, mockMiscRepo as IMiscRepository, mockAuthRepo as IAuthRepository);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws 401 when userId is not provided', async () => {
    await expect(miscService.proxy({ url: 'https://api.example.com' }, null))
      .rejects.toThrow('Unauthorized|401');
  });

  it('throws 429 when per-user rate limit is exceeded', async () => {
    (mockAuthRepo.checkIpRateLimit as any).mockResolvedValueOnce({ limited: true });

    await expect(miscService.proxy({ url: 'https://api.example.com' }, 'user_123'))
      .rejects.toThrow('Rate limit exceeded|429');

    expect(mockAuthRepo.checkIpRateLimit).toHaveBeenCalledWith('proxy:user:user_123', 60, 60);
  });

  it('throws 400 when url is missing or not a string', async () => {
    await expect(miscService.proxy({}, 'user_123'))
      .rejects.toThrow('Missing target url|400');
    await expect(miscService.proxy({ url: 123 }, 'user_123'))
      .rejects.toThrow('Missing target url|400');
  });

  it('throws 400 when url is invalid', async () => {
    await expect(miscService.proxy({ url: 'http://::invalid::' }, 'user_123'))
      .rejects.toThrow('Invalid target url|400');
  });

  it('throws 400 when protocol is not http or https', async () => {
    await expect(miscService.proxy({ url: 'ftp://api.example.com/file' }, 'user_123'))
      .rejects.toThrow('Only HTTP and HTTPS protocols are allowed|400');
    await expect(miscService.proxy({ url: 'file:///etc/passwd' }, 'user_123'))
      .rejects.toThrow('Only HTTP and HTTPS protocols are allowed|400');
    await expect(miscService.proxy({ url: 'javascript:alert(1)' }, 'user_123'))
      .rejects.toThrow('Only HTTP and HTTPS protocols are allowed|400');
  });

  it('throws 403 when user has no scans matching the requested host', async () => {
    (mockMiscRepo.getUserScanTargetUrls as any).mockResolvedValueOnce(['https://other.com/api']);

    await expect(miscService.proxy({ url: 'https://api.example.com/users' }, 'user_123'))
      .rejects.toThrow('Target host not authorized for replay|403');
  });

  it('allows replay against matching host (case-insensitive and different path/port)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ replayed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await miscService.proxy(
      {
        url: 'https://API.EXAMPLE.COM/v2/items?page=1',
        method: 'POST',
        headers: { 'X-Custom': 'val' },
        body: { query: 'test' },
      },
      'user_123'
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ replayed: true });
    expect(result.headers['content-type']).toBe('application/json');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://API.EXAMPLE.COM/v2/items?page=1',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: JSON.stringify({ query: 'test' }),
      })
    );
  });

  it('does not follow redirects (redirect: manual)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.com/redirect' },
      })
    );

    const result = await miscService.proxy(
      { url: 'https://api.example.com/redirect' },
      'user_123'
    );

    expect(result.status).toBe(302);
    expect(result.headers['location']).toBe('https://evil.com/redirect');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/redirect',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('throws 408 on request timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      return Promise.reject(err);
    });

    await expect(
      miscService.proxy({ url: 'https://api.example.com/slow' }, 'user_123', { timeoutMs: 100 })
    ).rejects.toThrow('Request timed out|408');
  });

  it('throws 413 when Content-Length exceeds response size cap', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('small text', {
        status: 200,
        headers: { 'Content-Length': '10000000' },
      })
    );

    await expect(
      miscService.proxy({ url: 'https://api.example.com/huge' }, 'user_123', { maxResponseBytes: 1024 })
    ).rejects.toThrow('Response size exceeds limit|413');
  });

  it('throws 413 when streaming response body exceeds size cap', async () => {
    const hugeChunk = new Uint8Array(2000).fill(65);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(hugeChunk);
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200 })
    );

    await expect(
      miscService.proxy({ url: 'https://api.example.com/stream-huge' }, 'user_123', { maxResponseBytes: 500 })
    ).rejects.toThrow('Response size exceeds limit|413');
  });
});
