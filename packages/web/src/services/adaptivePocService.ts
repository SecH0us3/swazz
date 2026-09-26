// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { isChromeAIAvailable } from './chromeAiService.js';
import { generateCurl, generatePython, generateTypeScript, generateGo } from '../components/Inspector/pocGenerator.js';

export type PocLanguage = 'curl' | 'python' | 'typescript' | 'go';

export interface AdaptivePocInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  language: PocLanguage;
  ruleId?: string;
  message?: string;
  level?: string;
  evidence?: string;
}

export interface AdaptivePocResult {
  code: string;
  model: string;
  simulated: boolean;
  explanation?: string;
}

function extractCodeBlock(rawText: string): string {
  const trimmed = rawText.trim();
  const match = trimmed.match(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return trimmed;
}

/**
 * Deterministic fallback generator for self-contained, automated security regression test scripts.
 * Employs defensive QA assertion patterns to test patch efficacy in CI/CD without safety refusals.
 */
export function generateAlgorithmicAdaptivePoc(input: AdaptivePocInput): AdaptivePocResult {
  const rule = (input.ruleId || 'Security Finding').trim();
  const lang = input.language;
  const isObject = typeof input.body === 'object' && input.body !== null;
  const bodyFormatted = isObject ? JSON.stringify(input.body, null, 2) : input.body;

  let code = '';

  if (lang === 'python') {
    code = `#!/usr/bin/env python3
"""
Automated Security Regression Test for ${rule}
Purpose: Verify if vulnerability "${rule}" is remediated.
Expected: Target API must reject malicious inputs or maintain access boundaries.
"""

import json
import requests
import sys

TARGET_URL = ${JSON.stringify(input.url)}
HEADERS = json.loads(${JSON.stringify(JSON.stringify(input.headers || {}))})
${input.body !== undefined && input.body !== null ? `PAYLOAD = json.loads(${JSON.stringify(JSON.stringify(input.body))})\n` : ''}
def verify_security_patch():
    print(f"[*] Testing {TARGET_URL} for ${rule} remediation...")
    try:
        response = requests.request(
            method="${input.method.toUpperCase()}",
            url=TARGET_URL,
            headers=HEADERS,
            ${input.body !== undefined && input.body !== null ? (isObject ? 'json=PAYLOAD,' : 'data=PAYLOAD,') : ''}
            timeout=10
        )
    except requests.exceptions.RequestException as e:
        print(f"[!] Network error connecting to target: {e}")
        sys.exit(2)

    print(f"[*] Received HTTP Status: {response.status_code}")

    # Security Regression Assertions:
    # 1. Ensure server does not trigger 500 Unhandled Internal Server Errors
    assert response.status_code != 500, "FAILED: Server crashed with 500 Internal Error (unhandled input)"

    # 2. Check for characteristic vulnerability signatures
    body_text = response.text.lower()
    ${rule.includes('sqli') ? 'assert "syntax error" not in body_text and "sql" not in body_text, "FAILED: SQL syntax leakage detected"' :
      rule.includes('xss') ? 'assert "<script" not in body_text, "FAILED: Unencoded script tag reflected in response"' :
      rule.includes('ssrf') || rule.includes('oob') ? 'assert response.status_code in [400, 403, 422], f"FAILED: Unfiltered outbound request accepted: {response.status_code}"' :
      rule.includes('cors') ? 'assert response.headers.get("access-control-allow-origin") != "*", "FAILED: Wildcard CORS origin exposed on private endpoint"' :
      'assert response.status_code in [200, 400, 401, 403, 404, 422], f"Unexpected response code: {response.status_code}"'}

    print("[+] Regression Verification PASSED: Patch is intact.")
    return True

if __name__ == "__main__":
    verify_security_patch()
`;
  } else if (lang === 'typescript') {
    code = `/**
 * Automated Security Regression Verification Test
 * Finding: ${rule}
 * Target: ${input.method.toUpperCase()} ${input.url}
 */

async function verifySecurityPatch(): Promise<boolean> {
  const url = ${JSON.stringify(input.url)};
  const headers = ${JSON.stringify(input.headers || {}, null, 2)};
  ${input.body !== undefined && input.body !== null ? `const payload = ${JSON.stringify(input.body, null, 2)};\n` : ''}
  console.log(\`[*] Verifying remediation for \${"${rule}"} at \${url}...\`);

  const response = await fetch(url, {
    method: "${input.method.toUpperCase()}",
    headers,
    ${input.body !== undefined && input.body !== null ? (isObject ? 'body: JSON.stringify(payload),' : 'body: payload,') : ''}
  });

  const text = await response.text();
  console.log(\`[*] HTTP Status: \${response.status}\`);

  // Assertions for patch validation
  if (response.status === 500) {
    throw new Error("FAILED: Server returned 500 internal error for fuzz input");
  }

  ${rule.includes('sqli') ? 'if (text.toLowerCase().includes("syntax error")) throw new Error("FAILED: Database syntax error revealed in body");' :
    rule.includes('cors') ? 'if (response.headers.get("access-control-allow-origin") === "*") throw new Error("FAILED: Permissive CORS wildcard detected");' :
    'console.log("[+] Response validation complete.");'}

  console.log("[+] Security Verification PASSED: Endpoint is protected.");
  return true;
}

verifySecurityPatch().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
`;
  } else if (lang === 'curl') {
    const rawCurl = generateCurl({
      method: input.method,
      url: input.url,
      headers: input.headers,
      body: input.body,
    });
    const escapedShellUrl = input.url.replace(/["$`\\]/g, '\\$&');

    code = `#!/usr/bin/env bash
# Automated Verification Script for ${rule}
# Runs request and verifies HTTP status and response guardrails

set -eo pipefail

echo "[*] Sending verification request to ${escapedShellUrl}..."
RESPONSE_FILE=$(mktemp)

STATUS_CODE=$(${rawCurl} -s -w "%{http_code}" -o "$RESPONSE_FILE")

echo "[*] HTTP Status: $STATUS_CODE"

if [ "$STATUS_CODE" -eq 500 ]; then
  echo "[!] FAILED: Server returned 500 Internal Server Error"
  cat "$RESPONSE_FILE"
  rm -f "$RESPONSE_FILE"
  exit 1
fi

${rule.includes('sqli') ? `if grep -qi "syntax error\\|sql" "$RESPONSE_FILE"; then
  echo "[!] FAILED: SQL syntax error leaked in response"
  rm -f "$RESPONSE_FILE"
  exit 1
fi` : ''}

echo "[+] PASSED: ${rule} verification check passed."
rm -f "$RESPONSE_FILE"
`;
  } else {
    // Go
    code = `package main

import (
\t"fmt"
\t"io"
\t"net/http"
\t"os"
\t"strings"
\t"time"
)

// Security Regression Test: ${rule}
func main() {
\ttargetURL := ${JSON.stringify(input.url)}
\tfmt.Printf("[*] Testing %s for ${rule} remediation...\\n", targetURL)

\tclient := &http.Client{Timeout: 10 * time.Second}
\treq, err := http.NewRequest("${input.method.toUpperCase()}", targetURL, ${input.body !== undefined && input.body !== null ? `strings.NewReader(${JSON.stringify(String(bodyFormatted))})` : 'nil'})
\tif err != nil {
\t\tpanic(err)
\t}

${input.headers ? Object.entries(input.headers).map(([k, v]) => `\treq.Header.Set("${k}", "${v.replace(/"/g, '\\"')}")`).join('\n') : ''}

\tresp, err := client.Do(req)
\tif err != nil {
\t\tfmt.Fprintf(os.Stderr, "[!] Network error: %v\\n", err)
\t\tos.Exit(2)
\t}
\tdefer resp.Body.Close()

\tbodyBytes, _ := io.ReadAll(resp.Body)
\tbodyStr := strings.ToLower(string(bodyBytes))

\tfmt.Printf("[*] HTTP Status: %d\\n", resp.StatusCode)
\tif resp.StatusCode == 500 {
\t\tfmt.Fprintf(os.Stderr, "[!] FAILED: Server returned 500 Internal Server Error\\n")
\t\tos.Exit(1)
\t}

\t${rule.includes('sqli') ? `if strings.Contains(bodyStr, "syntax error") {
\t\tfmt.Fprintf(os.Stderr, "[!] FAILED: SQL syntax error detected in body\\n")
\t\tos.Exit(1)
\t}` : ''}

\tfmt.Println("[+] PASSED: Security regression verification passed.")
}
`;
  }

  return {
    code: code.trim(),
    model: 'algorithmic-rules (local)',
    simulated: true,
    explanation: `Deterministic security verification script asserting remediation of ${rule}.`,
  };
}

/**
 * Generates an adaptive, self-contained reproduction and verification test script.
 * Prioritizes Chrome Built-in Prompt API (Gemini Nano on-device) framed as defensive QA,
 * and automatically falls back to deterministic synthesis if unavailable or refused.
 */
export async function generateAdaptivePoc(input: AdaptivePocInput): Promise<AdaptivePocResult> {
  const fallback = generateAlgorithmicAdaptivePoc(input);

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
      systemPrompt: `You are an elite QA and Application Security Engineer creating defensive automated regression test cases.
Given an API vulnerability finding and HTTP request details, generate a complete, standalone verification test script in ${input.language}.
CRITICAL INSTRUCTIONS:
1. Frame the script strictly as a DEFENSIVE QA verification test to verify that the security patch resolves the issue.
2. Include full request setup, expected assertions (e.g. rejecting injection or protecting boundaries), and informative pass/fail output.
3. Return ONLY valid, executable code inside a standard markdown code block. Do NOT include conversational explanations.`,
    });

    const promptText = `Generate an automated regression verification test script in ${input.language}.
Target URL: ${input.url}
HTTP Method: ${input.method.toUpperCase()}
Finding Rule: ${input.ruleId || 'N/A'}
Message: ${input.message || 'N/A'}
Evidence: ${input.evidence || 'N/A'}
Headers: ${JSON.stringify(input.headers || {})}
Payload: ${typeof input.body === 'object' ? JSON.stringify(input.body) : String(input.body || '')}
Language: ${input.language}
`;

    const response = await session.prompt(promptText);
    const extracted = extractCodeBlock(response);

    if (extracted && extracted.length > 20 && !extracted.toLowerCase().includes('i cannot assist')) {
      return {
        code: extracted,
        model: 'chrome-gemini-nano (on-device)',
        simulated: false,
        explanation: `Generated locally with Chrome Gemini Nano as an automated regression verification test for ${input.ruleId || 'this finding'}.`,
      };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[AdaptivePoC] Chrome AI inference failed or refused, using fallback:', err);
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
