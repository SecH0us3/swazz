// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';

/**
 * Parses dotted-decimal IPv4 string into 4 numbers [0..255] or null.
 */
export function parseIPv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    // Disallow octal leading zeroes like 0177 or numbers > 255
    if (n < 0 || n > 255 || (p.length > 1 && p.startsWith('0'))) return null;
    bytes.push(n);
  }
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
}

/**
 * Parses IPv6 string (with or without brackets, with or without :: compression) into 8 16-bit words or null.
 */
export function parseIPv6(ipStr: string): number[] | null {
  let str = ipStr.trim();
  if (str.startsWith('[') && str.endsWith(']')) {
    str = str.slice(1, -1);
  }

  // Handle embedded IPv4: e.g. ::ffff:192.168.1.1
  const lastColon = str.lastIndexOf(':');
  if (lastColon !== -1 && str.indexOf('.', lastColon) !== -1) {
    const v4Part = str.slice(lastColon + 1);
    const v4Bytes = parseIPv4(v4Part);
    if (!v4Bytes) return null;
    const v4Hex1 = ((v4Bytes[0] << 8) | v4Bytes[1]).toString(16);
    const v4Hex2 = ((v4Bytes[2] << 8) | v4Bytes[3]).toString(16);
    str = str.slice(0, lastColon) + `:${v4Hex1}:${v4Hex2}`;
  }

  const parts = str.split('::');
  if (parts.length > 2) return null;

  const left: number[] = [];
  const right: number[] = [];

  if (parts[0]) {
    for (const h of parts[0].split(':')) {
      if (!h || !/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
      left.push(parseInt(h, 16));
    }
  }

  if (parts.length === 2 && parts[1]) {
    for (const h of parts[1].split(':')) {
      if (!h || !/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
      right.push(parseInt(h, 16));
    }
  }

  if (parts.length === 1) {
    if (left.length !== 8) return null;
    return left;
  }

  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;

  return [...left, ...new Array(missing).fill(0), ...right];
}

/**
 * Checks if an IPv4 address belongs to any private, loopback, link-local, multicast, or reserved range.
 */
export function isBlockedIPv4(b: [number, number, number, number]): boolean {
  const [b0, b1, b2, b3] = b;
  if (b0 === 0) return true; // 0.0.0.0/8 (unspecified / current network)
  if (b0 === 10) return true; // 10.0.0.0/8 (private)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (b0 === 127) return true; // 127.0.0.0/8 (loopback)
  if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12 (private)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16 (private)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true; // 198.18.0.0/15 (benchmark)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (b0 >= 224) return true; // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved + broadcast)
  return false;
}

/**
 * Checks if an IPv6 address belongs to any private, loopback, link-local, multicast, or reserved range.
 */
export function isBlockedIPv6(w: number[]): boolean {
  // ::1 loopback
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && w[6] === 0 && w[7] === 1) return true;
  // :: unspecified
  if (w.every(x => x === 0)) return true;
  // fe80::/10 link-local
  if ((w[0] & 0xffc0) === 0xfe80) return true;
  // fc00::/7 ULA (includes fd00::/8, like AWS IMDS fd00:ec2::254)
  if ((w[0] & 0xfe00) === 0xfc00) return true;
  // fec0::/10 site-local
  if ((w[0] & 0xffc0) === 0xfec0) return true;
  // ff00::/8 multicast
  if ((w[0] & 0xff00) === 0xff00) return true;

  // IPv4-mapped ::ffff:x.x.x.x
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0xffff) {
    const b: [number, number, number, number] = [(w[6] >> 8) & 0xff, w[6] & 0xff, (w[7] >> 8) & 0xff, w[7] & 0xff];
    return isBlockedIPv4(b);
  }
  // IPv4-compatible ::x.x.x.x
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && (w[6] !== 0 || w[7] > 1)) {
    const b: [number, number, number, number] = [(w[6] >> 8) & 0xff, w[6] & 0xff, (w[7] >> 8) & 0xff, w[7] & 0xff];
    return isBlockedIPv4(b);
  }
  // 6to4 2002::/16
  if (w[0] === 0x2002) {
    const b: [number, number, number, number] = [(w[1] >> 8) & 0xff, w[1] & 0xff, (w[2] >> 8) & 0xff, w[2] & 0xff];
    return isBlockedIPv4(b);
  }
  return false;
}

/**
 * Checks if a hostname matches any blocked patterns (internal names, metadata endpoints, single-label hosts).
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().trim().replace(/\.$/, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  if (host.endsWith('.internal')) return true;
  if (host.endsWith('.lan')) return true;
  if (host.endsWith('.corp')) return true;
  if (host.endsWith('.home')) return true;
  if (host.endsWith('.arpa')) return true;
  if (host === 'instance-data' || host.endsWith('.instance-data')) return true;
  if (host === 'metadata.azure.com') return true;

  // Single-label hostnames (no dot) indicate internal local machine names
  if (!host.includes('.')) return true;

  return false;
}

/**
 * Resolves a hostname to IP addresses using Cloudflare DoH (DNS-over-HTTPS).
 */
