// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';

const MAX_PAGES = 20;
const PAGE_SIZE = 50;

export type WafVerdict = 'blocked' | 'passed' | 'exposed';

export interface WafDetection {
  detected: boolean;
  wafType: string;
  confidence: number;
  confidencePercent?: number;
  confidenceThreshold?: number;
  evidence: string[];
}

export interface WafCheckSensitiveFileResult {
  category: string;
  method: string;
  /** `null` when the probe failed before getting an HTTP response — see `error`. */
  status: number | null;
  payload: string;
  /** Whether the WAF stopped the request before it reached the origin. */
  blocked?: boolean;
  /** Server-side classification. Preferred over any client-side status heuristic. */
  verdict?: WafVerdict;
  /** Machine-readable failure reason ('timeout', 'dns', 'connection_reset', ...) or null. */
  error?: string | null;
  responseTime?: number;
  statusText?: string;
  path?: string;
}

export interface WafCheckEnvelope {
  results: WafCheckSensitiveFileResult[];
  page?: number;
  pageSize?: number;
  total?: number;
  hasMore?: boolean;
}

export interface WafPatchBundle {
  vendor: string;
  native: string;
  terraform?: string;
  ruleCount: number;
}

export interface WafPatchReport {
  targetUrl: string;
  generatedAt: string;
  totalBypasses: number;
  bundles: Record<string, WafPatchBundle>;
}

export interface WafCheckResult {
  detection: WafDetection;
  recommendation?: string; // present only when !detection.detected
  sensitiveFiles?: { total: number; results: WafCheckSensitiveFileResult[] }; // present only when detection.detected
  patches?: WafPatchReport; // present only when detection.detected
}

export async function runWafCheck(env: Env, targetUrl: string): Promise<WafCheckResult> {
  const endpoint = (env.WAF_CHECKER_URL || 'https://waf.secmy.app').replace(/\/$/, '');

  let detection: WafDetection | undefined;
  let results: WafCheckSensitiveFileResult[] = [];

  // 1. Primary path: try /api/audit
  let auditSucceeded = false;
  try {
    const auditResp = await fetch(
      `${endpoint}/api/audit?url=${encodeURIComponent(targetUrl)}&categories=${encodeURIComponent('Sensitive Files')}`,
      { signal: AbortSignal.timeout(120000) }
    );

    if (auditResp.status === 422) {
      let errBody: any;
      try {
        errBody = await auditResp.json();
      } catch {
        errBody = null;
      }
      throw new Error(`${errBody?.error || 'Self-scan refused'}|422`);
    }

    if (auditResp.ok) {
      let auditBody: any;
      try {
        auditBody = await auditResp.json();
      } catch {
        auditBody = undefined;
      }
      if (auditBody && typeof auditBody === 'object' && auditBody.detection && typeof auditBody.detection === 'object') {
        detection = auditBody.detection;
        results = Array.isArray(auditBody.results) ? auditBody.results : [];
        auditSucceeded = true;
        // Note: auditBody.patches is discarded deliberately because /api/audit ignores includeMisses
      }
    }
  } catch (err: any) {
    if (err?.message?.endsWith('|422')) {
      throw err;
    }
    auditSucceeded = false;
  }

  // 2. Fallback path: legacy /api/waf-detect + paginated /api/check
  if (!auditSucceeded) {
    const detectResp = await fetch(`${endpoint}/api/waf-detect?url=${encodeURIComponent(targetUrl)}`, { signal: AbortSignal.timeout(30000) });
    let detectBody: { detection?: WafDetection; error?: string } | undefined;
    try {
      detectBody = await detectResp.json();
    } catch {
      detectBody = undefined;
    }
    if (!detectResp.ok) throw new Error(`WAF check failed: ${detectBody?.error || detectResp.status}|502`);
    if (!detectBody || typeof detectBody !== 'object' || !detectBody.detection) {
      throw new Error('Invalid response from WAF checker service|502');
    }
    detection = detectBody.detection;

    if (detection.detected) {
      const allResults: WafCheckSensitiveFileResult[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        try {
          const checkResp = await fetch(
            `${endpoint}/api/check?url=${encodeURIComponent(targetUrl)}&categories=${encodeURIComponent('Sensitive Files')}&page=${page}&envelope=1`,
            { signal: AbortSignal.timeout(90000) }
          );
          if (!checkResp.ok) break; // don't fail the whole check over a mid-scan hiccup — return what we have
          const pageBody = await checkResp.json() as WafCheckEnvelope | WafCheckSensitiveFileResult[];
          if (Array.isArray(pageBody)) {
            allResults.push(...pageBody);
            if (pageBody.length < PAGE_SIZE) break;
          } else if (pageBody && typeof pageBody === 'object' && Array.isArray(pageBody.results)) {
            allResults.push(...pageBody.results);
            if (pageBody.hasMore === false) break;
          } else {
            break;
          }
        } catch {
          break;
        }
      }
      results = allResults;
    }
  }

  // 3. Shared tail, unchanged for both paths
  if (!detection) {
    throw new Error('Invalid response from WAF checker service|502');
  }

  // Prefer confidencePercent when it is a number, otherwise clamp raw confidence
  if (typeof detection.confidencePercent === 'number') {
    detection.confidence = Math.max(0, Math.min(100, detection.confidencePercent));
  } else if (typeof detection.confidence === 'number') {
    detection.confidence = Math.max(0, Math.min(100, detection.confidence));
  }

  if (!detection.detected) {
    return {
      detection,
      recommendation: 'No Web Application Firewall was detected protecting this target. Consider enabling one (e.g. Cloudflare, AWS WAF, ModSecurity) to add a defensive layer against common web attacks such as SQL injection, XSS, and path traversal.',
    };
  }

  // Generate patches from what leaked
  let patches: WafPatchReport | undefined = undefined;
  try {
    const patchResp = await fetch(`${endpoint}/api/virtual-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results, options: { vendor: 'all', targetUrl, includeTerraform: true, includeMisses: true } }),
      signal: AbortSignal.timeout(30000),
    });
    patches = patchResp.ok ? await patchResp.json() as WafPatchReport : undefined;
  } catch {
    patches = undefined;
  }

  return {
    detection,
    sensitiveFiles: { total: results.length, results },
    patches,
  };
}
