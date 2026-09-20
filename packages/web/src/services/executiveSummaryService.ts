// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { isChromeAIAvailable } from './chromeAiService.js';

export interface FindingOverviewItem {
  ruleId: string;
  level: string;
  endpoint: string;
  owaspCategory?: string[];
}

export interface ReportStatsInput {
  totalRequests: number;
  durationSec: number;
  totalEndpoints: number;
  findingsCount: number;
  errorsCount: number;
  warningsCount: number;
  notesCount: number;
  topFindings: FindingOverviewItem[];
}

export interface ExecutiveSummaryResult {
  summary: string;
  model: string;
  simulated: boolean;
}

/**
 * Deterministic fallback generator for executive summaries.
 * Employs heuristic risk assessment and strategic action planning (CyberNova pattern).
 */
export function generateAlgorithmicExecutiveSummary(input: ReportStatsInput): ExecutiveSummaryResult {
  const { totalRequests, durationSec, totalEndpoints, findingsCount, errorsCount, warningsCount } = input;

  let posture = 'STABLE';
  let postureBadge = '🟢 LOW RISK';
  if (errorsCount > 0) {
    posture = 'CRITICAL';
    postureBadge = '🔴 CRITICAL RISK';
  } else if (warningsCount > 2) {
    posture = 'ELEVATED';
    postureBadge = '🟡 ELEVATED RISK';
  }

  if (findingsCount === 0) {
    const summary = `### Security Posture: ${postureBadge} (STABLE)
The automated API fuzzing assessment completed in **${durationSec}s**, evaluating **${totalEndpoints} endpoints** across **${totalRequests.toLocaleString()} requests**.
No critical or high-severity vulnerabilities were detected during active parameter mutation. The API demonstrated robust input handling and adherence to baseline security controls.

### Recommendations:
1. Maintain continuous automated regression fuzzing within CI/CD pull requests.
2. Conduct regular dependency and authentication boundary audits.
3. Monitor access logs for anomalous request rate surges.`;

    return {
      summary,
      model: 'algorithmic-rules (local)',
      simulated: true,
    };
  }

  const sampleRules = input.topFindings.slice(0, 5).map(f => `\`${f.ruleId}\` on \`${f.endpoint}\``).join(', ');

  const summary = `### Security Posture: ${postureBadge} (${posture})
The Swazz automated API fuzzing assessment completed in **${durationSec}s**, testing **${totalEndpoints} endpoints** across **${totalRequests.toLocaleString()} fuzz mutations**.
A total of **${findingsCount} findings** were identified (**${errorsCount} Errors**, **${warningsCount} Warnings**), indicating security gaps requiring prioritized developer attention.

### Key Risk Vectors:
${input.topFindings.slice(0, 4).map(f => `- **${f.ruleId}** (\`${f.endpoint}\`): ${f.owaspCategory?.[0] || 'Vulnerability detected during active mutation'}`).join('\n')}

### Strategic Action Plan:
1. **Immediate Remediation**: Triage and patch critical findings (${sampleRules}).
2. **Perimeter Hardening**: Deploy temporary virtual patch / WAF filtering rules to mitigate exposure while code-level fixes undergo QA.
3. **Regression Prevention**: Integrate automated security verification tests into CI/CD pipelines to block re-introduction.`;

  return {
    summary,
    model: 'algorithmic-rules (local)',
    simulated: true,
  };
}

/**
 * Generates an Executive Summary for API Security Reports.
 * Compresses finding metrics into a compact digest (< 400 tokens) and queries
 * Chrome Built-in Prompt API (Gemini Nano on-device), with deterministic fallback.
 */
export async function generateExecutiveSummary(input: ReportStatsInput): Promise<ExecutiveSummaryResult> {
  const fallback = generateAlgorithmicExecutiveSummary(input);

  const isChromeAi = await isChromeAIAvailable();
  if (!isChromeAi) {
    return fallback;
  }

  const ai = (typeof window !== 'undefined' && (window as any).ai) || (globalThis as any).ai;
  if (!ai || !ai.languageModel) {
    return fallback;
  }

  let session: any = null;
  try {
    session = await ai.languageModel.create({
      systemPrompt: `You are a Principal Application Security Auditor drafting an Executive Summary for an API Security & Fuzzing Audit Report.
Review the concise statistical scan digest and provide a clear, professional 2-3 paragraph Executive Summary in Markdown:
1. Overall Security Posture & Risk Level (Critical, Elevated, or Low).
2. Primary Attack Surface & Key Vulnerability Highlights.
3. Prioritized Strategic Recommendations for engineering leadership.
Be direct, factual, and concise. Avoid fluffy preamble.`,
    });

    // Create a compact digest to easily fit inside Gemini Nano's 4K context window
    const compactDigest = {
      totalRequests: input.totalRequests,
      durationSec: input.durationSec,
      totalEndpoints: input.totalEndpoints,
      findingsCount: input.findingsCount,
      errorsCount: input.errorsCount,
      warningsCount: input.warningsCount,
      topVulnerabilities: input.topFindings.slice(0, 6).map(f => ({
        rule: f.ruleId,
        level: f.level,
        endpoint: f.endpoint,
        owasp: f.owaspCategory?.[0],
      })),
    };

    const promptText = `Generate the Executive Summary for this API Security Audit:
${JSON.stringify(compactDigest, null, 2)}`;

    const response = await session.prompt(promptText);

    if (response && response.trim().length > 30) {
      return {
        summary: response.trim(),
        model: 'chrome-gemini-nano (on-device)',
        simulated: false,
      };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ExecutiveSummary] Chrome AI inference failed, using fallback:', err);
  } finally {
    if (session && typeof session.destroy === 'function') {
      try {
        session.destroy();
      } catch {
        // ignore
      }
    }
  }

  return fallback;
}
