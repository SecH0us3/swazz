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
   - **Inspector**: Click on any cell in the heatmap to drill down into the fuzzed HTTP requests and responses.
     - **Mutation Diff**: Automatically compares fuzzed payloads and query parameters against the original API schemas or template structures. Mutated values are highlighted in **yellow** (for random/boundary mutations) or **red** (for malicious/security payloads), while newly added keys are highlighted in **green** and deleted keys are struck through.
     - **Raw Request**: Toggle to the raw request view to manually edit URLs, headers, and body payloads, then click **Replay** to send custom requests and view real-time responses.
   - **Configuration Management**: Configure target hosts, auth tokens, and concurrency limits directly in the browser.

## CLI Mode

The CLI is ideal for CI/CD pipelines, headless testing, and automation workflows.

### Interactive Configuration Wizard ⚡

You can fully configure advanced settings (Base settings, Authentication & Multi-Identity, SSRF Security Policy, Concurrency, Rate Limiting, Custom Dictionaries, and Endpoint Filters) without manually editing JSON by running:

```bash
cd packages/container
go run main.go wizard
```

- **Auto-Continuation**: If an existing `swazz.config.json` is found, the wizard will prompt you to edit the existing configuration or start a new one from scratch.
- **Terminal User Interface (TUI)**: Navigate options interactively using keyboard arrow keys.
- **Real-Time Input Validation**: The wizard verifies Swagger URL format, JSON bodies, custom wordlist existence, and concurrency settings in real-time.

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
  "wordlist_files": {
    "xss": "custom_xss.txt"
  },
  "authHeader": "Bearer YOUR_TOKEN_HERE",
  "concurrency": 50,
  "timeoutMs": 5000,
  "fuzzProfiles": ["xss", "sql_injection", "boundary"]
}
```

- **`targetUrl`**: The base URL of the API you are testing.
- **`openapiSpec`**: Path or URL to the OpenAPI/Swagger specification. Both JSON (`.json`) and YAML (`.yaml`/`.yml`) formats are fully supported.
- **`wordlist_files`**: Key-value mapping of payload categories to custom `.txt` wordlists. For security, files must be placed within a `wordlists/` directory.
- **`concurrency`**: Number of parallel requests to send.
- **`fuzzProfiles`**: Which payload generators to run (e.g., boundaries, malicious payloads).
- **`settings`**: Fuzzer runtime settings block, containing:
  - **`analyze_response_body`**: (Boolean) If `true`, enables response body and response header parsing. Swazz will automatically inspect:
    - **Reflected XSS**: raw script and tag reflections.
    - **SQL Injection**: database error signature leaks.
    - **Stack Traces**: information disclosure in server exceptions.
    - **Sensitive Data**: API keys, credentials, JWTs, and internal IPs.
    - **CRLF & Header Injection**: reflections of HTTP headers, unauthorized `Set-Cookie` injections, and CORS origin reflections (`Access-Control-Allow-Origin`).
    - **Response Size Anomalies**: responses significantly larger than the endpoint baseline size, indicating potential data exfiltration.
    Default is `true`.
  - **`response_size_anomaly_multiplier`**: (Float) The ratio multiplier above baseline response size required to trigger a `swazz/response-size-anomaly` warning (e.g., `5.0` for 5x larger than baseline). Default is `5.0`.
  - **`iterations_per_profile`**: (Integer) Number of fuzzing iterations to run per profile.
  - **`timeout_ms`**: (Integer) Request timeout limit in milliseconds.
  - **`bola_similarity_threshold`**: (Float) Threshold ratio for BOLA detection. Default is `0.85`.
  - **`time_anomaly_threshold_ms`**: (Integer) Threshold in milliseconds for detecting response time anomalies. Default is `4000`.
  - **`oob_server_url`**: (String) Out-of-band interaction server URL for detecting SSRF / out-of-band vulnerability trigger interactions. Default is `""`.
  - **`debug`**: (Boolean) Enables debug logging output. Default is `false`.

## Authentication Sequences & Variable Evaluation 🔐

Swazz supports complex, multi-step authentication sequences (`auth_sequence` in the configuration file). This is extremely useful for APIs that require logging in, acquiring tokens or session IDs, solving Proof-of-Work (PoW) challenges, or computing cryptographically signed headers before fuzzing.

### Configuration Fields in `auth_sequence`

Each step in `auth_sequence` can define the following fields:
*   `method`: HTTP method (e.g., `"GET"`, `"POST"`, `"PUT"`).
*   `url`: The request URL (absolute or relative to `base_url`).
*   `headers`: Headers to include in this step's request.
*   `body`: Request body data (JSON or string).
*   `extract_cookies`: Array of cookie names to extract from the response and save globally.
*   `extract_json`: Key-value mapping of response JSON fields (using dot-notation, e.g., `data.token`) to Global Header names.
*   `extract_variables`: Key-value mapping of response JSON fields to template variable names.
*   `set_variables`: Key-value mapping of template variable names to expressions utilizing built-in functions.

### Template Substitution & Variables

Variables extracted via `extract_variables` or computed via `set_variables` are stored in the global variable space. You can reference them in subsequent steps or any request by wrapping the variable name in double curly braces: `{{variable_name}}`.

```json
  "auth_sequence": [
    {
      "method": "POST",
      "url": "/api/challenge",
      "extract_variables": {
        "challenge_id": "raw_challenge"
      }
    },
    {
      "method": "POST",
      "url": "/api/solve",
      "set_variables": {
        "solved_nonce": "solvePoW({{raw_challenge}}, 4)"
      },
      "body": {
        "solution": "{{solved_nonce}}"
      }
    }
  ]
