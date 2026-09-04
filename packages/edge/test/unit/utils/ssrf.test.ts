// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi } from 'vitest';
import {
  parseIPv4,
  parseIPv6,
  isBlockedIPv4,
  isBlockedIPv6,
  isBlockedHostname,
  validateWebhookUrl,
  safeFetchWebhook,
} from '../../../src/utils/ssrf';

describe('SSRF Protection Utilities', () => {
  describe('parseIPv4 & isBlockedIPv4', () => {
    it('correctly parses valid dotted-decimal IPv4 strings', () => {
      expect(parseIPv4('127.0.0.1')).toEqual([127, 0, 0, 1]);
      expect(parseIPv4('169.254.169.254')).toEqual([169, 254, 169, 254]);
      expect(parseIPv4('8.8.8.8')).toEqual([8, 8, 8, 8]);
    });

    it('rejects invalid or octal-formatted IPv4 strings', () => {
      expect(parseIPv4('127.0.0.256')).toBeNull();
      expect(parseIPv4('127.0.1')).toBeNull();
      expect(parseIPv4('0177.0.0.1')).toBeNull();
      expect(parseIPv4('not-an-ip')).toBeNull();
    });

    it('blocks loopback addresses (127.0.0.0/8)', () => {
      expect(isBlockedIPv4([127, 0, 0, 1])).toBe(true);
      expect(isBlockedIPv4([127, 255, 255, 255])).toBe(true);
    });

    it('blocks private ranges (RFC 1918)', () => {
      expect(isBlockedIPv4([10, 0, 0, 1])).toBe(true);
      expect(isBlockedIPv4([10, 255, 255, 255])).toBe(true);
      expect(isBlockedIPv4([172, 16, 0, 1])).toBe(true);
      expect(isBlockedIPv4([172, 31, 255, 255])).toBe(true);
      expect(isBlockedIPv4([172, 32, 0, 1])).toBe(false); // Public
      expect(isBlockedIPv4([192, 168, 1, 1])).toBe(true);
    });

    it('blocks cloud metadata and link-local (169.254.0.0/16)', () => {
      expect(isBlockedIPv4([169, 254, 169, 254])).toBe(true);
      expect(isBlockedIPv4([169, 254, 0, 1])).toBe(true);
    });

    it('blocks unspecified, carrier-grade NAT, multicast, and broadcast', () => {
      expect(isBlockedIPv4([0, 0, 0, 0])).toBe(true);
      expect(isBlockedIPv4([100, 64, 0, 1])).toBe(true);
      expect(isBlockedIPv4([100, 127, 255, 255])).toBe(true);
      expect(isBlockedIPv4([100, 128, 0, 1])).toBe(false); // Public
      expect(isBlockedIPv4([224, 0, 0, 1])).toBe(true);
      expect(isBlockedIPv4([255, 255, 255, 255])).toBe(true);
    });

    it('allows legitimate public IPv4 addresses', () => {
      expect(isBlockedIPv4([8, 8, 8, 8])).toBe(false);
      expect(isBlockedIPv4([1, 1, 1, 1])).toBe(false);
      expect(isBlockedIPv4([93, 184, 216, 34])).toBe(false);
    });
  });

  describe('parseIPv6 & isBlockedIPv6', () => {
    it('parses valid IPv6 representations', () => {
      expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIPv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    });

    it('blocks loopback and unspecified IPv6', () => {
      expect(isBlockedIPv6(parseIPv6('::1')!)).toBe(true);
      expect(isBlockedIPv6(parseIPv6('::')!)).toBe(true);
      expect(isBlockedIPv6(parseIPv6('[::1]')!)).toBe(true);
    });

    it('blocks IPv6 link-local and unique-local (ULA / AWS IMDS)', () => {
      expect(isBlockedIPv6(parseIPv6('fe80::1')!)).toBe(true);
      expect(isBlockedIPv6(parseIPv6('fc00::1')!)).toBe(true);
      expect(isBlockedIPv6(parseIPv6('fd00:ec2::254')!)).toBe(true); // AWS IPv6 metadata
    });

    it('blocks IPv4-mapped IPv6 private addresses', () => {
      expect(isBlockedIPv6(parseIPv6('::ffff:127.0.0.1')!)).toBe(true);
      expect(isBlockedIPv6(parseIPv6('::ffff:169.254.169.254')!)).toBe(true);
      expect(isBlockedIPv6(parseIPv6('::ffff:10.0.0.1')!)).toBe(true);
      expect(isBlockedIPv6(parseIPv6('::ffff:8.8.8.8')!)).toBe(false); // Public
    });

    it('allows public IPv6 addresses', () => {
      expect(isBlockedIPv6(parseIPv6('2606:4700:4700::1111')!)).toBe(false);
      expect(isBlockedIPv6(parseIPv6('2001:4860:4860::8888')!)).toBe(false);
    });
  });

  describe('isBlockedHostname', () => {
    it('blocks localhost and subdomains', () => {
      expect(isBlockedHostname('localhost')).toBe(true);
      expect(isBlockedHostname('sub.localhost')).toBe(true);
      expect(isBlockedHostname('LOCALHOST')).toBe(true);
    });

    it('blocks cloud metadata hostnames', () => {
      expect(isBlockedHostname('metadata.google.internal')).toBe(true);
      expect(isBlockedHostname('instance-data')).toBe(true);
      expect(isBlockedHostname('metadata.azure.com')).toBe(true);
    });

    it('blocks local and internal network TLDs', () => {
      expect(isBlockedHostname('server.local')).toBe(true);
      expect(isBlockedHostname('api.internal')).toBe(true);
      expect(isBlockedHostname('db.lan')).toBe(true);
      expect(isBlockedHostname('corp.intranet.corp')).toBe(true);
      expect(isBlockedHostname('gateway.home')).toBe(true);
      expect(isBlockedHostname('test.arpa')).toBe(true);
    });

    it('blocks single-label hostnames without a dot', () => {
      expect(isBlockedHostname('router')).toBe(true);
      expect(isBlockedHostname('intranet')).toBe(true);
      expect(isBlockedHostname('metadata')).toBe(true);
    });

    it('allows legitimate public domain names', () => {
      expect(isBlockedHostname('example.com')).toBe(false);
      expect(isBlockedHostname('hooks.slack.com')).toBe(false);
      expect(isBlockedHostname('discord.com')).toBe(false);
      expect(isBlockedHostname('api.github.com')).toBe(false);
    });
  });

  describe('validateWebhookUrl', () => {
    it('rejects missing or non-string URLs', async () => {
      await expect(validateWebhookUrl(null as any)).rejects.toThrow('URL is required');
      await expect(validateWebhookUrl('')).rejects.toThrow('URL is required');
      await expect(validateWebhookUrl(123 as any)).rejects.toThrow('URL is required');
    });

    it('rejects invalid URL formats', async () => {
      await expect(validateWebhookUrl('not-a-url')).rejects.toThrow('Invalid URL format');
      await expect(validateWebhookUrl('http://')).rejects.toThrow('Invalid URL format');
    });

    it('rejects non-http/https protocols', async () => {
      await expect(validateWebhookUrl('ftp://example.com/webhook')).rejects.toThrow('URL protocol must be http or https');
      await expect(validateWebhookUrl('file:///etc/passwd')).rejects.toThrow('URL protocol must be http or https');
      await expect(validateWebhookUrl('gopher://example.com/')).rejects.toThrow('URL protocol must be http or https');
    });

    it('rejects direct IP addresses in webhook URLs', async () => {
      await expect(validateWebhookUrl('http://127.0.0.1:8787/hook')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://127.1/hook')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://10.0.0.1/hook')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://192.168.1.1/hook')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://172.16.0.1/hook')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://0.0.0.0/hook')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://8.8.8.8/hook')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://[fd00:ec2::254]/')).rejects.toThrow('direct IP addresses are not permitted');
      await expect(validateWebhookUrl('http://[::1]/hook')).rejects.toThrow('direct IP addresses are not permitted');
    });

    it('rejects internal and loopback hostnames', async () => {
      await expect(validateWebhookUrl('http://localhost:3000/webhook')).rejects.toThrow('private, loopback, or reserved');
      await expect(validateWebhookUrl('http://metadata.google.internal/')).rejects.toThrow('private, loopback, or reserved');
      await expect(validateWebhookUrl('http://instance-data/')).rejects.toThrow('private, loopback, or reserved');
      await expect(validateWebhookUrl('http://internal-host/webhook')).rejects.toThrow('private, loopback, or reserved');
    });

    it('rejects domains resolving to private/loopback IP addresses via DNS', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
        if (url.toString().includes('cloudflare-dns.com')) {
          return Promise.resolve(new Response(JSON.stringify({
            Status: 0,
            Answer: [{ name: 'rebind.evil.com', type: 1, data: '127.0.0.1' }]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await expect(validateWebhookUrl('https://rebind.evil.com/webhook')).rejects.toThrow(
        'Webhook URL cannot target private, loopback, or reserved network addresses|400'
      );

      fetchSpy.mockRestore();
    });

    it('allows valid public domain webhook URLs', async () => {
      const parsed = await validateWebhookUrl('https://example.com/webhook');
      expect(parsed.hostname).toBe('example.com');
    });

    it('allows private webhooks when ALLOW_PRIVATE_WEBHOOKS is explicitly enabled', async () => {
      const parsed = await validateWebhookUrl('http://127.0.0.1:8787/hook', { ALLOW_PRIVATE_WEBHOOKS: 'true' } as any);
      expect(parsed.hostname).toBe('127.0.0.1');
    });
  });

  describe('safeFetchWebhook', () => {
    it('blocks requests targeting direct IP addresses before fetch', async () => {
      await expect(
        safeFetchWebhook('http://127.0.0.1:8787/hook', { method: 'POST' })
      ).rejects.toThrow('direct IP addresses are not permitted');
    });

    it('aborts when a redirect hop targets a restricted/private address or IP', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
        if (url.toString().includes('example.com/redirect-to-metadata')) {
          return Promise.resolve(new Response(null, {
            status: 302,
            headers: { Location: 'http://169.254.169.254/latest/meta-data/' }
          }));
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      await expect(
        safeFetchWebhook('https://example.com/redirect-to-metadata', { method: 'POST' })
      ).rejects.toThrow('direct IP addresses are not permitted');

      fetchSpy.mockRestore();
    });

    it('follows safe public redirects up to maxRedirects', async () => {
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
        callCount++;
        if (url.toString().includes('example.com/hop1')) {
          return Promise.resolve(new Response(null, {
            status: 302,
            headers: { Location: 'https://example.com/final' }
          }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const res = await safeFetchWebhook('https://example.com/hop1', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(callCount).toBe(2);

      fetchSpy.mockRestore();
    });

    it('prevents redirect loops beyond maxRedirects', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        return Promise.resolve(new Response(null, {
          status: 302,
          headers: { Location: 'https://example.com/loop' }
        }));
      });

      await expect(
        safeFetchWebhook('https://example.com/loop', { method: 'POST' }, undefined, 3)
      ).rejects.toThrow('Too many redirects');

      fetchSpy.mockRestore();
    });
  });
});
