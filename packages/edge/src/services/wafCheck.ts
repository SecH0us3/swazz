// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';

export interface WafCheckResult {
  detection: { detected: boolean; wafType: string; confidence: number; evidence: string[] };
  recommendation?: string; // present only when !detection.detected
  sensitiveFiles?: { total: number; results: any[] }; // present only when detection.detected
  patches?: { targetUrl: string; generatedAt: string; totalBypasses: number; bundles: Record<string, { vendor: string; native: string; terraform?: string; ruleCount: number }> }; // present only when detection.detected
}

export async function runWafCheck(env: Env, targetUrl: string): Promise<WafCheckResult> {
  const endpoint = (env.WAF_CHECKER_URL || 'https://waf.secmy.app').replace(/\/$/, '');

  // 1. Detect
  const detectResp = await fetch(`${endpoint}/api/waf-detect?url=${encodeURIComponent(targetUrl)}`, { signal: AbortSignal.timeout(30000) });
  let detectBody: any;
  try {
    detectBody = await detectResp.json();
  } catch {
    detectBody = undefined;
  }
  if (!detectResp.ok) throw new Error(`WAF check failed: ${detectBody?.error || detectResp.status}|502`);
  const detection = detectBody.detection;

  if (!detection.detected) {
    return {
      detection,
      recommendation: 'No Web Application Firewall was detected protecting this target. Consider enabling one (e.g. Cloudflare, AWS WAF, ModSecurity) to add a defensive layer against common web attacks such as SQL injection, XSS, and path traversal.',
    };
  }

  // 2. Sensitive Files scan — paginate until a short page
  const allResults: any[] = [];
  for (let page = 0; page < 20; page++) {
    try {
      const checkResp = await fetch(
        `${endpoint}/api/check?url=${encodeURIComponent(targetUrl)}&categories=${encodeURIComponent('Sensitive Files')}&page=${page}`,
        { signal: AbortSignal.timeout(90000) }
      );
      if (!checkResp.ok) break; // don't fail the whole check over a mid-scan hiccup — return what we have
      const pageResults = await checkResp.json() as any[];
      if (!Array.isArray(pageResults)) break;
      allResults.push(...pageResults);
      if (pageResults.length < 50) break;
    } catch {
      break;
    }
  }

  // 3. Generate patches from what leaked
  let patches: any = undefined;
  try {
    const patchResp = await fetch(`${endpoint}/api/virtual-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: allResults, options: { vendor: 'all', targetUrl, includeTerraform: true, includeMisses: true } }),
      signal: AbortSignal.timeout(30000),
    });
    patches = patchResp.ok ? await patchResp.json() : undefined;
  } catch {
    patches = undefined;
  }

  return {
    detection,
    sensitiveFiles: { total: allResults.length, results: allResults },
    patches,
  };
}