```

### Built-in Template Functions

You can use a rich set of built-in functions inside `set_variables` to generate or manipulate values:

| Function | Description | Example / Output |
| :--- | :--- | :--- |
| **Generation** | | |
| `uuid()` | Generates a new random UUID v4 string (non-deterministic). | `uuid()` |
| **String Manipulation** | | |
| `concat(a, b, ...)` | Concatenates any number of string arguments. | `concat("Bearer ", {{token}})` |
| `upper(v)` | Converts the string to uppercase. | `upper("secret")` &rarr; `"SECRET"` |
| `lower(v)` | Converts the string to lowercase. | `lower("SECRET")` &rarr; `"secret"` |
| `trim(v)` | Trims leading and trailing whitespace. | `trim("  data  ")` &rarr; `"data"` |
| `substring(v, start, end)` | Clamps bounds and extracts a 0-indexed substring from `start` (inclusive) to `end` (exclusive). | `substring("abcdef", 1, 4)` &rarr; `"bcd"` |
| **Crypto** | | |
| `sha256(v)` | Computes the SHA256 hash of the input string and returns it as a lowercase hex string. | `sha256("hello")` &rarr; `"2cf24dba..."` |
| `hmacSHA256(msg, key)` | Computes the HMAC-SHA256 signature of `msg` using `key` and returns it as a lowercase hex string. | `hmacSHA256("message", "secret")` |
| **Encoding** | | |
| `base64(v)` | Encodes the input string to standard Base64. | `base64("hello world")` &rarr; `"aGVsbG8gd29ybGQ="` |
| `hex(v)` | Encodes the input string to its hexadecimal representation. | `hex("AB")` &rarr; `"4142"` |
| **JSON** | | |
| `jsonPath(jsonStr, path)` | Parses `jsonStr` and extracts a value using dot-notation (e.g. `data.token`). | `jsonPath({{response_body}}, "data.token")` |
| **Legacy & Proof-of-Work** | | |
| `solvePoW(challenge, difficulty)` | Solves a Proof-of-Work challenge by finding an integer nonce such that the SHA256 hash of the concatenated `challenge + nonce` (hex encoded) starts with `difficulty` number of zero nibbles. | `solvePoW("challenge_token", 4)` |

## GraphQL Schema Parsing & Fuzzing 🛡️

Swazz supports fuzzing APIs that use GraphQL. It achieves this by retrieving the GraphQL schema via Introspection, mapping individual queries and mutations to virtual HTTP POST endpoints, and fuzzing their variables.

### How to use GraphQL with Swazz

1. **Provide a GraphQL Introspection Spec**:
   - In `swagger_urls`, supply the GraphQL HTTP endpoint (e.g., `http://localhost:8080/graphql`). Swazz will automatically perform an `IntrospectionQuery` POST request to fetch the schema.
   - Alternatively, you can supply a local path to a saved GraphQL Introspection JSON file (e.g., `./introspection.json`).
