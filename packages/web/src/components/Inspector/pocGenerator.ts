// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { extractUploadParts, synthesizeProbeContent, type ExtractedUploadParts, type UploadFileMeta } from './uploadPocUtils.js';

export interface PocRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  followUpUrl?: string;
}

function stripContentTypeForMultipart(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type' && v.toLowerCase().includes('multipart/form-data')) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

function headersForFollowUpGet(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'content-type' || lower === 'content-length') continue;
    out[k] = v;
  }
  return out;
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function formatCurlFileCreation(varName: string, file: UploadFileMeta): string[] {
  const syn = synthesizeProbeContent(file);
  if (syn.kind === 'placeholder') {
    return [];
  }
  if (syn.kind === 'base64') {
    return [
      `${varName}=$(mktemp)`,
      `printf '%s' ${shellSingleQuote(syn.content || '')} | base64 -d > "$${varName}"`,
    ];
  }
  return [
    `${varName}=$(mktemp)`,
    `printf '%s' ${shellSingleQuote(syn.content || '')} > "$${varName}"`,
  ];
}

function generateUploadCurl(options: PocRequestOptions, upload: ExtractedUploadParts): string {
  const cleanHeaders = upload.isRawBinary ? (options.headers || {}) : stripContentTypeForMultipart(options.headers);
  const setupLines: string[] = [];
  const tempVars: string[] = [];
  const curlLines: string[] = [`curl -X ${options.method.toUpperCase()} ${shellSingleQuote(options.url)}`];

  for (const [key, value] of Object.entries(cleanHeaders)) {
    curlLines.push(`-H ${shellSingleQuote(`${key}: ${value}`)}`);
  }

  upload.files.forEach((part, idx) => {
    const syn = synthesizeProbeContent(part.file);
    if (syn.kind === 'placeholder') {
      if (upload.isRawBinary) {
        curlLines.push(`--data-binary ${shellSingleQuote(`@${part.file.filename}`)}`);
      } else {
        curlLines.push(`-F ${shellSingleQuote(`${part.field}=@${part.file.filename};filename=${part.file.filename};type=${part.file.contentType}`)}`);
      }
      return;
    }
    const varName = `PROBE_FILE_${idx + 1}`;
    tempVars.push(`"$${varName}"`);
    setupLines.push(...formatCurlFileCreation(varName, part.file));
    if (upload.isRawBinary) {
      curlLines.push(`--data-binary "@$${varName}"`);
    } else {
      curlLines.push(`-F ${shellSingleQuote(`${part.field}=@`)}"$${varName}"${shellSingleQuote(`;filename=${part.file.filename};type=${part.file.contentType}`)}`);
    }
  });

  for (const f of upload.fields) {
    curlLines.push(`-F ${shellSingleQuote(`${f.field}=${f.value}`)}`);
  }

  const parts: string[] = [];
  if (tempVars.length > 0) {
    parts.push(...setupLines);
    parts.push(`trap 'rm -f ${tempVars.join(' ')}' EXIT`);
  }
  parts.push(curlLines.join(' \\\n  '));

  if (options.followUpUrl) {
    const followHeaders = headersForFollowUpGet(options.headers);
    const getLines = [`curl -i ${shellSingleQuote(options.followUpUrl)}`];
    for (const [key, value] of Object.entries(followHeaders)) {
      getLines.push(`-H ${shellSingleQuote(`${key}: ${value}`)}`);
    }
    parts.push('', '# Step 2: Second-order follow-up verification', getLines.join(' \\\n  '));
  }

  return parts.join('\n');
}

export function generateCurl(options: PocRequestOptions): string {
  const upload = extractUploadParts(options.body);
  if (upload) {
    return generateUploadCurl(options, upload);
  }

  // One shell argument group per line, joined with backslash continuations so the
  // command stays readable and is still pasteable straight into a shell.
  const lines: string[] = [`curl -X ${options.method.toUpperCase()} "${options.url}"`];

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      lines.push(`-H "${key}: ${value.replace(/"/g, '\\"')}"`);
    }
  }

  if (options.body !== undefined && options.body !== null) {
    const bodyStr = typeof options.body === 'object' ? JSON.stringify(options.body) : String(options.body);
    lines.push(`--data-raw '${bodyStr.replace(/'/g, "'\\''")}'`);
  }

  const step1 = lines.join(' \\\n  ');
  if (!options.followUpUrl) return step1;

  const followHeaders = headersForFollowUpGet(options.headers);
  const getLines = [`curl -i ${shellSingleQuote(options.followUpUrl)}`];
  for (const [key, value] of Object.entries(followHeaders)) {
    getLines.push(`-H ${shellSingleQuote(`${key}: ${value}`)}`);
  }
  return `${step1}\n\n# Step 2: Second-order follow-up verification\n${getLines.join(' \\\n  ')}`;
}

