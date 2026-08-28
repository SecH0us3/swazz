// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

export interface PocRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}

export function generateCurl(options: PocRequestOptions): string {
  const parts: string[] = ['curl', '-X', options.method.toUpperCase(), `"${options.url}"`];

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      parts.push('-H', `"${key}: ${value.replace(/"/g, '\\"')}"`);
    }
  }

  if (options.body !== undefined && options.body !== null) {
    const bodyStr = typeof options.body === 'object' ? JSON.stringify(options.body) : String(options.body);
    parts.push('--data-raw', `'${bodyStr.replace(/'/g, "'\\''")}'`);
  }

  return parts.join(' ');
}

export function generatePython(options: PocRequestOptions): string {
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
`;
}

export function generateTypeScript(options: PocRequestOptions): string {
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
}

exploit().catch(console.error);
`;
}

export function generateGo(options: PocRequestOptions): string {
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