2. **Virtual Endpoint Generation**:
   - For every query or mutation defined in the GraphQL schema, Swazz creates a virtual GET/POST endpoint in the format:
     - `/graphql?query=QueryName`
     - `/graphql?mutation=MutationName`
   - These show up dynamically on the React Heatmap dashboard and the inspector.
3. **Payload Generation & Fuzzing**:
   - Swazz generates appropriate GraphQL requests (`{"query": "...", "variables": {...}}`).
   - The variables defined in the schema (e.g., custom input types, scalars) are fuzzed using active payloads, and Swazz monitors for any 500 Internal Server Errors, crashes, or unhandled exceptions.

## Postman Collections Import 📂

Swazz supports importing Postman Collection JSON files (v2.0.0 and v2.1.0) directly. This allows you to fuzz any API that you have already mapped in Postman without needing an OpenAPI/Swagger spec.

### How to use Postman Collections with Swazz

1. **Supply your Postman Collection JSON**:
   - In CLI mode, configure `swagger_urls` to point to a local Postman Collection JSON file (e.g. `./my_collection.json`) or a remote URL hosting it.
   - In Web UI, upload/fetch the collection using the input URL field.
2. **Endpoint Mapping & Path Variables**:
   - Swazz recursively traverses folders inside your Postman Collection and extracts all requests.
   - Path variables like `:userId` or `{{userId}}` are automatically converted to `{userId}` format.
   - If the request includes query parameters or a body (JSON payloads, URL-encoded forms, or multipart form-data), Swazz infers their schemas and fuzzes their inputs.

## SSRF Protection & Private IP Filtering 🛡️

To prevent Server-Side Request Forgery (SSRF) when Swazz is hosted as a shared remote service (e.g., in a cloud environment or Cloudflare Workers/Pages), Swazz includes built-in private IP filtering.

### Security Configurations

Swazz enforces SSRF protection by verifying resolved host IP addresses before making spec-fetching or fuzzing HTTP requests.

- **Server Mode (`swazz-engine serve`)**:
  - By default, requests targeting private IP ranges (RFC 1918, loopback, link-local) are **blocked**.
  - To allow internal API scanning, set the environment variable:
    ```bash
    export SWAZZ_ALLOW_PRIVATE_IPS=true
    ```
- **CLI Mode (`swazz-engine start`)**:
  - By default, CLI mode **allows** private IP/localhost connections to support scanning local developer APIs.
  - To block private IP connections in CLI mode, supply the command-line flag or config setting:
    ```bash
    swazz-engine start --config config.json --allow-private-ips=false
    ```
    Or in `swazz.config.json`:
    ```json
    {
      "security": {
        "allow_private_ips": false
      }
    }
    ```

## Managing False Positives & Suppressions 🙈

To reduce noise and manage false positives in automated CI/CD pipelines, Swazz supports suppressions via ignore rules.

### Triage in Web Dashboard
In the Web Dashboard, you can mark any finding in the Request Inspector detailed view as:
- **False Positive**: Marks the finding as a false alarm.
- **Ignored**: Suppresses/mutes the finding.
- **Acknowledged**: Marks the finding as confirmed.

You can download your triaged rules as `swazz.ignore.json` using the **Export Ignore Rules** button in the sidebar configuration.

### Suppressing findings in CLI/CI
Place the `swazz.ignore.json` file in your project directory (or load it via `--ignore-config <path>` flag). Swazz will automatically exclude matching findings from all generated reports (SARIF, JUnit, Markdown, HTML, JSON) and will not count them towards `--fail-on-severity` threshold breaches.

