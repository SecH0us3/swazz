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

  it('generates multipart upload + 2-step follow-up GET across all languages', () => {
    const uploadOpts = {
      method: 'POST',
      url: 'https://api.example.com/upload',
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': 'Bearer tok-123',
      },
      body: {
        file: {
          filename: 'swazz-polyglot.gif',
          contentType: 'image/gif',
          probeKind: 'gif_polyglot_probe',
          size: 71,
        },
        album: 'avatars',
      },
      followUpUrl: 'https://api.example.com/cdn/swazz-polyglot.gif',
    };

    const curl = generateCurl(uploadOpts);
    expect(curl).toContain('base64 -d');
    expect(curl).toContain(`-F 'file=@'"$PROBE_FILE_1"';filename=swazz-polyglot.gif;type=image/gif'`);
    expect(curl).toContain("-F 'album=avatars'");
    expect(curl).not.toContain('Content-Type: multipart/form-data');
    expect(curl).toContain(`curl -i 'https://api.example.com/cdn/swazz-polyglot.gif'`);

    const py = generatePython(uploadOpts);
    expect(py).toContain('import base64');
    expect(py).toContain('files=files');
    expect(py).toContain('requests.get("https://api.example.com/cdn/swazz-polyglot.gif"');

    const ts = generateTypeScript(uploadOpts);
    expect(ts).toContain('new FormData()');
    expect(ts).toContain('swazz-polyglot.gif');
    expect(ts).toContain('fetch("https://api.example.com/cdn/swazz-polyglot.gif"');

    const go = generateGo(uploadOpts);
    expect(go).toContain('multipart.NewWriter');
    expect(go).toContain('mw.FormDataContentType()');
    expect(go).toContain('http.NewRequest("GET", "https://api.example.com/cdn/swazz-polyglot.gif"');
  });

  it('generates raw binary upload and placeholder for unknown custom probes', () => {
    const rawOpts = {
      method: 'PUT',
      url: 'https://api.example.com/avatar',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: {
        filename: 'custom-corp.bin',
        contentType: 'application/octet-stream',
        probeKind: 'custom_upload_binary',
        size: 128,
      },
    };
    const curl = generateCurl(rawOpts);
    expect(curl).toContain(`--data-binary '@custom-corp.bin'`);
  });

  it('single-quotes followUpUrl and upload filenames so shell vars/backticks cannot expand', () => {
    const evilOpts = {
      method: 'POST',
      url: 'https://api.example.com/upload',
      headers: { Authorization: 'Bearer $SECRET' },
      body: {
        file: {
          filename: "$HOME`id`'a.png",
          contentType: 'image/png',
          probeKind: 'custom_upload_image',
        },
      },
      followUpUrl: "http://t.local/f/$AWS_SECRET_ACCESS_KEY`id`'x.svg",
    };

    const curl = generateCurl(evilOpts);
    expect(curl).not.toContain('"$AWS_SECRET_ACCESS_KEY');
    expect(curl).not.toContain('"http://t.local');
    expect(curl).toContain(`curl -i 'http://t.local/f/$AWS_SECRET_ACCESS_KEY\`id\`'\\''x.svg'`);
    expect(curl).toContain(`'file=@$HOME\`id\`'\\''a.png;filename=$HOME\`id\`'\\''a.png;type=image/png'`);
    expect(curl).toContain(`-H 'Authorization: Bearer $SECRET'`);
  });
});
