// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { codeFromReply, generateAdaptivePoc, generateAlgorithmicAdaptivePoc, ruleKind } from './adaptivePocService';
import * as chromeAiModule from './chromeAiService';

describe('adaptivePocService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).ai;
    delete (globalThis as any).LanguageModel;
  });

  it('maps real rule IDs to the check the template asserts', () => {
    expect(ruleKind('swazz/sql-error-leak')).toBe('sql');
    expect(ruleKind('swazz/time-based-sqli')).toBe('sql');
    expect(ruleKind('swazz/sqli')).toBe('sql');
    expect(ruleKind('swazz/nosql-injection')).toBe('other');
    expect(ruleKind('swazz/reflected-xss')).toBe('xss');
    expect(ruleKind('swazz/ssrf-cloud-metadata')).toBe('ssrf');
    expect(ruleKind('swazz/oob-interaction')).toBe('ssrf');
    expect(ruleKind('swazz/cors-misconfig')).toBe('cors');
    expect(ruleKind('swazz/stack-trace-leak')).toBe('other');
    expect(ruleKind(undefined)).toBe('other');
  });

  it('asserts on SQL errors for swazz/sql-error-leak in every language', () => {
    const input = { ...sampleInput, ruleId: 'swazz/sql-error-leak' };
    expect(generateAlgorithmicAdaptivePoc({ ...input, language: 'python' }).code).toContain('SQL syntax leakage');
    expect(generateAlgorithmicAdaptivePoc({ ...input, language: 'typescript' }).code).toContain('Database syntax error');
    expect(generateAlgorithmicAdaptivePoc({ ...input, language: 'curl' }).code).toContain('SQL syntax error leaked');
    expect(generateAlgorithmicAdaptivePoc({ ...input, language: 'go' }).code).toContain('SQL syntax error detected');
    expect(generateAlgorithmicAdaptivePoc({ ...input, ruleId: 'swazz/nosql-injection' }).code).not.toContain('SQL syntax leakage');
  });

  it('uses the current global LanguageModel Prompt API with initialPrompts', async () => {
    const session = { prompt: vi.fn().mockResolvedValue('```python\nprint("verification script ok")\n```'), destroy: vi.fn() };
    const create = vi.fn().mockResolvedValue(session);
    (globalThis as any).LanguageModel = { availability: vi.fn().mockResolvedValue('available'), create };

    const result = await generateAdaptivePoc(sampleInput);

    expect(result.simulated).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
    expect(create.mock.calls[0][0].initialPrompts[0].role).toBe('system');
    expect(session.destroy).toHaveBeenCalled();
  });

  function fakeStream(chunks: string[]) {
    let i = 0;
    return {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        releaseLock: () => {},
      }),
    };
  }

  function readyModel(session: any) {
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue(session),
    };
  }

  it('streams the script as the model writes it', async () => {
    const session = {
      promptStreaming: vi.fn(() => fakeStream(['```python\nimport ', 'requests\nprint("verification ok")\n', '```'])),
      prompt: vi.fn(),
      destroy: vi.fn(),
    };
    readyModel(session);
    const partials: string[] = [];

    const result = await generateAdaptivePoc(sampleInput, { onPartial: t => partials.push(t) });

    expect(session.prompt).not.toHaveBeenCalled();
    expect(partials).toEqual([
      '```python\nimport ',
      '```python\nimport requests\nprint("verification ok")\n',
      '```python\nimport requests\nprint("verification ok")\n```',
    ]);
    expect(result.simulated).toBe(false);
    expect(result.code).toBe('import requests\nprint("verification ok")');
    expect(session.destroy).toHaveBeenCalled();
  });

  it('reads the legacy API stream, whose chunks repeat the text so far', async () => {
    const session = {
      promptStreaming: vi.fn(() => fakeStream(['```go\npackage', '```go\npackage main // verification\n```'])),
      destroy: vi.fn(),
    };
    (globalThis as any).ai = {
      languageModel: { availability: vi.fn().mockResolvedValue('readily'), create: vi.fn().mockResolvedValue(session) },
    };
    const result = await generateAdaptivePoc({ ...sampleInput, language: 'go' });
    expect(result.code).toBe('package main // verification');
  });

  it('appends current-API chunks even when one starts with the text so far', async () => {
    const session = { promptStreaming: vi.fn(() => fakeStream(['\n', '\n```python\nprint("verification ok")\n```'])), destroy: vi.fn() };
    readyModel(session);
    const partials: string[] = [];
    await generateAdaptivePoc(sampleInput, { onPartial: t => partials.push(t) });
    expect(partials[1]).toBe('\n\n```python\nprint("verification ok")\n```');
  });

  it('destroys a session that arrives after the caller gave up', async () => {
    const session = { prompt: vi.fn(), destroy: vi.fn() };
    let resolveCreate: (s: any) => void = () => {};
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn(() => new Promise(r => { resolveCreate = r; })),
    };
    const controller = new AbortController();
    const pending = generateAdaptivePoc(sampleInput, { signal: controller.signal });
    await vi.waitFor(() => expect((globalThis as any).LanguageModel.create).toHaveBeenCalled());
    expect((globalThis as any).LanguageModel.create.mock.calls[0][0].signal).toBeDefined();
    controller.abort();
    await pending;
    resolveCreate(session);
    await vi.waitFor(() => expect(session.destroy).toHaveBeenCalledTimes(1));
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('uses the template when the model takes too long', async () => {
    const session = { prompt: vi.fn((_text: string, _opts: { signal: AbortSignal }) => new Promise(() => {})), destroy: vi.fn() };
    readyModel(session);
    const result = await generateAdaptivePoc(sampleInput, { timeoutMs: 20 });
    expect(result.simulated).toBe(true);
    expect(result.fallbackReason).toBe('timeout');
    expect(session.prompt.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(session.destroy).toHaveBeenCalled();
  });

  it('stops when the caller aborts', async () => {
    const session = { prompt: vi.fn(() => new Promise(() => {})), destroy: vi.fn() };
    readyModel(session);
    const controller = new AbortController();
    const pending = generateAdaptivePoc(sampleInput, { signal: controller.signal });
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result.simulated).toBe(true);
    expect(result.fallbackReason).toBeUndefined();
    expect(session.destroy).toHaveBeenCalled();
  });

  it('finds the code in a reply, finished or still streaming', () => {
    expect(codeFromReply('```python\nimport req', true)).toBe('import req');
    expect(codeFromReply('Here is the test:\n```python\nimport req', true)).toBe('import req');
    expect(codeFromReply('```python\ncode\n``', true)).toBe('code');
    expect(codeFromReply('```\nx = 1\n```\nsome trailing text')).toBe('x = 1');
    expect(codeFromReply('Sure:\n```go\npackage main\n```')).toBe('package main');
    expect(codeFromReply('plain text')).toBe('plain text');
  });

  it('says the template was used because the on-device model is not downloaded yet', async () => {
    const create = vi.fn();
    (globalThis as any).LanguageModel = { availability: vi.fn().mockResolvedValue('downloadable'), create };
    const result = await generateAdaptivePoc(sampleInput);
    expect(result.fallbackReason).toBe('downloadable');
    expect(create).not.toHaveBeenCalled();
  });

  it('checks SQL error signatures, not any mention of SQL', () => {
    const input = { ...sampleInput, ruleId: 'swazz/sql-error-leak' };
    const py = generateAlgorithmicAdaptivePoc({ ...input, language: 'python' }).code;
    expect(py).not.toContain('"sql" not in body_text');
    expect(py).toContain('"sqlstate"');
    const curl = generateAlgorithmicAdaptivePoc({ ...input, language: 'curl' }).code;
    expect(curl).toContain('grep -qiE "syntax error|sqlstate|');
    expect(curl).not.toContain('\\|sql"');
  });

  it('says the template was used because no on-device model is available', async () => {
    const result = await generateAdaptivePoc(sampleInput);
    expect(result.simulated).toBe(true);
    expect(result.fallbackReason).toBe('unavailable');
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
    expect(result.fallbackReason).toBe('failed');
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

