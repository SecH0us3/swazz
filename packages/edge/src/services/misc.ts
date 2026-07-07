import { Env } from '../env';
import { IMiscRepository } from '../repositories/misc';

export interface IMiscService {
  proxy(payload: any): Promise<any>;
  parseSpec(
    bodyText: string,
    userId: string | null,
    isAnon: boolean,
    ip: string,
    isWebRequest: boolean
  ): Promise<{ status: number; bodyText: string }>;
}

export class MiscService implements IMiscService {
  constructor(private env: Env, private miscRepo: IMiscRepository) {}

  async proxy(payload: any): Promise<any> {
    const targetUrl = payload.url;
    if (!targetUrl) throw new Error('Missing target url|400');

    const startTime = Date.now();
    const fetchOpts: RequestInit = {
      method: payload.method || 'GET',
      headers: payload.headers || {},
      body: ['GET', 'HEAD'].includes(payload.method || 'GET') ? undefined : payload.body,
      redirect: 'manual'
    };

    const response = await fetch(targetUrl, fetchOpts);
    const duration = Date.now() - startTime;
    
    let resBody = await response.text();
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
}
