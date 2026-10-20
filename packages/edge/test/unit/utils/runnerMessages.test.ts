// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { sanitizeRunnerText, runnerErrorText, MAX_RUNNER_MESSAGE_LENGTH } from '../../../src/utils/runnerMessages';

describe('runner messages shown to users', () => {
  it('keeps an ordinary message as it is', () => {
    expect(sanitizeRunnerText('failed to connect to MCP server: SSE connection failed with status 401'))
      .toBe('failed to connect to MCP server: SSE connection failed with status 401');
  });

  it('reduces it to one line without control characters or terminal colors', () => {
    expect(sanitizeRunnerText('line one\r\nline\ttwo\u0000\u001b[31m red\u001b[0m\u0085'))
      .toBe('line one line two red');
  });

  it('cuts off stack traces, which only expose internal paths', () => {
    expect(sanitizeRunnerText('runner crashed\ngoroutine 42 [running]:\nmain.run()\n\t/home/svc/agent.go:12 +0x1f'))
      .toBe('runner crashed');
    expect(sanitizeRunnerText('TypeError: x is undefined\n    at handle (/srv/app/dist/index.js:10:5)'))
      .toBe('TypeError: x is undefined');
    expect(sanitizeRunnerText('boom\n/build/internal/runner/init_run.go:89: here')).toBe('boom');
    expect(sanitizeRunnerText('panic: runtime error: index out of range')).toBe('');
  });

  // Go's HTTP errors quote the full URL; its userinfo or query may carry a token, and everyone with
  // access to the project sees a failed scan's reason.
  it('keeps URLs to scheme, host and path', () => {
    expect(sanitizeRunnerText('Get "https://user:pw@mcp.example.com:8443/sse?token=SECRET#x": dial tcp: refused'))
      .toBe('Get "https://…@mcp.example.com:8443/sse?…#…": dial tcp: refused');
    expect(sanitizeRunnerText('see http://h.example/a/b and wss://x.io/ws?k=v')).toBe('see http://h.example/a/b and wss://x.io/ws?…');
    expect(sanitizeRunnerText('bad http://[::1')).toBe('bad (URL)');
    expect(runnerErrorText({ error: 'post https://h/p?api_key=abc failed' })).toBe('post https://h/p?… failed');
  });

  it('bounds the length', () => {
    const text = sanitizeRunnerText('x'.repeat(5000));
    expect(text.length).toBe(MAX_RUNNER_MESSAGE_LENGTH);
    expect(text.endsWith('…')).toBe(true);
  });

  it('turns anything else into text', () => {
    expect(sanitizeRunnerText(undefined)).toBe('');
    expect(sanitizeRunnerText(null)).toBe('');
    expect(sanitizeRunnerText(42)).toBe('42');
    expect(sanitizeRunnerText({ a: 1 })).toBe('{"a":1}');
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(sanitizeRunnerText(cyclic)).toBe('[object Object]');
  });

  it('reads the error text from every shape a runner error comes in', () => {
    expect(runnerErrorText({ error: 'a' })).toBe('a');
    expect(runnerErrorText('{"error":"b"}')).toBe('b');
    expect(runnerErrorText({ type: 'error', data: 'c' })).toBe('c');
    expect(runnerErrorText({ type: 'error', data: { message: 'd' } })).toBe('d');
    expect(runnerErrorText({ type: 'error', data: { error: 'e' } })).toBe('e');
    expect(runnerErrorText('plain text, not JSON')).toBe('plain text, not JSON');
    expect(runnerErrorText({ type: 'error', data: { code: 7 } })).toBe('');
    expect(runnerErrorText({ error: 7 })).toBe('');
    expect(runnerErrorText(null)).toBe('');
    expect(runnerErrorText({ error: 'boom\ngoroutine 1 [running]:' })).toBe('boom');
  });
});
