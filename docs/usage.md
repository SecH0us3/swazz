---
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

The fuzzer engine relies on a JSON configuration file. It fully supports **JSONC** (JSON with Comments), meaning you can use single-line (`//`) and multi-line (`/* */`) comments. Here is an example:

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

Variables extracted via `extract_variables` or computed via `set_variables` are stored in the global variable space. You can reference them in subsequent steps or any request by wrapping the variable name in double curly braces: <code v-pre>{{variable_name}}</code>.

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
| `concat(a, b, ...)` | Concatenates any number of string arguments. | <code v-pre>concat("Bearer ", {{token}})</code> |
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
| `jsonPath(jsonStr, path)` | Parses `jsonStr` and extracts a value using dot-notation (e.g. `data.token`). | <code v-pre>jsonPath({{response_body}}, "data.token")</code> |
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
   - Path variables like `:userId` or <code v-pre>{{userId}}</code> are automatically converted to `{userId}` format.
   - If the request includes query parameters or a body (JSON payloads, URL-encoded forms, or multipart form-data), Swazz infers their schemas and fuzzes their inputs.

## HAR (HTTP Archive) Fuzzing 📂

Swazz supports importing `.har` (HTTP Archive) files directly. This enables **Zero-Setup Fuzzing**—you can export a browser session capturing real-world user flows (e.g., from Chrome or Firefox Developer Tools) and replay/fuzz those exact endpoints and payloads immediately without requiring any OpenAPI/Swagger specification.

### How to use HAR files with Swazz

1. **Record a browser session**:
   - Open your browser's Developer Tools (`F12`), go to the **Network** tab, and check **Preserve Log**.
   - Perform the actions you want to fuzz (e.g., login, create a resource, update settings, delete items).
   - Right-click anywhere in the network request list and select **Save all as HAR with content**.
2. **Supply your HAR file to Swazz**:
   - **Web UI**: In the Configuration Sidebar, select your `.har` file in the spec upload field.
   - **CLI Mode**: Configure `"swagger_urls"` in your `swazz.config.json` to point to a local `.har` file or a remote URL hosting it:
     ```json
     {
       "swagger_urls": ["./my_browser_session.har"]
     }
     ```
3. **Advanced HAR Configuration**:
   - **Type & Schema Inference**: Since HAR files only capture raw request/response data, Swazz's engine automatically analyzes the structure of each captured query parameter and JSON request body to reconstruct an active schema representation. Values are typed as `string`, `integer`, `boolean`, `array`, or `object`, enabling the generator to intelligently mutate payloads.
   - **HAR Domain Regex Filter**: Browser logs often capture noisy requests to analytics trackers, CDNs, or third-party assets. You can filter these out by setting `har_domain_filter` to a regular expression (matching the hosts you want to include).
     - **Web UI**: Enter your regex in the **HAR Domain Filter** field.
     - **JSON Config**: Add the setting:
       ```json
       "settings": {
         "har_domain_filter": "^api\\.example\\.com$"
       }
       ```
   - **Authentication & Concurrency Integration**: Swazz's concurrent runner pool manages stateful authorization checks during replay fuzzing. If you define an `auth_sequence` in your configuration, Swazz's concurrent worker pool will automatically overwrite any outdated credentials/tokens captured inside the HAR file with fresh ones, preventing HTTP workers from failing due to session expiration.

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

## Automated Session & CSRF Management 🔐

When fuzzing stateful or protected APIs, maintaining valid authenticated sessions and handling anti-CSRF measures is critical to ensure that fuzzing payloads reach the backend logic rather than being rejected prematurely at the auth gateway. Swazz automates this process dynamically throughout the run.

### Dynamic Session Recovery (Re-Authentication)

Swazz monitors all outgoing fuzzing requests that rely on the configured active session. If the session expires or is invalidated during a run, Swazz automatically detects it and triggers the configured `auth_sequence` to obtain new credentials.

- **Expiration Indicators**: A session is classified as expired if:
  - The response status is `401 Unauthorized` or `403 Forbidden`.
  - The response redirects (status `3xx`) to a path containing `/login`, `/signin`, or `/auth`.
  - The response is a `200 OK` HTML page containing a standard login form (e.g., `<form>` with `password`/`username`/`email` inputs and login/signin labels).