function pyProbeExpr(file: UploadFileMeta): string {
  const syn = synthesizeProbeContent(file);
  if (syn.kind === 'base64') {
    return `base64.b64decode(${JSON.stringify(syn.content || '')})`;
  }
  if (syn.kind === 'text') {
    return `${JSON.stringify(syn.content || '')}.encode("utf-8")`;
  }
  return `open(${JSON.stringify(file.filename)}, "rb").read()`;
}

export function generatePython(options: PocRequestOptions): string {
  const upload = extractUploadParts(options.body);
  if (upload) {
    const needsBase64 = upload.files.some(p => synthesizeProbeContent(p.file).kind === 'base64');
    const cleanHeaders = upload.isRawBinary ? (options.headers || {}) : stripContentTypeForMultipart(options.headers);
    const followHeaders = headersForFollowUpGet(options.headers);
    const fileEntries = upload.files.map(
      p => `    (${JSON.stringify(p.field)}, (${JSON.stringify(p.file.filename)}, ${pyProbeExpr(p.file)}, ${JSON.stringify(p.file.contentType)}))`,
    );
    const fieldObj = Object.fromEntries(upload.fields.map(f => [f.field, f.value]));

    return `${needsBase64 ? 'import base64\n' : ''}import requests

url = ${JSON.stringify(options.url)}
headers = ${JSON.stringify(cleanHeaders, null, 4)}
${upload.isRawBinary
  ? `raw_data = ${pyProbeExpr(upload.files[0].file)}
response = requests.request(
    method=${JSON.stringify(options.method.toUpperCase())},
    url=url,
    headers=headers,
    data=raw_data,
    timeout=10,
)`
  : `files = [\n${fileEntries.join(',\n')},\n]
${upload.fields.length > 0 ? `data = ${JSON.stringify(fieldObj, null, 4)}\n` : ''}response = requests.request(
    method=${JSON.stringify(options.method.toUpperCase())},
    url=url,
    headers=headers,
    files=files,
${upload.fields.length > 0 ? '    data=data,\n' : ''}    timeout=10,
)`}

print(f"Upload Status: {response.status_code}")
print(response.text)
${options.followUpUrl ? `
# Step 2: Second-order follow-up verification
follow_headers = ${JSON.stringify(followHeaders, null, 4)}
follow_resp = requests.get(${JSON.stringify(options.followUpUrl)}, headers=follow_headers, timeout=10)
print(f"Follow-up GET Status: {follow_resp.status_code}")
print(follow_resp.text[:500])` : ''}
`;
  }

  const method = options.method.toLowerCase();
  const headersJson = options.headers ? JSON.stringify(options.headers, null, 4) : '{}';
  const hasBody = options.body !== undefined && options.body !== null;
  const isObject = typeof options.body === 'object';

  let bodyCode = '';
  if (hasBody) {
    if (isObject) {
      bodyCode = `json_payload = ${JSON.stringify(options.body, null, 4)}\n`;
    } else {
      bodyCode = `raw_data = ${JSON.stringify(String(options.body))}\n`;
    }
  }

  const reqLine = method === 'post' || method === 'put' || method === 'patch'
    ? `response = requests.${method}(\n    url=url,\n    headers=headers,\n    ${isObject ? 'json=json_payload,' : 'data=raw_data,'}\n    timeout=10\n)`
    : `response = requests.request(\n    method="${options.method.toUpperCase()}",\n    url=url,\n    headers=headers,\n    ${hasBody ? (isObject ? 'json=json_payload,' : 'data=raw_data,') : ''}\n    timeout=10\n)`;

  return `import requests
import json

url = "${options.url}"
headers = ${headersJson}
${bodyCode}
${reqLine}

print(f"Status: {response.status_code}")
print(response.text)
${options.followUpUrl ? `
# Step 2: Second-order follow-up verification
follow_headers = ${JSON.stringify(headersForFollowUpGet(options.headers), null, 4)}
follow_resp = requests.get(${JSON.stringify(options.followUpUrl)}, headers=follow_headers, timeout=10)
print(f"Follow-up GET Status: {follow_resp.status_code}")
print(follow_resp.text[:500])` : ''}
`;
}