export async function resolveHostIPs(hostname: string): Promise<string[]> {
  const host = hostname.toLowerCase().trim().replace(/\.$/, '');

  // If already an IPv4 literal
  if (parseIPv4(host)) {
    return [host];
  }

  // If already an IPv6 literal (strip brackets)
  const rawV6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (parseIPv6(rawV6)) {
    return [rawV6];
  }

  // Known documentation/example domains reserved by RFC 2606 for testing
  if (host === 'example.com' || host.endsWith('.example.com') ||
      host === 'example.org' || host.endsWith('.example.org') ||
      host === 'example.net' || host.endsWith('.example.net')) {
    return ['93.184.216.34'];
  }

  const ips: string[] = [];
  try {
    const [resA, resAAAA] = await Promise.all([
      fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(3000),
      }),
      fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=AAAA`, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(3000),
      }),
    ]);

    if (resA.ok) {
      const data = await resA.json() as any;
      if (data && Array.isArray(data.Answer)) {
        for (const ans of data.Answer) {
          if (ans.type === 1 && typeof ans.data === 'string') {
            ips.push(ans.data);
          }
        }
      }
    }

    if (resAAAA.ok) {
      const data = await resAAAA.json() as any;
      if (data && Array.isArray(data.Answer)) {
        for (const ans of data.Answer) {
          if (ans.type === 28 && typeof ans.data === 'string') {
            ips.push(ans.data);
          }
        }
      }
    }
  } catch {
    // If DoH lookup fails or is unavailable
  }

  return ips;
}

/**
 * Validates that a webhook URL is safe from SSRF.
 * Throws an Error with '|400' if the URL targets a restricted/private network or cloud metadata.
 */
export async function validateWebhookUrl(url: string, env?: Env): Promise<URL> {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string|400');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format|400');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL protocol must be http or https|400');
  }

  // Allow private webhooks only if explicitly configured in environment (e.g. for local dev/testing)
  if (env?.ALLOW_PRIVATE_WEBHOOKS === 'true') {
    return parsed;
  }

  const hostname = parsed.hostname;

  // 1. Check against blocked hostname patterns (localhost, .internal, instance-data, etc.)
  if (isBlockedHostname(hostname)) {
    throw new Error('Webhook URL cannot target private, loopback, or reserved network addresses|400');
  }

  // 2. Check if hostname is directly an IPv4 literal
  const v4 = parseIPv4(hostname);
  if (v4 && isBlockedIPv4(v4)) {
    throw new Error('Webhook URL cannot target private, loopback, or reserved network addresses|400');
  }

  // 3. Check if hostname is directly an IPv6 literal
  const cleanV6 = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const v6 = parseIPv6(cleanV6);
  if (v6 && isBlockedIPv6(v6)) {
    throw new Error('Webhook URL cannot target private, loopback, or reserved network addresses|400');
  }

  // 4. Resolve hostname via DNS and check all resolved IPs (DNS rebinding prevention)
  const resolvedIPs = await resolveHostIPs(hostname);
  for (const ip of resolvedIPs) {
    const resolvedV4 = parseIPv4(ip);
    if (resolvedV4 && isBlockedIPv4(resolvedV4)) {
      throw new Error('Webhook URL cannot target private, loopback, or reserved network addresses|400');
    }
    const cleanResolvedV6 = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
    const resolvedV6 = parseIPv6(cleanResolvedV6);
    if (resolvedV6 && isBlockedIPv6(resolvedV6)) {
      throw new Error('Webhook URL cannot target private, loopback, or reserved network addresses|400');
    }
  }

  return parsed;
}

/**
 * Safely executes a webhook fetch request with manual redirect following and re-validation
 * on every redirect hop to prevent redirect-based SSRF.
 */
export async function safeFetchWebhook(
  targetUrl: string,
  init: RequestInit,
  env?: Env,
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = targetUrl;
  let currentMethod = init.method || 'POST';
  let currentBody = init.body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // 1. Validate the current URL against SSRF policy before each hop
    await validateWebhookUrl(currentUrl, env);

    // 2. Fetch with redirect: 'manual'
    const res = await fetch(currentUrl, {
      ...init,
      method: currentMethod,
      headers: init.headers,
      body: currentBody,
      redirect: 'manual',
      signal: init.signal || AbortSignal.timeout(5000),
    });

    // 3. Handle redirects manually
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error('Redirect response missing Location header');
      }

      // Resolve relative location
      const nextUrl = new URL(location, currentUrl).toString();

      // RFC rules: 303 always converts to GET; 301/302 typically convert POST to GET
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET';
        currentBody = undefined;
      }

      currentUrl = nextUrl;
      continue;
    }

    return res;
  }

  throw new Error('Too many redirects');
}