### `swazz.ignore.json` Rules Format
The file contains a JSON array of rule objects. A finding is ignored if it matches **all** non-empty criteria fields defined in the rule:
```json
[
  {
    "rule_id": "swazz/reflected-xss",
    "endpoint": "/api/search",
    "method": "GET",
    "payload": "<script>alert(1)</script>"
  },
  {
    "endpoint": "/api/admin/*",
    "method": "DELETE"
  },
  {
    "rule_id": "swazz/status-500",
    "payload": ".*(sql|syntax|database).*"
  }
]
```
- **`rule_id`**: Matches the Swazz vulnerability type (e.g. `swazz/sql-error-leak`, `swazz/reflected-xss`).
- **`endpoint`**: Supports exact matches or wildcards (e.g., `/api/admin/*`).
- **`method`**: Matches the HTTP method (case-insensitive).
- **`payload`**: Matches the sent payload (supports regex patterns or simple substring matches).

### Supported Rule IDs

When specifying a `"rule_id"` in `swazz.ignore.json`, you can target any of the following standard Swazz findings:

#### 1. System & Protocol Rules (Status Codes and Network Failures)
* **`swazz/status-5xx`** (e.g. `swazz/status-500`, `swazz/status-502`): Triggers when the target returns a 5xx Server Error.
* **`swazz/status-4xx`** (e.g. `swazz/status-400`, `swazz/status-422`): Triggers when a 4xx Client Error is returned outside of the standard ignored code list.
* **`swazz/status-2xx`** (e.g. `swazz/status-200`): Triggers when a 2xx Success code is returned for an anomalous input profile.
* **`swazz/timeout`**: Triggers when the HTTP request times out.
* **`swazz/network-error`**: Triggers when connection resets, DNS resolution fails, or other socket-level errors occur.

#### 2. Specialized Security Analyzer Rules
* **`swazz/reflected-xss`**: Reflected XSS input returned in the HTTP response.
* **`swazz/null-pointer-exception`**: Leaks of stack traces or references indicating null pointer dereferences (Java, Python, Go, Node, etc.).
* **`swazz/sql-error-leak`**: Leaks of SQL engine syntax error messages (MySQL, Postgres, MSSQL, Oracle, SQLite).
* **`swazz/stack-trace-leak`**: Leaks of program execution logs or stack traces.
* **`swazz/sensitive-data-leak`**: Leaks of AWS credentials, JWTs, SSH private keys, or API tokens.
* **`swazz/crlf-injection`**: Response header splitting vulnerabilities.
* **`swazz/cors-misconfig`**: Insecure CORS headers (wildcards or reflected origins).
* **`swazz/response-size-anomaly`**: Anomalous response size differences indicating potential unauthorized data access.


### Output Formats

In CLI mode, Swazz outputs findings into `packages/container/internal/output/`. The fuzzer currently supports multiple export formats:
- **JSON**: Detailed machine-readable output.
- **HTML**: A static report of the findings, featuring an executive summary that groups all findings by their corresponding **OWASP API Security Top 10 (2023)** categories.
- **SARIF**: For integration into GitHub Advanced Security and other SAST/DAST tools.

### UI Performance Optimization

The Swazz Web Dashboard is optimized to handle high-concurrency fuzzing runs. The following strategies keep the interface fluid and responsive:
- **Localized Cell Hover**: Heatmap cells manage their own hover states locally. Moving the cursor over the grid does not trigger expensive dashboard or full-grid re-renders.
- **Memoized Rows**: Endpoint rows use `React.memo` with custom value comparison. A row only updates when its specific endpoint stats change.
- **Findings Pagination**: Both the **Grouped Errors** and **OWASP Top 10** lists cap expanded category views to 50 items by default. A "Show More" button allows loading additional results incrementally, avoiding DOM bloat and lagging.

[← Back to Installation](./installation.html) | [Next: Architecture →](./architecture.html)