function tsProbeBytesExpr(file: UploadFileMeta): string {
  const syn = synthesizeProbeContent(file);
  if (syn.kind === 'base64') {
    return `Uint8Array.from(atob(${JSON.stringify(syn.content || '')}), (c) => c.charCodeAt(0))`;
  }
  if (syn.kind === 'text') {
    return `new TextEncoder().encode(${JSON.stringify(syn.content || '')})`;
  }
  return `new Uint8Array(0) /* replace with bytes of ${file.filename} */`;
}

export function generateTypeScript(options: PocRequestOptions): string {
  const upload = extractUploadParts(options.body);
  if (upload) {
    const cleanHeaders = upload.isRawBinary ? (options.headers || {}) : stripContentTypeForMultipart(options.headers);
    const followHeaders = headersForFollowUpGet(options.headers);

    const bodySetup = upload.isRawBinary
      ? `  const bytes = ${tsProbeBytesExpr(upload.files[0].file)};\n  const body = new Blob([bytes], { type: ${JSON.stringify(upload.files[0].file.contentType)} });`
      : [
          '  const form = new FormData();',
          ...upload.files.map(
            (p, idx) =>
              `  const fileBytes${idx + 1} = ${tsProbeBytesExpr(p.file)};\n  form.append(${JSON.stringify(p.field)}, new Blob([fileBytes${idx + 1}], { type: ${JSON.stringify(p.file.contentType)} }), ${JSON.stringify(p.file.filename)});`,
          ),
          ...upload.fields.map(f => `  form.append(${JSON.stringify(f.field)}, ${JSON.stringify(f.value)});`),
          '  const body = form;',
        ].join('\n');

    return `async function exploit(): Promise<void> {
  const url = ${JSON.stringify(options.url)};
${bodySetup}
  const response = await fetch(url, {
    method: ${JSON.stringify(options.method.toUpperCase())},
    headers: ${JSON.stringify(cleanHeaders, null, 4)},
    body,
  });

  console.log(\`Upload Status: \${response.status}\`);
  console.log(await response.text());
${options.followUpUrl ? `
  // Step 2: Second-order follow-up verification
  const followResp = await fetch(${JSON.stringify(options.followUpUrl)}, {
    headers: ${JSON.stringify(followHeaders, null, 4)},
  });
  console.log(\`Follow-up GET Status: \${followResp.status}\`);
  console.log((await followResp.text()).slice(0, 500));` : ''}
}

exploit().catch(console.error);
`;
  }

  const hasBody = options.body !== undefined && options.body !== null;
  const isObject = typeof options.body === 'object';
  const bodyParam = hasBody 
    ? (isObject ? `JSON.stringify(${JSON.stringify(options.body, null, 2)})` : JSON.stringify(String(options.body)))
    : null;

  return `async function exploit(): Promise<void> {
  const url = "${options.url}";
  const response = await fetch(url, {
    method: "${options.method.toUpperCase()}",
    headers: ${JSON.stringify(options.headers || {}, null, 4)},
    ${bodyParam ? `body: ${bodyParam},` : ''}
  });

  const status = response.status;
  const body = await response.text();
  console.log(\`Status: \${status}\`);
  console.log(body);
${options.followUpUrl ? `
  // Step 2: Second-order follow-up verification
  const followResp = await fetch(${JSON.stringify(options.followUpUrl)}, {
    headers: ${JSON.stringify(headersForFollowUpGet(options.headers), null, 4)},
  });
  console.log(\`Follow-up GET Status: \${followResp.status}\`);
  console.log((await followResp.text()).slice(0, 500));` : ''}
}

exploit().catch(console.error);
`;
}

function goProbeBytesExpr(file: UploadFileMeta): { expr: string; needsBase64: boolean; needsOs: boolean } {
  const syn = synthesizeProbeContent(file);
  if (syn.kind === 'base64') {
    return { expr: `func() []byte { b, _ := base64.StdEncoding.DecodeString(${JSON.stringify(syn.content || '')}); return b }()`, needsBase64: true, needsOs: false };
  }
  if (syn.kind === 'text') {
    return { expr: `[]byte(${JSON.stringify(syn.content || '')})`, needsBase64: false, needsOs: false };
  }
  return { expr: `func() []byte { b, _ := os.ReadFile(${JSON.stringify(file.filename)}); return b }()`, needsBase64: false, needsOs: true };
}

export function generateGo(options: PocRequestOptions): string {
  const upload = extractUploadParts(options.body);
  if (upload) {
    const cleanHeaders = upload.isRawBinary ? (options.headers || {}) : stripContentTypeForMultipart(options.headers);
    const followHeaders = headersForFollowUpGet(options.headers);
    const fileSpecs = upload.files.map(p => ({ p, go: goProbeBytesExpr(p.file) }));
    const needsBase64 = fileSpecs.some(s => s.go.needsBase64);
    const needsOs = fileSpecs.some(s => s.go.needsOs);

    const imports = ['"bytes"'];
    if (needsBase64) imports.push('"encoding/base64"');
    imports.push('"fmt"', '"io"');
    if (!upload.isRawBinary) imports.push('"mime/multipart"', '"net/textproto"');
    imports.push('"net/http"');
    if (needsOs) imports.push('"os"');
    imports.sort();

    const headerLines = Object.entries(cleanHeaders)
      .map(([k, v]) => `\treq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
      .join('\n');

    const bodyCode = upload.isRawBinary
      ? `\treqBody := bytes.NewReader(${fileSpecs[0].go.expr})`
      : [
          '\tvar buf bytes.Buffer',
          '\tmw := multipart.NewWriter(&buf)',
          ...fileSpecs.map((s, idx) => [
            `\th${idx + 1} := make(textproto.MIMEHeader)`,
            `\th${idx + 1}.Set("Content-Disposition", fmt.Sprintf(\`form-data; name="%s"; filename="%s"\`, ${JSON.stringify(s.p.field)}, ${JSON.stringify(s.p.file.filename)}))`,
            `\th${idx + 1}.Set("Content-Type", ${JSON.stringify(s.p.file.contentType)})`,
            `\tpart${idx + 1}, _ := mw.CreatePart(h${idx + 1})`,
            `\t_, _ = part${idx + 1}.Write(${s.go.expr})`,
          ].join('\n')),
          ...upload.fields.map(f => `\t_ = mw.WriteField(${JSON.stringify(f.field)}, ${JSON.stringify(f.value)})`),
          '\t_ = mw.Close()',
          '\treqBody := &buf',
        ].join('\n');

    const followGoHeaders = Object.entries(followHeaders)
      .map(([k, v]) => `\tfollowReq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
      .join('\n');

    return `package main

import (
\t${imports.join('\n\t')}
)

func main() {
\ttargetURL := ${JSON.stringify(options.url)}
${bodyCode}
\treq, err := http.NewRequest(${JSON.stringify(options.method.toUpperCase())}, targetURL, reqBody)
\tif err != nil {
\t\tpanic(err)
\t}
${!upload.isRawBinary ? '\treq.Header.Set("Content-Type", mw.FormDataContentType())\n' : ''}${headerLines ? headerLines + '\n' : ''}
\tclient := &http.Client{}
\tresp, err := client.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()

\trespBody, _ := io.ReadAll(resp.Body)
\tfmt.Printf("Upload Status: %d\\n", resp.StatusCode)
\tfmt.Println(string(respBody))
${options.followUpUrl ? `
\t// Step 2: Second-order follow-up verification
\tfollowReq, err := http.NewRequest("GET", ${JSON.stringify(options.followUpUrl)}, nil)
\tif err != nil {
\t\tpanic(err)
\t}
${followGoHeaders ? followGoHeaders + '\n' : ''}\tfollowResp, err := client.Do(followReq)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer followResp.Body.Close()
\tfollowBody, _ := io.ReadAll(followResp.Body)
\tfmt.Printf("Follow-up GET Status: %d\\n", followResp.StatusCode)
\tfmt.Println(string(followBody))` : ''}
}
`;
  }

  const hasBody = options.body !== undefined && options.body !== null;
  const bodyStr = hasBody ? (typeof options.body === 'object' ? JSON.stringify(options.body) : String(options.body)) : '';

  const headerLines = options.headers
    ? Object.entries(options.headers).map(([k, v]) => `\treq.Header.Set("${k}", "${v.replace(/"/g, '\\"')}")`).join('\n')
    : '';

  return `package main

import (
\t"fmt"
\t"io"
\t"net/http"
\t"strings"
)

func main() {
\turl := "${options.url}"
\tvar reqBody io.Reader
${hasBody ? `\treqBody = strings.NewReader(${JSON.stringify(bodyStr)})\n` : ""}
\treq, err := http.NewRequest("${options.method.toUpperCase()}", url, reqBody)
\tif err != nil {
\t\tpanic(err)
\t}
${headerLines ? headerLines + "\n" : ""}
\tclient := &http.Client{}
\tresp, err := client.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()

\trespBody, _ := io.ReadAll(resp.Body)
\tfmt.Printf("Status: %d\\n", resp.StatusCode)
\tfmt.Println(string(respBody))
}
`;
}
