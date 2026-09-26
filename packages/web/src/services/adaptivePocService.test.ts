// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAdaptivePoc, generateAlgorithmicAdaptivePoc } from './adaptivePocService';
import * as chromeAiModule from './chromeAiService';

describe('adaptivePocService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleInput = {
    method: 'GET',
    url: 'https://api.example.com/users?id=1%27%20OR%201=1--',
    headers: { 'Authorization': 'Bearer test-token' },
    body: undefined,
    language: 'python' as const,
    ruleId: 'swazz/sqli',
    message: 'SQL Injection detected in query parameter',
    level: 'error',
    evidence: 'syntax error near OR 1=1'
  };

  it('generates deterministic algorithmic adaptive PoC with assertions for Python', () => {
    const result = generateAlgorithmicAdaptivePoc(sampleInput);

    expect(result.code).toContain('import requests');
    expect(result.code).toContain('assert response.status_code');
    expect(result.code).toContain('swazz/sqli');
    expect(result.code).toContain('Regression Verification');
    expect(result.simulated).toBe(true);
  });

  it('generates deterministic algorithmic adaptive PoC with assertions for TypeScript', () => {
    const result = generateAlgorithmicAdaptivePoc({
      ...sampleInput,
      language: 'typescript'
    });

    expect(result.code).toContain('async function verifySecurityPatch');
    expect(result.code).toContain('swazz/sqli');
    expect(result.code).toContain('fetch(');
  });

  it('generates deterministic algorithmic adaptive PoC with assertions for cURL', () => {
    const result = generateAlgorithmicAdaptivePoc({
      ...sampleInput,
      language: 'curl'
    });

    expect(result.code).toContain('curl -X');
    expect(result.code).toContain('-s -w "%{http_code}"');
    expect(result.code).toContain('swazz/sqli');
    expect(result.code).toContain('PASSED');
  });

  it('generates deterministic algorithmic adaptive PoC with assertions for Go', () => {
    const result = generateAlgorithmicAdaptivePoc({
      ...sampleInput,
      language: 'go'
    });

    expect(result.code).toContain('package main');
    expect(result.code).toContain('http.NewRequest');
    expect(result.code).toContain('swazz/sqli');
  });

  it('uses Chrome AI when available on-device', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue(`\`\`\`python
import requests

def verify_patch():
    # Defensive regression test for SQLi
    res = requests.get("${sampleInput.url}")
    assert "syntax error" not in res.text, "SQL error leaked"
    print("Verification PASSED: Vulnerability successfully remediated")

if __name__ == "__main__":
    verify_patch()
\`\`\``),
      destroy: vi.fn()
    };

    (globalThis as any).ai = {
      languageModel: {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockResolvedValue(mockSession)
      }
    };

    const result = await generateAdaptivePoc(sampleInput);

    expect(result.simulated).toBe(false);
    expect(result.model).toContain('gemini-nano');
    expect(result.code).toContain('verify_patch');
    expect(result.code).toContain('assert');
  });

  it('falls back to algorithmic generator when Chrome AI prompt fails or is refused', async () => {
    (globalThis as any).ai = {
      languageModel: {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockRejectedValue(new Error('Prompt refused by safety policy'))
      }
    };

    const result = await generateAdaptivePoc(sampleInput);

    expect(result.simulated).toBe(true);
    expect(result.model).toContain('algorithmic-rules');
    expect(result.code).toContain('assert');
  });

  it('correctly formats Python script with json.loads and properly escaped URL/payload', () => {
    const result = generateAlgorithmicAdaptivePoc({
      method: 'POST',
      url: 'https://api.example.com/search?q="test"',
      headers: { 'Content-Type': 'application/json' },
      body: { active: true, fallback: null, query: 'admin" OR 1=1--' },
      language: 'python',
      ruleId: 'swazz/sqli'
    });

    expect(result.code).toContain('import json');
    expect(result.code).toContain('TARGET_URL = "https://api.example.com/search?q=\\"test\\""');
    expect(result.code).toContain('HEADERS = json.loads(');
    expect(result.code).toContain('PAYLOAD = json.loads(');
    expect(result.code).toMatch(/PAYLOAD = json\.loads\("{\\?"active\\?":\s*true/);
  });

  it('correctly formats TypeScript script with properly escaped URL', () => {
    const result = generateAlgorithmicAdaptivePoc({
      method: 'GET',
      url: 'https://api.example.com/test?query="quoted"',
      language: 'typescript',
      ruleId: 'swazz/xss'
    });

    expect(result.code).toContain('const url = "https://api.example.com/test?query=\\"quoted\\"";');
  });

  it('correctly formats Go script with backticks in body and properly escaped URL', () => {
    const result = generateAlgorithmicAdaptivePoc({
      method: 'POST',
      url: 'https://api.example.com/run?id="xyz"',
      body: 'echo `id`',
      language: 'go',
      ruleId: 'swazz/cmdi'
    });

    expect(result.code).toContain('targetURL := "https://api.example.com/run?id=\\"xyz\\""');
    expect(result.code).toContain('strings.NewReader("echo `id`")');
    expect(result.code).not.toContain('strings.NewReader(`echo `id``)');
  });

  it('correctly escapes URL containing quotes and dollar signs in cURL echo statement', () => {
    const result = generateAlgorithmicAdaptivePoc({
      method: 'GET',
      url: 'https://api.example.com/eval?expr="$(whoami)"&tag="test"',
      language: 'curl',
      ruleId: 'swazz/cmdi'
    });

    expect(result.code).toContain('echo "[*] Sending verification request to https://api.example.com/eval?expr=\\"\\$(whoami)\\"&tag=\\"test\\"..."');
  });
});

