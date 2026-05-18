---
layout: default
title: Usage
---

# Usage & Configuration 🚀

Swazz provides two primary methods of operation: a feature-rich Web UI Dashboard and a powerful CLI.

## Web UI Dashboard

The Web UI is the easiest way to manage your fuzzer, inspect requests, and visually analyze results.

1. **Start the Web UI**  
   Run `npm run dev` from the project root. This starts the React frontend and Go API.
2. **Dashboard Features**
   - **Heatmap**: Visualizes the `Endpoint × Status Code` responses in real time. Perfect for quickly identifying anomalous 500 errors or unexpected 200s.
   - **Inspector**: Click on any cell in the heatmap to drill down into the raw HTTP requests and responses. Filter by method or status.
   - **Configuration Management**: Configure target hosts, auth tokens, and concurrency limits directly in the browser.

## CLI Mode

The CLI is ideal for CI/CD pipelines, headless testing, and automation workflows.

### Basic Command

```bash
cd packages/container
go run main.go start --config swazz.config.json
```

### Configuration File (`swazz.config.json`)

The fuzzer engine relies on a JSON configuration file. Here is an example of what it looks like:

```json
{
  "targetUrl": "https://api.example.com",
  "openapiSpec": "https://api.example.com/openapi.yaml",
  "authHeader": "Bearer YOUR_TOKEN_HERE",
  "concurrency": 50,
  "timeoutMs": 5000,
  "fuzzProfiles": ["xss", "sql_injection", "boundary"]
}
```

- **`targetUrl`**: The base URL of the API you are testing.
- **`openapiSpec`**: Path or URL to the OpenAPI/Swagger specification.
- **`concurrency`**: Number of parallel requests to send.
- **`fuzzProfiles`**: Which payload generators to run (e.g., boundaries, malicious payloads).

### Output Formats

In CLI mode, Swazz outputs findings into `packages/container/internal/output/`. The fuzzer currently supports multiple export formats:
- **JSON**: Detailed machine-readable output.
- **HTML**: A static report of the findings.
- **SARIF**: For integration into GitHub Advanced Security and other SAST/DAST tools.

[← Back to Installation](./installation.html) | [Next: Architecture →](./architecture.html)
