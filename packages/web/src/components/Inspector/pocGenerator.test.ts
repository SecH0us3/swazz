// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { generateCurl, generatePython, generateTypeScript, generateGo } from './pocGenerator.js';

describe('PoC Exploit Generators', () => {
  const options = {
    method: 'POST',
    url: 'https://api.example.com/api/profile',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token'
    },
    body: JSON.parse('{"__proto__":{"polluted":"true"},"role":"admin"}')
  };

  it('generates executable curl command with headers and payload', () => {
    const curl = generateCurl(options);
    expect(curl).toContain('curl -X POST "https://api.example.com/api/profile"');
    expect(curl).toContain('-H "Content-Type: application/json"');
    expect(curl).toContain('-H "Authorization: Bearer test-token"');
    expect(curl).toContain('--data-raw');
    expect(curl).toContain('polluted');
  });

  it('generates python requests script', () => {
    const py = generatePython(options);
    expect(py).toContain('import requests');
    expect(py).toContain('url = "https://api.example.com/api/profile"');
    expect(py).toContain('requests.post');
    expect(py).toContain('json=json_payload');
  });

  it('generates typescript fetch script', () => {
    const ts = generateTypeScript(options);
    expect(ts).toContain('async function exploit()');
    expect(ts).toContain('fetch(url,');
    expect(ts).toContain('method: "POST"');
  });

  it('generates Go net/http script', () => {
    const go = generateGo(options);
    expect(go).toContain('package main');
    expect(go).toContain('http.NewRequest("POST"');
    expect(go).toContain('req.Header.Set("Authorization"');
  });
});