- **Safe Re-Authentication Lock**: To prevent dozens of concurrent fuzzing workers from triggering the `auth_sequence` simultaneously (which can cause account lockouts or rate-limits), Swazz coordinates re-authentication via a mutex lock. The first worker to detect expiration performs the authentication flow while other workers queue. Once re-authentication completes, the queued workers resume using the newly acquired active session.
- **Infinite Loop Protection**: Requests are capped at a maximum of `1` retry to prevent infinite re-authentication loops in the event of persistent credential invalidity.
- **Selective Inspection**: Expiration checks are skipped for explicit security/privilege check queries (like BOLA/IDOR scans targeting different/unprivileged identities) to preserve expected vulnerability findings.

### Automated CSRF Management

For unsafe HTTP write requests (`POST`, `PUT`, `PATCH`, `DELETE`), Swazz dynamically extracts and injects anti-CSRF/anti-XSRF tokens to bypass cross-site request forgery protections.

1. **Extraction**: Swazz parses every HTTP response (including intermediate login responses) to extract active anti-CSRF tokens from:
   - Response cookies whose names match/contain `csrf` or `xsrf` (case-insensitive).
   - HTML meta tags (e.g. `<meta name="csrf-token" content="...">`).
   - HTML input forms (e.g. `<input name="csrf_token" value="...">`).
2. **Injection**: Before executing an unsafe request, Swazz automatically:
   - Overwrites or inserts CSRF headers matching `X-CSRF-Token`, `X-XSRF-Token`, or any customized headers containing `csrf`/`xsrf` with the latest extracted token.
   - Updates any keys containing `csrf` or `xsrf` in the request payload body (for JSON and url-encoded forms) with the fresh active token.

---

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
* **`swazz/csp-missing`**: Missing Content Security Policy (CSP) header on HTML pages.
* **`swazz/csp-unsafe-directive`**: Insecure or overly permissive CSP directives (e.g. `'unsafe-inline'`, `'unsafe-eval'`, or wildcard `*`).
* **`swazz/response-size-anomaly`**: Anomalous response size differences indicating potential unauthorized data access.


### Output Formats

In CLI mode, Swazz outputs findings into `packages/container/internal/output/`. The fuzzer currently supports multiple export formats:
- **JSON**: Detailed machine-readable output.
- **HTML**: A static report of the findings, featuring an executive summary that groups all findings by their corresponding **OWASP Top 10 (2025)** categories.
- **SARIF**: For integration into GitHub Advanced Security and other SAST/DAST tools.

### UI Performance Optimization

The Swazz Web Dashboard is optimized to handle high-concurrency fuzzing runs. The following strategies keep the interface fluid and responsive:
- **Localized Cell Hover**: Heatmap cells manage their own hover states locally. Moving the cursor over the grid does not trigger expensive dashboard or full-grid re-renders.
- **Memoized Rows**: Endpoint rows use `React.memo` with custom value comparison. A row only updates when its specific endpoint stats change.
- **Findings Pagination**: Both the **Grouped Errors** and **OWASP Top 10** lists cap expanded category views to 50 items by default. A "Show More" button allows loading additional results incrementally, avoiding DOM bloat and lagging.
## 🔒 Privacy & Account Deletion (Right to be Forgotten)

Swazz values user privacy and complies with GDPR requirements. If you wish to delete your account and all associated data, you can do so immediately from the dashboard settings page:

1. Click on **Settings** in the dashboard header.
2. In the left column, scroll down to the **Danger Zone** card.
3. Click **Delete My Account & Data**.
4. Confirm the permanent deletion warning when prompted by clicking **Yes, delete permanently**.

This action will immediately and irreversibly purge:
- Your user profile, API key, and credentials
- All associated projects and project memberships
- All scan histories and result databases from the D1 database
- All fuzzer report archive files (.enc) from R2 object storage
- Active WebSocket runner connections associated with your account
- All local browser history, cache, credentials, and IndexedDB databases

---

[← Back to Installation](./installation.md) | [Next: Architecture →](./architecture.md)
