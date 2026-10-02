// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { IMiscRepository } from '../repositories/misc';
import { IAuthRepository, AuthRepository } from '../repositories/auth';

export function normalizeHostname(urlStr: string): string | null {
  if (!urlStr || typeof urlStr !== 'string') return null;
  try {
    const parsed = new URL(urlStr.includes('://') ? urlStr : `https://${urlStr}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

export interface ProxyOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  rateLimitMax?: number;
}

export interface IMiscService {
  proxy(payload: any, userId?: string | null, opts?: ProxyOptions): Promise<any>;
  parseSpec(
    bodyText: string,
    userId: string | null,
    isAnon: boolean,
    ip: string,
    isWebRequest: boolean
  ): Promise<{ status: number; bodyText: string }>;
  incrementGlobalScanCount(yyMm: string): Promise<void>;
  getGlobalScanCount(): Promise<{ total: number; monthly: Record<string, number> }>;
}

export class MiscService implements IMiscService {
  constructor(
    private env: Env,
    private miscRepo: IMiscRepository,
    private authRepo: IAuthRepository = new AuthRepository(env)
  ) {}

  async proxy(payload: any, userId?: string | null, opts?: ProxyOptions): Promise<any> {
    if (!userId) {
      throw new Error('Unauthorized|401');
    }

    // Per-user rate limit (reuse AuthRepository.checkIpRateLimit)
    const rateLimitMax = opts?.rateLimitMax ?? 60;
    const rateLimit = await this.authRepo.checkIpRateLimit(`proxy:user:${userId}`, rateLimitMax, 60);
    if (rateLimit.limited) {
      throw new Error('Rate limit exceeded|429');
    }

    const targetUrl = payload?.url;
    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new Error('Missing target url|400');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new Error('Invalid target url|400');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS protocols are allowed|400');
    }

    const reqHostname = normalizeHostname(targetUrl);
    if (!reqHostname) {
      throw new Error('Invalid target hostname|400');
    }

    // Check that user has access to a scan with matching normalized hostname
    const userTargetUrls = await this.miscRepo.getUserScanTargetUrls(userId);
    const allowedHostnames = new Set(
      userTargetUrls
        .map(url => normalizeHostname(url))
        .filter((h): h is string => Boolean(h))
    );

    if (!allowedHostnames.has(reqHostname)) {
      throw new Error('Target host not authorized for replay|403');
    }

    const startTime = Date.now();
    const headers = { ...(payload.headers || {}) };
    const hasUA = Object.keys(headers).some(k => k.toLowerCase() === 'user-agent');
    if (!hasUA) {
      headers['User-Agent'] = 'Swazz/1.0 (+https://github.com/SecH0us3/swazz)';
    }

    if (payload.cookies && typeof payload.cookies === 'object' && !headers['Cookie'] && !headers['cookie']) {
      const cookieEntries = Object.entries(payload.cookies).map(([k, v]) => `${k}=${v}`);
      if (cookieEntries.length > 0) {
        headers['Cookie'] = cookieEntries.join('; ');
      }
    }

    let requestBody: any = undefined;
    if (!['GET', 'HEAD'].includes((payload.method || 'GET').toUpperCase())) {
      if (typeof payload.body === 'object' && payload.body !== null) {
        requestBody = JSON.stringify(payload.body);
      } else {
        requestBody = payload.body;
      }
    }

    const fetchOpts: RequestInit = {
      method: payload.method || 'GET',
      headers,
      body: requestBody,
      redirect: 'manual'
    };

    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const maxResponseBytes = opts?.maxResponseBytes ?? 2 * 1024 * 1024;

    let response: Response;
    try {
      response = await fetch(targetUrl, {
        ...fetchOpts,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (fetchErr: any) {
      if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
        throw new Error('Request timed out|408');
      }
      throw new Error(`Failed to fetch target: ${fetchErr.message || 'connection error'}|502`);
    }

    const duration = Date.now() - startTime;

    const clHeader = response.headers.get('content-length');
    if (clHeader) {
      const cl = parseInt(clHeader, 10);
      if (!isNaN(cl) && cl > maxResponseBytes) {
        throw new Error('Response size exceeds limit|413');
      }
    }

    let resBody: any = '';
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.length;
            if (totalBytes > maxResponseBytes) {
              try { await reader.cancel(); } catch {}
              throw new Error('Response size exceeds limit|413');
            }
            chunks.push(value);
          }
        }
      } catch (err: any) {
        if (err instanceof Error && err.message.includes('|413')) {
          throw err;
        }
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new Error('Request timed out|408');
        }
        throw err;
      }
      const totalBuffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        totalBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      resBody = new TextDecoder('utf-8').decode(totalBuffer);
    } else {
      const text = await response.text();
      if (text.length > maxResponseBytes) {
        throw new Error('Response size exceeds limit|413');
      }
      resBody = text;
    }

    try { resBody = JSON.parse(resBody); } catch {}

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: resBody,
      duration
    };
  }

  async parseSpec(
    bodyText: string,
    userId: string | null,
    isAnon: boolean,
    ip: string,
    isWebRequest: boolean
  ): Promise<{ status: number; bodyText: string }> {
    if (this.env.LIMIT_ANONYMOUS === 'true' && isWebRequest && isAnon) {
      const usageCount = await this.miscRepo.getAnonymousUsage(ip);
      if (usageCount >= 1) {
        throw new Error('Anonymous limit reached: You can only import/parse 1 JSON spec by IP.|403');
      }
    }

    let userPublicKey = "";
    if (userId) {
      try {
        const key = await this.miscRepo.getUserPublicKey(userId);
        if (key) {
          userPublicKey = key;
        }
      } catch (dbErr) {
        console.error("Failed to query user public key in /api/parse:", dbErr);
      }
    }

    let parsedBody: any = {};
    try {
      parsedBody = JSON.parse(bodyText);
    } catch { /* ignored */ }
    parsedBody.userPublicKey = userPublicKey;
    const newBodyText = JSON.stringify(parsedBody);

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const res = await stub.fetch(new Request('http://internal/parse', { method: 'POST', body: newBodyText }));

    const resText = await res.text();

    if (res.ok && this.env.LIMIT_ANONYMOUS === 'true' && isWebRequest && isAnon) {
      await this.miscRepo.incrementAnonymousUsage(ip);
    }

    return {
      status: res.status,
      bodyText: resText
    };
  }

  async incrementGlobalScanCount(yyMm: string): Promise<void> {
    await this.miscRepo.incrementGlobalScanCount(yyMm);
  }

  async getGlobalScanCount(): Promise<{ total: number; monthly: Record<string, number> }> {
    return await this.miscRepo.getGlobalScanCount();
  }
}
