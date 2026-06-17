# 🗺 Swazz Roadmap

This roadmap tracks planned features, documentation improvements, and architectural changes for the **Swazz** fuzzer. 

> **AI Assistant Note:** Antigravity can automatically execute these tasks. Just say: *"Antigravity, start working on task X"* and the AI will implement the feature and check it off the list.

## 📝 Documentation & Onboarding

- [x] **Task 1:** Create `SECURITY.md` to establish a formal vulnerability reporting process and security policy.
- [x] **Task 2:** Add a comprehensive CI/CD integration guide (`docs/ci_cd.md`) with a working GitHub Actions example for SARIF reporting.
- [ ] **Task 3:** Add high-quality screenshots or GIFs of the Web Dashboard (Heatmap, Inspector) to the `README.md`. *(Depends on: Task 12)*
- [x] **Task 4:** Create `CONTRIBUTING.md` (and `docs/contributing.md`) with local setup instructions, code standards, and testing guides (`go test ./...`).
- [x] **Task 10:** Upgrade the documentation site to a modern theme with built-in search and interactive code examples (e.g., using "Just the Docs" Jekyll theme or migrating to Docusaurus/VitePress).
- [x] **Task 11:** Design and add an Open Graph social preview image (1280x640) for the GitHub repository and documentation site.
- [x] **Task 12:** Create a local "Vulnerable Demo API" (e.g., in a `demo/` folder) so users can immediately test Swazz capabilities out of the box.

## ⚙️ Core Engine & Fuzzing Capabilities

- [x] **Task 5:** Implement dynamic custom wordlists loading from `.txt` files via `swazz.config.json` (and update the corresponding documentation).
- [x] **Task 6:** Investigate and implement GraphQL schema parsing and fuzzing support.
- [x] **Task 17:** Add support for SOAP (WSDL) protocol fuzzing and XML payload generation.
- [x] **Task 7:** Add support for importing Postman Collections alongside OpenAPI specs. *(Depends on: Task 6)*
- [x] **Task 18:** Implement a configurable Private IP / Localhost filter (SSRF Protection) for remote/cloud deployments.
  - **Design Goal:** Protect centralized cloud instances (e.g., hosted on Cloudflare Workers/Pages or cloud VMs) from being abused to scan internal corporate networks, cloud metadata endpoints (`169.254.169.254`), or loopback interfaces, while preserving the ability for local CLI and self-hosted users to scan local development APIs (`localhost`).
  - **Implementation Details:**
    - Introduce `security.allow_private_ips` in `swazz.config.json` and a CLI flag `--allow-private-ips`.
    - At runtime, default to `false` in server mode (`serve`) unless overridden by configuration or environment variable `SWAZZ_ALLOW_PRIVATE_IPS=true`. Default to `true` in CLI mode (`start`).
    - Wrap the HTTP transport dialer in [detect.go](./packages/container/internal/swagger/detect.go) and [runner.go](./packages/container/internal/runner/runner.go) with custom IP verification logic. Resolve hostnames to IPs and block RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), and link-local (`169.254.0.0/16`) ranges when the filter is active.
    - Return a standardized error `request blocked by SSRF policy` on violation.

## 🎨 Web Dashboard Enhancements

- [x] **Task 8:** Add export functionality in the Web UI to download the HTML/JSON report directly from the browser.
- [x] **Task 20:** Decouple React state in the Web Dashboard by migrating global state to a React Context or Zustand store.
  - **Design Goal:** Eliminate rendering lag and interface blocking in the browser when streaming high-concurrency fuzzing runs, especially on lower-end local developer machines.
  - **Implementation Details:**
    - Refactor [App.tsx](./packages/web/src/App.tsx) to move live session state (`logs`, `heatmapStats`, `activeTab`, `liveCount`, `isRunning`, `isPaused`) out of the root element into a Zustand store or optimized React Context.
    - Implement selector-based rendering so that fast-updating values (such as logs or request counters) only trigger re-renders in their respective sub-components rather than the entire workspace layout (sidebar, header, dictionaries, etc.).
- [x] **Task 21:** Add visual mutation highlighting (request diff-view) to the request Inspector.
  - **Design Goal:** Allow developers and security auditors to instantly spot exactly what parameters, headers, or request body keys were modified by the generator during a specific fuzz iteration.
  - **Implementation Details:**
    - In `RequestDetail.tsx`, render a visual diff view comparing the original API request schema/template against the generated fuzzed request payload.
    - Highlight mutated query values in yellow, added structure keys in green, and injected payloads/vulnerability inputs in red.
    - Add a toggle switch in the Inspector pane to flip between "Raw Fuzzed Request" and "Mutation Diff".
- [x] **Task 36:** Relocate target input (`header-target-input`) into the `header-top-row` (centered) if screen width allows.
  - **Design Goal:** Improve dashboard space utilization by reducing the header height on desktop while keeping the interface mobile-friendly.
  - **Implementation Details:**
    - Use CSS media queries or responsive flex layouts to align the target input centered inside `header-top-row` on desktop.
    - On mobile/small screens, keep the input positioned in its own row below (as it is currently) to prevent cramming.

## 🛡 Internal Security & Infrastructure

- [x] **Task 13:** Harden the Dockerfile (multi-stage build, distroless base, non-root user) and integrate Trivy image vulnerability scanning into GitHub Actions.
- [x] **Task 14:** Setup Static Application Security Testing (SAST) for Swazz itself using `gosec` (Go Security Checker) and GitHub CodeQL. *(Depends on: Task 2)*
- [x] **Task 15:** Configure Dependabot or Renovate to automatically update Go modules and npm dependencies.
- [ ] **Task 22:** Implement E2E browser automation tests using Playwright.
  - **Design Goal:** Ensure full integration verification between the Vite frontend SPA, Go REST API server, SSE engine, and IndexedDB local client storage during continuous integration builds.
  - **Implementation Details:**
    - Create a suite of TypeScript Playwright tests under a new directory `tests/e2e/`.
    - Configure GitHub Actions to spin up the local Vulnerable Demo API, start `swazz-engine serve`, build/run the React application, automate the browser to trigger a demo fuzzing run, and assert that findings are properly populated on the heatmap grid and can be exported.
- [x] **Task 23:** Pin all GitHub Actions in `.github/workflows/` to specific commit SHAs (commit-level pinning).
  - **Design Goal:** Hardening CI/CD security against potential compromised third-party GitHub Action repository tags (Supply Chain protection).
  - **Implementation Details:**
    - Replace version tags (e.g. `actions/checkout@v4`, `actions/setup-go@v5`) in `.github/workflows/` with exact 40-character commit hashes.
    - Document human-readable version equivalents as line comments above each pinned step (e.g. `# v4.1.2`).
    - Configure Dependabot to support and automatically update commit-pinned action dependencies.

## ⚡️ Performance & Architecture

- [x] **Task 16:** Replace the blocking select-timeout SSE Broadcast implementation with a non-blocking lock-free concurrent collection or ring-buffer pattern (similar to LMAX Disruptor or a lock-free MPSC ring-buffer queue).
- [x] **Task 19:** Reduce Mutex contention in the Go runner by refactoring statistical aggregation to run off-thread via channels/batching.
  - **Design Goal:** Unlock maximum hardware utilization during local CLI runs. Under high concurrency configurations, worker threads must not get blocked waiting for the single global stats mutex.
  - **Implementation Details:**
    - Modify [runner.go](./packages/container/internal/runner/runner.go) and [stats.go](./packages/container/internal/runner/stats.go) to remove immediate calls to `r.mu.Lock()` from request completion hooks.
    - Implement a buffered stats channel `statsChan chan *swagger.FuzzResult`. Workers will send results asynchronously.
    - Run an internal background goroutine to consume results from `statsChan`, accumulate statistics locally in-memory, and publish aggregated updates to the UI/SSE emitter at a fixed interval - [x] **Task 33:** Cache `getActiveMaliciousStrings()` result in generator constructor.
  - **Design Goal:** Eliminate redundant slice allocations on every payload generation call under high concurrency.
  - **Implementation Details:**
    - In [generator.go](./packages/container/internal/generator/generator.go), the function `getActiveMaliciousStrings()` (L317-336) rebuilds a `[]any` slice from `payloads.MaliciousEncoding`, `payloads.MaliciousSQLi`, `payloads.MaliciousXSS`, `payloads.MaliciousPathTraversal` on **every call**. Under MALICIOUS profile with high concurrency, this causes thousands of unnecessary allocations.
    - Add a new field `cachedMaliciousStrings []any` to the `Generator` struct (L12-24).
    - In `New()` (L27-48), after building `activeCategories`, call `getActiveMaliciousStrings()` once and store the result in `cachedMaliciousStrings`.
    - Replace all call sites of `getActiveMaliciousStrings()` (used in `generateMaliciousValue()` L268 and `MinIterationsNeeded()` L78) with reads from `g.cachedMaliciousStrings`.

## 🔍 Detection & Analysis

> **Current Gap:** The [classifier](./packages/container/internal/classifier/classifier.go) is purely status-code-based — `ruleIDForResult()` (L189-197) only generates IDs `swazz/status-{code}`, `swazz/timeout`, `swazz/network-error`. The runner's `executeRequest()` (L424-603 in [runner.go](./packages/container/internal/runner/runner.go)) reads response bodies only for status ≥ 400 (limited to 51200 bytes), and for status < 400 **drains the body to `/dev/null`**. This means swazz sends XSS, SQLi, and CRLF payloads from [malicious.go](./packages/container/internal/generator/payloads/malicious.go) but has no mechanism to verify if they succeed. The tasks below transform swazz from a "status-code stress tester" into a true vulnerability scanner.

- [x] **Task 24:** Implement Response Body Analysis engine for detecting reflected vulnerabilities and data leakage.
  - **Design Goal:** Detect real vulnerability confirmations by analyzing HTTP response bodies, not just status codes. This is the single highest-impact improvement for swazz as a security tool.
  - **Implementation Details:**
    - **New package:** Create `packages/container/internal/analyzer/` with:
      - `analyzer.go` — Define `ResponseAnalyzer` interface:
        ```go
        type AnalysisInput struct {
            SentPayload   any               // from FuzzResult.Payload
            ResponseBody  []byte            // raw body bytes
            ResponseHeaders http.Header     // for header-based checks (Task 26)
            Duration      int64             // for time-based checks (Task 25)
            Profile       swagger.FuzzingProfile
            Endpoint      string
            Method        string
        }
        type AnalysisFinding struct {
            RuleID   string
            Level    string  // "error", "warning", "note"
            Message  string
            Evidence string  // the matched fragment
        }
        type ResponseAnalyzer interface {
            Analyze(input *AnalysisInput) []AnalysisFinding
        }
        ```
      - `xss.go` — **Reflected XSS Analyzer:** For MALICIOUS profile requests, extract the sent XSS payload strings (the 10 payloads from `payloads.MaliciousXSS` in [malicious.go](./packages/container/internal/generator/payloads/malicious.go) L42-53, including `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `"><svg/onload=alert(1)>`, etc.). Search the response body for exact matches (case-insensitive). If the payload appears unescaped in the response → `AnalysisFinding{RuleID: "swazz/reflected-xss", Level: "error"}`. Exclude matches where the payload is inside JSON string values that are properly escaped.
      - `sqli.go` — **SQL Error Detector:** Match response body against a curated set of database error signatures (compiled `*regexp.Regexp` pool, initialized once in `init()`):
        - MySQL: `You have an error in your SQL syntax`, `mysql_fetch`, `MySQLSyntaxErrorException`
        - PostgreSQL: `ERROR:  syntax error at or near`, `pg_query`, `PSQLException`
        - SQLite: `SQLITE_ERROR`, `near ".*": syntax error`
        - MSSQL: `Unclosed quotation mark`, `Microsoft OLE DB`, `ODBC SQL Server Driver`
        - Oracle: `ORA-\d{5}`, `quoted string not properly terminated`
        - Generic: `SQLSTATE\[\w+\]`, `java.sql.SQLException`, `System.Data.SqlClient`
        Rule ID: `swazz/sql-error-leak`, Level: `error`. Evidence field = matched fragment (up to 200 chars, surrounding context ±50 chars).
      - `stacktrace.go` — **Stack Trace Leak:** Detect server tracebacks:
        - Java: `at java.`, `at sun.`, `at org.springframework.`, `.java:\d+\)`
        - Python: `Traceback (most recent call last)`, `File ".*", line \d+`
        - Go: `goroutine \d+ \[`, `panic:`, `runtime error:`
        - Node.js: `at Object.<anonymous>`, `at Module._compile`, `node_modules/`
        - .NET: `at System.`, `System.NullReferenceException`, `Server Error in`
        - PHP: `Fatal error:`, `Stack trace:`, `in /var/www/`
        Rule ID: `swazz/stack-trace-leak`, Level: `warning` (Information Disclosure).
      - `sensitive.go` — **Sensitive Data Patterns:** Regex-based detection of secrets that shouldn't appear in API responses:
        - AWS keys: `AKIA[0-9A-Z]{16}`
        - Private keys: `-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----`
        - JWT tokens: `eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+`
        - Internal IPs: `(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})`
        - Generic API keys: `(api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?\w{20,}`
        Rule ID: `swazz/sensitive-data-leak`, Level: `warning`.
      - `registry.go` — `AnalyzerRegistry` struct that holds `[]ResponseAnalyzer` and runs them sequentially, aggregating findings.
    - **Runner integration:** In [runner.go](./packages/container/internal/runner/runner.go) `executeRequest()` (L424-603):
      - **Critical change:** For **all** status codes (not just ≥ 400), read the response body (up to `maxBodyRead = 51200` bytes). Currently, lines ~L580-590 drain successful responses to `/dev/null` — replace this with body capture when `analyze_response_body` is enabled.
      - After building the `FuzzResult`, call `r.analyzer.Analyze(&AnalysisInput{...})`. For each returned `AnalysisFinding`, wrap it into a `classifier.Finding` (reusing the [Finding struct](./packages/container/internal/classifier/classifier.go) at L22-36) and broadcast via `r.Broadcast(Event{Type: EventResult, Data: finding})`.
      - Store analysis findings in `r.results` alongside status-code findings so they appear in `GetReport()` (L441 of [handlers.go](./packages/container/api/handlers.go)).
    - **FuzzResult extension:** In [types.go](./packages/container/internal/swagger/types.go) L98-112, add `ResponseSize int64` field to `FuzzResult`. Populate it in `executeRequest()` from `Content-Length` header or actual bytes read.
    - **Classifier extension:** In [classifier.go](./packages/container/internal/classifier/classifier.go), add a `Source string` field to `Finding` (L22-36): `"status_code"` (default for existing logic) or `"response_body"` (for analyzer findings). This allows the dashboard and reports to distinguish between the two finding sources.
    - **Config:** In [types.go](./packages/container/internal/swagger/types.go) `Settings` struct (L71-82), add `AnalyzeResponseBody bool` (default `true` in `DefaultSettings()` L85-94). Wire through to the runner constructor.
    - **Tests:** Create `packages/container/internal/analyzer/xss_test.go`, `sqli_test.go`, `stacktrace_test.go`, `sensitive_test.go` — each with table-driven tests covering true positive, true negative, and edge cases (e.g., properly HTML-escaped XSS, SQL keywords in legitimate data).

- [x] **Task 25:** Implement Time-Based Injection Detection for blind SQLi and command injection.
  - **Design Goal:** Detect blind SQL injection and OS command injection by measuring response time anomalies when time-delay payloads are sent. The 12 SQLi payloads in `payloads.MaliciousSQLi` ([malicious.go](./packages/container/internal/generator/payloads/malicious.go) L25-38) already include `' OR SLEEP(5)--`, `'; WAITFOR DELAY '0:0:5'--` — but the runner ignores timing. *(Depends on: Task 24 analyzer architecture)*
  - **Implementation Details:**
    - **Baseline collection:** In the [Runner](./packages/container/internal/runner/runner.go) struct (L35-73), add a `baselines sync.Map` mapping `endpointKey (method+path)` → `*EndpointBaseline{medianMs int64, sampleCount int}`. During RANDOM profile execution (which runs first by default per `DefaultSettings().Profiles` order), collect response durations. After ≥5 samples, compute a rolling median and store it.
    - **New analyzer** `packages/container/internal/analyzer/timing.go`:
      - Implement `ResponseAnalyzer` interface.
      - Tag time-delay payloads: compile a set of known delay patterns (`SLEEP`, `WAITFOR`, `pg_sleep`, `BENCHMARK(`, `AND SLEEP`). Check if `input.SentPayload` (stringified) contains any pattern.
      - If the payload is a delay payload AND `input.Duration >= baseline.medianMs + thresholdMs` → emit `AnalysisFinding{RuleID: "swazz/time-based-sqli"}`.
      - For OS command injection payloads (`;sleep 5`, `| sleep 5`), use rule ID `swazz/time-based-cmdi`.
      - Evidence = `"Baseline: {X}ms, Observed: {Y}ms, Payload: {Z}"`.
    - **FuzzResult.Duration** already exists (L104 in [types.go](./packages/container/internal/swagger/types.go)) and is populated in `executeRequest()`. No struct changes needed.
    - **Config:** Add `TimeAnomalyThresholdMs int` to `Settings` (L71-82), default `4000` in `DefaultSettings()`.
    - **Dashboard:** In [StatsBar.tsx](./packages/web/src/components/Dashboard/StatsBar.tsx), add an "Avg Response Time" metric sourced from `RunStats`.
    - **Tests:** Use `httptest.Server` with artificial `time.Sleep()` to simulate vulnerable endpoints. Test edge cases: legitimate slow endpoints, network jitter tolerance.

- [x] **Task 26:** Implement Header Injection and CRLF Detection via response header analysis.
  - **Design Goal:** Verify whether CRLF injection payloads successfully inject headers into the HTTP response. The 13 encoding payloads in `payloads.MaliciousEncoding` ([malicious.go](./packages/container/internal/generator/payloads/malicious.go) L7-21) already include CRLF sequences (`\r\n`, `%0d%0a`, null bytes) — but response headers are never inspected.
  - **Implementation Details:**
    - **Runner change:** In `executeRequest()` ([runner.go](./packages/container/internal/runner/runner.go) L424-603), capture `resp.Header` (the `http.Header` map) and pass it through the analyzer pipeline via `AnalysisInput.ResponseHeaders`. Currently, response headers are completely discarded after reading the body.
    - **FuzzResult extension:** In [types.go](./packages/container/internal/swagger/types.go), add `ResponseHeaders map[string][]string` to `FuzzResult` (L98-112). Note: for `FuzzResultSSE` (L117-131), do NOT include full headers — only flag a boolean `HasHeaderInjection bool` to avoid excessive SSE payload sizes (the event channel is buffered at 512 per subscriber in [events.go](./packages/container/internal/runner/events.go)).
    - **New analyzer** `packages/container/internal/analyzer/crlf.go`:
      - Check for attacker-controlled headers: iterate `input.ResponseHeaders`, look for header names that match fragments of the sent CRLF payload (e.g., if payload contained `\r\nX-Injected: true`, check if `X-Injected` exists in response headers).
      - Check for injected `Set-Cookie` headers that weren't expected: compare response `Set-Cookie` values against substrings from the sent payload.
      - CORS reflection check: if payload was injected into `Origin`-like context, check if `Access-Control-Allow-Origin` reflects the injected value verbatim.
      - Rule IDs: `swazz/crlf-injection` (Level: `error`) for confirmed header injection, `swazz/header-injection` (Level: `warning`) for suspicious reflection.
    - **Tests:** Use `httptest.Server` that intentionally reflects CRLF sequences. Test with Go's `net/http` server which has built-in CRLF protections (to ensure false positive rate is low), and a raw TCP-based test server for true positive validation.

- [x] **Task 27:** Implement Response Size Anomaly Detection for data exfiltration indicators.
  - **Design Goal:** Detect potential data leakage by flagging responses significantly larger than the endpoint's baseline response size. An SQL injection that triggers a full table dump, for example, will produce a response orders of magnitude larger than normal.
  - **Implementation Details:**
    - **FuzzResult extension:** Add `ResponseSize int64` to `FuzzResult` in [types.go](./packages/container/internal/swagger/types.go) (L98-112). Populate from `resp.ContentLength` or actual bytes read in `executeRequest()` ([runner.go](./packages/container/internal/runner/runner.go)). For `FuzzResultSSE` (L117-131), add `ResponseSize int64` field — it's a small scalar, safe for SSE bandwidth.
    - **Baseline tracking:** Extend the `baselines sync.Map` from Task 25 (or create a separate `sizeBaselines sync.Map`) to track per-endpoint `{medianSize int64, sampleCount int}`. Collect during RANDOM profile.
    - **New analyzer** `packages/container/internal/analyzer/size.go`:
      - Compare `input.ResponseSize` against `baseline.medianSize * multiplier` (configurable, default `5x`).
      - Only flag for MALICIOUS profile requests (RANDOM/BOUNDARY size variance is expected).
      - Rule ID: `swazz/response-size-anomaly`, Level: `warning`.
      - Evidence = `"Baseline: {X} bytes, Observed: {Y} bytes ({N}x larger)"`.
    - **Stats integration:** In [stats.go](./packages/container/internal/runner/stats.go), extend `accumulateResult()` (L106-124) to track `TotalResponseBytes int64` and `MaxResponseSize int64`. Add these fields to `RunStats` in [types.go](./packages/container/internal/swagger/types.go) (L134-145).
    - **Dashboard:** In [StatsBar.tsx](./packages/web/src/components/Dashboard/StatsBar.tsx), add "Total Data Received" and "Max Response" metrics. In `FuzzingSlice` of [appStore.ts](./packages/web/src/store/appStore.ts), map the new stats fields.
    - **Config:** Add `ResponseSizeAnomalyMultiplier float64` to `Settings` (default `5.0`).

## 🔐 Authorization & Access Control Testing

- [x] **Task 28:** Implement BOLA/IDOR (Broken Object-Level Authorization) testing with multi-identity support.
  - **Design Goal:** Detect OWASP API Security #1 vulnerability. The existing [auth.go](./packages/container/internal/runner/auth.go) already supports multi-step auth sequences with cookie extraction (`ExtractCookies` L108-130), JSON field extraction (`ExtractJSON` L132-173), and template variable substitution (`substituteInObject` L222-241). This task extends that system to support **two concurrent identities** and reliable ID harvesting/correlation to prevent false negatives.
  - **Implementation Details:**
    - **Config extension:** In [types.go](./packages/container/internal/swagger/types.go), add to `Config` (L38-50):
      ```go
      AuthIdentities map[string]AuthIdentity `json:"auth_identities,omitempty"`
      ```
      Where `AuthIdentity` is a new struct:
      ```go
      type AuthIdentity struct {
          AuthSequence []AuthStep        `json:"auth_sequence"`
          Headers      map[string]string `json:"headers,omitempty"`
          Cookies      map[string]string `json:"cookies,omitempty"`
      }
      ```
      Also allow explicit variable extraction/parameters mapping on endpoints:
      ```go
      // In EndpointConfig:
      ExtractVariables map[string]string `json:"extract_variables,omitempty"` // JSONPath -> Variable name
      ParamsMapping    map[string]string `json:"params_mapping,omitempty"`    // URL Param -> Variable name
      ```
    - **ID Harvesting & Correlation (Two Approaches):**
      1. **Heuristic Harvesting:** During the main fuzz run under User A, inspect successful `200 OK` JSON responses. Walk the JSON tree and harvest values matching ID patterns (e.g. `id`, `uuid`, `*_id`). Store these IDs mapped to the endpoint's path prefix (e.g., `/api/goods`). When BOLA testing an endpoint like `POST /api/goods/{id}` under User B, look up harvested IDs for `/api/goods` prefix and replay the request substituting `{id}` with the harvested value.
      2. **Explicit Mapping:** If `extract_variables` and `params_mapping` are configured, extract parameters from User A's responses using the configured JSONPath keys and save them as named variables. Then, substitute them in User B's replay requests according to `params_mapping`.
    - **New package:** Create `packages/container/internal/bola/`:
      - `bola.go` — `BOLATester` struct. After the main fuzz run completes (triggered from the `EventComplete` handler), collect all `FuzzResult`s with `Status >= 200 && Status < 300` from endpoints that contain path parameters (regex match `\{[^}]+\}` in `EndpointConfig.Path`). For each such result:
        1. Execute auth sequence for identity B (reusing `RunAuthSequence()` from [auth.go](./packages/container/internal/runner/auth.go) L20-178 — refactor to accept an `AuthIdentity` parameter instead of reading from `r.config.AuthSequence` directly).
        2. Replay the exact same request (same URL, same body) but with identity B's headers/cookies. If the response status is still `2xx` → emit `classifier.Finding{RuleID: "swazz/bola-idor", Level: SeverityError}`.
        3. **Anonymous access check:** Replay the exact same request but drop only the **authentication credentials** (the specific headers/cookies defined in `AuthHeaders`/`AuthCookies` settings, plus those dynamically extracted during the `AuthSequence`). This ensures structural headers like `Content-Type` are kept to prevent server-side format errors, while actual credentials are removed. If the response status is still `2xx` → emit `classifier.Finding{RuleID: "swazz/unauthorized-access", Level: SeverityError}`.
      - `bola_test.go` — Use `httptest.Server` with two user contexts, one endpoint that correctly returns 403 and one that doesn't enforce authz.
    - **Runner integration:** In [runner.go](./packages/container/internal/runner/runner.go), add a `bolaPhase()` method called after the main run loop completes (after all profile iterations finish at ~L390). Results from BOLA testing are broadcast via the same `Event{Type: EventResult}` mechanism and appended to `handler.results` for report inclusion.
    - **Config:** Add to `Settings` (L71-82):
      - `BOLATesting bool` (default `false`)
      - `AuthHeaders []string` (default `["Authorization", "X-API-Key"]`) - headers to drop during anonymous checks.
      - `AuthCookies []string` (default `["session", "token", "jwt", "sid", "JSESSIONID", "PHPSESSID"]`) - cookies to drop during anonymous checks.
    - **Dashboard:** In [ConfigSidebar.tsx](./packages/web/src/components/Sidebar/ConfigSidebar.tsx), add a "BOLA / IDOR Testing" toggle with an expandable section for defining two auth identities (each with auth sequence steps, headers, cookies), plus list inputs for specifying custom authentication header/cookie names to drop during anonymous checks. In the [Heatmap](./packages/web/src/components/Dashboard/Heatmap.tsx), BOLA and unauthorized access findings should appear with distinct colors/labels to distinguish from fuzz results.

- [x] **Task 29:** Implement Custom Security Header Fuzzing beyond the API specification.
  - **Design Goal:** Test for common server-side misconfigurations by fuzzing security-critical HTTP headers not defined in the API spec. Currently, `executeRequest()` in [runner.go](./packages/container/internal/runner/runner.go) (L440-470) only applies headers from `config.GlobalHeaders` and generated header params from `EndpointConfig.HeaderParams` (parsed in [parser.go](./packages/container/internal/swagger/parser.go) L60-85). There is no mechanism to inject arbitrary security-test headers.
  - **Implementation Details:**
    - **New payload file:** Create `packages/container/internal/generator/payloads/headers.go`:
      ```go
      var HostInjection = []string{
          "evil.com", "evil.com:443", "127.0.0.1", "169.254.169.254",
          "[::1]", "localhost", "0177.0.0.1", "0x7f.0.0.1",
      }
      var CORSOrigins = []string{
          "https://evil.com", "null", "https://evil.com.target.com",
          "https://target.com.evil.com", "https://targetcom.evil.com",
      }
      var IPSpoofing = []string{
          "127.0.0.1", "::1", "10.0.0.1", "192.168.1.1",
          "169.254.169.254", "0.0.0.0", "172.16.0.1",
      }
      var JWTManipulation = []string{
          "", "invalid", "null",
          "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIn0.", // alg:none
          "Bearer ", "Bearer null", "Bearer undefined",
      }
      ```
    - **New category constants** in [categories.go](./packages/container/internal/generator/payloads/categories.go): `CatHostInjection`, `CatCORSMisconfig`, `CatIPSpoofing`, `CatJWTManipulation`. Register in `MaliciousCategories` slice.
    - **Generator extension:** In [generator.go](./packages/container/internal/generator/generator.go), add a new method `GenerateSecurityHeaders(iteration int) map[string]string` that returns a map of header name → fuzz value based on active categories and current iteration index (sequential, same pattern as `generateBoundaryValue()`).
    - **Runner integration:** In `executeRequest()` ([runner.go](./packages/container/internal/runner/runner.go) L440-470), after merging global headers and generated params, call `gen.GenerateSecurityHeaders()` and overlay results. For `Host` header manipulation, use `req.Host = value` (Go's `http.Request.Host` field overrides the header).
    - **CORS analyzer** (part of Task 26's `crlf.go` or a new `cors.go`): After sending an `Origin: https://evil.com` header, check if `Access-Control-Allow-Origin` in the response matches `https://evil.com` or is `*` → Rule ID: `swazz/cors-misconfig`, Level: `warning`.
    - **Tests:** Table-driven tests in `headers_test.go` and `cors_test.go`. Use `httptest.Server` that reflects `Origin` to validate CORS detection.

- [x] **Task 34:** Expand Backend Stack Error Recognition and Document Grouped Errors.
  - **Design Goal:** Improve detection and classification of server crashes, database errors, and stack traces across various backend stacks (Go, Python, Java/Spring, .NET, Node.js, PHP, Ruby) in both the Go analyzer and the Web Dashboard's "Grouped Errors" view.
  - **Implementation Details:**
    - **Go Analyzer updates:** Extend `packages/container/internal/analyzer/stacktrace.go` and `sqli.go` to match more framework-specific patterns (e.g. Django, Rails, Laravel, NestJS, FastAPI, Express, Spring Boot) and database errors (e.g. PostgreSQL, SQLite, MSSQL, MySQL, Oracle).
    - **List of Grouped Error Categories:** Document the main classification rules that map findings to Grouped Errors in the Web UI:
      - `swazz/reflected-xss` -> "Reflected XSS" (Error)
      - `swazz/null-pointer-exception` -> "Null Reference Exception: [Language]" (Error)
      - `swazz/sql-error-leak` -> "SQLi Error: [Database]" (Error)
      - `swazz/stack-trace-leak` -> "Stack Trace Leak: [Language]" (Warning)
      - `swazz/sensitive-data-leak` -> "Sensitive Data: [Category]" (Warning)
      - `swazz/crlf-injection` -> "CRLF / Header Injection" (Error)
      - `swazz/cors-misconfig` or `swazz/header-injection` -> "CORS Misconfiguration" (Warning)
      - `swazz/response-size-anomaly` -> "Response Size Anomaly" (Warning)
    - **Dashboard Sync:** Ensure the React frontend's `categorizeFinding` in [findings.ts](./packages/web/src/utils/findings.ts) and `extractErrorSubtype` in [errors.ts](./packages/web/src/utils/errors.ts) correctly recognize the extended language/framework formats sent by the backend.
    - **Tests:** Add unit tests in `stacktrace_test.go` and `sqli_test.go` with sample responses from Rails, Django, Laravel, NestJS, and Spring Boot to verify correct language detection.

## 📦 Compatibility & Quality

- [x] **Task 30:** Add YAML OpenAPI spec support.
  - **Design Goal:** Support the most common OpenAPI specification format. Currently, [parser.go](./packages/container/internal/swagger/parser.go) `ParseSpec()` (L11-114) accepts only `json.RawMessage`. The function immediately unmarshals into `map[string]any` via `json.Unmarshal` (L14). Meanwhile, [detect.go](./packages/container/internal/swagger/detect.go) `FetchRemoteSpec()` (L68) and `IsValidSpec()` (L15) also work exclusively with `json.RawMessage`. The majority of real-world API specs (Swagger Hub, GitHub repos) are authored in YAML.
  - **Implementation Details:**
    - **Dependency:** `go get gopkg.in/yaml.v3` in `packages/container/`.
    - **New utility** in `packages/container/internal/swagger/yaml.go`:
      ```go
      func ConvertYAMLToJSON(data []byte) (json.RawMessage, error)
      func IsYAML(data []byte) bool  // heuristic: starts with "openapi:" or "swagger:" after trimming whitespace, or valid YAML but invalid JSON
      ```
      `ConvertYAMLToJSON`: unmarshal via `yaml.Unmarshal` → marshal via `json.Marshal`. Handle YAML-specific types (anchors `&`, aliases `*`, merge keys `<<`).
    - **detect.go changes** ([detect.go](./packages/container/internal/swagger/detect.go)):
      - In `FetchRemoteSpec()` (L68-138): After reading the response body, check `Content-Type` for `application/yaml`, `application/x-yaml`, `text/yaml`, or file extension `.yaml`/`.yml` in the URL. Also apply `IsYAML()` heuristic. If YAML detected → run `ConvertYAMLToJSON()` before calling `IsValidSpec()`.
      - In `IsValidSpec()` (L15-40): No changes needed — it already works on `json.RawMessage`, which is the output of `ConvertYAMLToJSON()`.
    - **parser.go changes** ([parser.go](./packages/container/internal/swagger/parser.go)):
      - Add a new entrypoint `ParseRawSpec(data []byte) (*ParseResult, error)` that detects format (JSON vs YAML), converts if needed, and delegates to `ParseSpec()`.
    - **handlers.go changes** ([handlers.go](./packages/container/api/handlers.go)):
      - In `ParseSpec` handler (L59-131): when the user provides an inline `spec` field, try JSON parse first; on failure, try YAML conversion. When fetching remote specs, the detect.go changes handle format detection automatically.
    - **Web UI:** In [ConfigSidebar.tsx](./packages/web/src/components/Sidebar/ConfigSidebar.tsx), if there's a file upload feature, accept `.yaml` and `.yml` extensions alongside `.json`.
    - **Tests:** Create `packages/container/internal/swagger/yaml_test.go` with YAML fixtures. Add YAML variants of existing `parser_test.go` test cases. Test edge cases: YAML anchors, multi-document YAML (should reject), YAML with comments.

- [x] **Task 31:** Add Rate Limiting Detection and analysis.
  - **Design Goal:** Identify API endpoints that lack rate limiting — a common security misconfiguration that enables brute-force, credential stuffing, and resource exhaustion attacks. The runner already handles `429` responses with exponential backoff (3 retries, 2s/4s/6s + jitter, see `executeRequest()` in [runner.go](./packages/container/internal/runner/runner.go) L540-570), but there's no proactive check for *absence* of rate limiting.
  - **Implementation Details:**
    - **New package:** Create `packages/container/internal/ratelimit/`:
      - `checker.go` — `RateLimitChecker` struct with `Check(ctx context.Context, client *http.Client, endpoint EndpointConfig, baseURL string, headers map[string]string) *Finding`. Sends `burstSize` (default 50) identical GET/POST requests to the endpoint in rapid succession (no delay). If zero `429` responses are received → finding. If `Retry-After` header is present → note the limit in evidence.
      - Track: total requests sent, total 429s received, first 429 at request N, `Retry-After` value.
      - Rule ID: `swazz/no-rate-limit`, Level: `warning`, Evidence: `"Sent {N} requests in {T}s, received 0 rate-limit responses (429)"`.
    - **Runner integration:** In [runner.go](./packages/container/internal/runner/runner.go), add a `rateLimitPhase()` method called after `bolaPhase()` (Task 28) and before `EventComplete` broadcast. Only runs if `config.Settings.RateLimitCheck` is enabled. Iterates unique endpoints, runs checker, broadcasts findings.
    - **Config:** Add to `Settings` (L71-82 in [types.go](./packages/container/internal/swagger/types.go)):
      - `RateLimitCheck bool` (default `false`)
      - `RateLimitBurstSize int` (default `50`)
    - **Dashboard:** In [ConfigSidebar.tsx](./packages/web/src/components/Sidebar/ConfigSidebar.tsx), add a "Rate Limit Detection" toggle with burst size input. In the heatmap, rate limit findings should show as a distinct icon/color.
    - **Safety:** Include a warning in the UI that enabling this feature sends a burst of requests and may trigger real rate limiters or WAFs.

- [x] **Task 32:** Add missing unit tests for output formatters and expand test coverage.
  - **Design Goal:** Ensure output reliability. Currently, only [sarif_test.go](./packages/container/internal/output/sarif_test.go) (6.8KB) exists. The [html.go](./packages/container/internal/output/html.go) (318 lines with embedded CSS/JS) and [json.go](./packages/container/internal/output/json.go) (58 lines) have zero test coverage.
  - **Implementation Details:**
    - **`html_test.go`:** Create `packages/container/internal/output/html_test.go`:
      - Test `ToHTML()` (L63 of [html.go](./packages/container/internal/output/html.go)) with:
        - Empty findings slice → valid HTML with "no findings" state
        - Single finding → correct severity badge color, endpoint grouping
        - Multiple findings across endpoints → correct grouping, filter dropdowns populated
        - Special characters in payload (`<script>`, `"quoted"`, backticks) → properly HTML-escaped (no XSS in the report itself)
        - Very long URLs (>500 chars) → truncated or wrapped gracefully
        - All severity levels → correct CSS class mapping (`error`→red, `warning`→yellow, `note`→blue)
        - `ResponseBody` field with >100 char payload → truncated to 100 chars (L263 logic)
      - Validate output is well-formed HTML: check for `<!DOCTYPE html>`, `<html>`, `</html>` markers.
    - **`json_test.go`:** Create `packages/container/internal/output/json_test.go`:
      - Test `ToJSON()` (L11 of [json.go](./packages/container/internal/output/json.go)) with:
        - Empty findings → `summary.totalFindings == 0`, `byLevel` all zeros
        - Mixed severity findings → correct `byLevel.error`, `byLevel.warning`, `byLevel.note` counts
        - `RunStats` with various `StatusCounts` → correctly copied to `summary.statusCounts`
        - Duration calculation from `RunStats.StartTime` → reasonable `durationSeconds` value
        - Null/missing `RunStats` → graceful fallback, no panic
      - Validate JSON round-trip: `json.Marshal` → `json.Unmarshal` → assert structure matches.
    - **Cross-format consistency:** Add an integration test that feeds the same `[]*classifier.Finding` + `*swagger.RunStats` to all three formatters and asserts: finding count matches across all formats, severity distribution is identical, no formatter panics on edge case inputs.


- [ ] **Task 35:** Add high-quality screenshots or GIFs of the Web Dashboard to the `README.md` *(replaces Task 3)*.
  - **Design Goal:** Create a strong first impression for developers visiting the GitHub repository. *(Depends on: Task 21 completion for mutation diff screenshots)*
  - **Implementation Details:**
    - Capture screenshots/GIFs of: Heatmap view during an active run against the demo API (Task 12), Inspector with request detail & mutation diff (Task 21), Configuration sidebar with payload categories modal, HTML export report, CLI terminal output.
    - Optimize images for web (compressed PNG or animated WebP, <500KB each).
    - Add a visual "Features" section to `README.md` with an image carousel or table layout.

    - Add a visual "Features" section to `README.md`.

- [x] **Task 37:** Implement Out-of-Band (OOB) Interaction Verification Server (Interactsh-like)
  - **Design Goal:** Detect blind vulnerabilities (like Blind SSRF, Blind SQLi, or RCE) by generating a unique interaction URL (e.g., `http://<host>/oob/<uuid>`) and tracking incoming HTTP requests hitting that endpoint to confirm vulnerability execution.
  - **Implementation Details:**
    - **Engine/Backend Endpoint:** Extend the Gin web server in `packages/container/api/` (or standard runner) to listen for OOB interaction requests on a specific path prefix like `/oob/:uuid`.
    - **UUID Generator & Tracker:** Build a lightweight storage/map in the backend engine to register active fuzz sessions and correlate generated UUID strings with target parameters.
    - **Payload injection:** Extend the generator in `packages/container/internal/generator/` to dynamically insert the OOB URL (with UUID) into payloads (e.g., injection lists, headers like `X-Forwarded-For`).
    - **Finding Trigger:** When `/oob/:uuid` is accessed, look up the UUID to identify the source session/request, construct an `AnalysisFinding` representing OOB Interaction, and push/broadcast the finding to the dashboard real-time.

- [x] **Task 38:** Implement Response Content Similarity & Structure Analysis for BOLA/Bypass Testing.
  - **Design Goal:** Eliminate false positives during BOLA/Bypass testing by comparing response bodies (structural schema and content similarity) between User A's baseline request and User B/Anonymous replay requests, instead of relying solely on `2xx` HTTP status codes.
  - **Implementation Details:**
    - **Analysis Engine:** Create a similarity checker in `packages/container/internal/bola/similarity.go`. Compare JSON keys, array sizes, and text similarity (Levenshtein distance or token intersection) between baseline and replay response bodies.
    - **Vulnerability Confirmation:** Flag BOLA only if the replayed response (User B/Anonymous) shares high structural and value similarity (e.g. >85%) with User A's baseline response. Ignore `2xx` replays that return empty collections, general error frames, or are structurally distinct.
    - **Config:** Add `bola_similarity_threshold` (default `0.85`) under `Settings`.

- [x] **Task 39:** Implement Multi-Format Report Exports (Markdown, Print-Friendly HTML/PDF) and Graceful JS-Free Degredation.
  - **Design Goal:** Ensure that security audit reports are fully readable and interactive under strict local security policies (such as browser sandboxing or strict CSP on the `file://` protocol) which block JavaScript execution.
  - **Implementation Details:**
    - **Markdown Exporter:** Implement a Markdown formatter in `packages/container/internal/output/markdown.go` (and map it in the frontend/CLI). Markdown has zero script dependencies and renders natively in code editors, GitHub, and markdown viewers.
    - **Print Optimization:** Enhance [html.go](./packages/container/internal/output/html.go) styles with `@media print` rules, allowing the user to print or "Save to PDF" directly from the browser with page-break styling, hidden filter menus, and visible headers.
    - **Graceful Degradation:** Ensure that the HTML report does not require JavaScript for core readability. All findings must load statically by default; show a warning in the filter bar if script execution is blocked.

- [x] **Task 40:** Upgrade the Interactive Configuration Wizard (TUI Mode, Auto-Continuation, and Advanced Settings).
  - **Design Goal:** Provide a powerful interactive command-line experience to fully configure advanced fuzzing capabilities (BOLA, User B identities, Rate Limiting, Private IP SSRF protection, custom dictionaries, and endpoint filters) without manually editing JSON.
  - **Implementation Details:**
    - **Continuation by Default:** Modify `runWizard()` in [main.go](./packages/container/main.go#L82). When the wizard is executed, check if `swazz.config.json` already exists in the current directory (or is specified via `--config`). If it does, automatically parse it and prompt: `"Existing configuration found. Do you want to edit it or continue where you left off?"` instead of starting from scratch.
    - **TUI Config Menu:** If editing an existing config or requested by the user, render an interactive Terminal User Interface (TUI) main menu using a Go TUI library (e.g. `github.com/charmbracelet/bubbletea` / `lipgloss` or `github.com/manifoldco/promptui`). The user can navigate options:
      - 📝 Base Settings (Swagger URL, API Base URL)
      - 🔐 Authentication & Multi-Identity (Login sequences, BOLA User B headers/cookies)
      - 🛡 Security Policy (Toggle SSRF protection / Allow Private IPs)
      - ⚙️ Fuzzing Controls (Concurrency, delay, profile selection, iterations, toggle rate limiting & burst sizes)
      - 📁 File Paths (Custom dictionaries, wordlists, endpoint include/exclude filters)
      - 💾 Save & Run Fuzzer
    - **Validation:** Ensure input schemas are validated in real-time within the terminal prompts (e.g., verifying Swagger URL format, JSON body validity for auth steps, and valid numbers for concurrency).





- [x] **Task 41:** Add OWASP API Security Top 10 (2023) Categorization.
  - **Design Goal:** Group and tag findings in the HTML/JSON reports and Web Dashboard using the industry-standard OWASP API Security Top 10 (2023) categories, making the tool much more useful for compliance and formal security audits.
  - **Implementation Details:**
    - **Mapping Engine:** Create a mapping utility in `packages/container/internal/classifier/owasp.go` that maps internal Rule IDs to OWASP categories. For example:
      - `swazz/bola-idor`, `swazz/tenant-isolation-bypass` ➔ **API1:2023 Broken Object Level Authorization**
      - `swazz/unauthorized-access` ➔ **API2:2023 Broken Authentication** / **API5:2023 Broken Function Level Authorization**
      - `swazz/sensitive-data-leak`, `swazz/stack-trace-leak` ➔ **API3:2023 Broken Object Property Level Authorization** (or **API7:2023 Security Misconfiguration**)
      - `swazz/no-rate-limit` ➔ **API4:2023 Unrestricted Resource Consumption**
      - `swazz/cors-misconfig`, `swazz/crlf-injection` ➔ **API7:2023 Security Misconfiguration**
    - **Finding Extension:** Add an `OWASP_Category` string slice to the `AnalysisFinding` and `FuzzResult` structures.
    - **Dashboard UI:** Add a new tab or chart in the Dashboard (next to "Grouped Errors") showing the distribution of findings by OWASP category.
    - **Reports:** Update the JSON and HTML formatters to group findings by OWASP category as a high-level executive summary.

- [x] **Task 42:** Move Grouped Errors Count Badges to the Left.
  - **Design Goal:** Place the color-coded severity/count badge (circle) in the "Grouped Errors" accordion headers to the left of the group title text, providing cleaner visual alignment.
  - **Implementation Details:**
    - Adjust [Inspector.tsx](./packages/web/src/components/Inspector/Inspector.tsx) layout inside `findings-group-title-row` so that the count badge renders before the title text.
    - Update spacing and margins in [index.css](./packages/web/src/index.css) to ensure proper margins between chevron, badge, and title.

- [x] **Task 43:** Redesign the "Welcome to Swazz API Fuzzer" Empty State.
  - **Design Goal:** Transform the initial empty state screen into a more promotional and engaging landing view.
  - **Implementation Details:**
    - Replace the basic welcome text with a modern dashboard mode overview and Docker quick start commands.
    - Add a clear Call-to-Action (CTA) link pointing to the official documentation below the commands.

- [x] **Task 44:** Add Developer Console Invitation.
  - **Design Goal:** Engage with developers exploring the dashboard's DevTools by rendering a styled console message inviting them to contribute.
  - **Implementation Details:**
    - Insert a `console.log` with styled CSS output in the main entry point of the React app (e.g., `main.tsx` or `App.tsx`).
    - The message should invite developers to check out the GitHub repository, mentioning explicitly that "suggesting an idea is also participation" ("предложить идею - тоже участие").

- [x] **Task 45:** Optimize UI Performance.
  - **Design Goal:** Ensure the React Web Dashboard remains highly responsive even during high-concurrency fuzzing runs with thousands of events per second.
  - **Implementation Details:**
    - Profile React component renders to identify unnecessary re-renders in the Inspector, Heatmap, and Log views.
    - Implement `React.memo`, `useMemo`, and `useCallback` strategically to prevent costly re-renders of list items and grid cells.
    - Explore windowing/virtualization for the real-time request logs or long findings lists.

- [x] **Task 46:** Implement Keyboard Shortcuts & Help Menu.
  - **Design Goal:** Improve accessibility and productivity by allowing developers to control the fuzzer and navigate the dashboard via custom keyboard shortcuts.
  - **Implementation Details:**
    - Listen to global `keydown` events.
    - Shortcuts:
      - `Shift + ?` / `?` ➔ Show/hide keyboard shortcuts help modal.
      - `Cmd + Enter` (macOS) / `Ctrl + Enter` (Windows/Linux) ➔ Trigger/Run Fuzzer.
      - `Cmd + Shift + X` (macOS) / `Ctrl + Shift + X` (Windows/Linux) ➔ Stop active fuzzing session.
      - `Cmd + Shift + P` / `Ctrl + Shift + P` ➔ Pause/Resume fuzzing session.
      - `1`, `2`, `3`, `4` keys ➔ Switch between tabs (`1` = Heatmap, `2` = Request Logs, `3` = Grouped Errors, `4` = OWASP Top 10).
      - `Escape` ➔ Close any active modals, config panel, or request details view.
      - `Alt + L` / `Option + L` ➔ Toggle left sidebar.
      - `Alt + C` / `Option + C` ➔ Toggle configuration/right sidebar.




- [ ] **Task 48: Implement Active Web Crawler (Spider)**
  - **Design Goal:** Enable target discovery by dynamically crawling web applications from a starting URL without relying solely on static API specifications.
  - **Implementation Details:**
    - Parse HTML responses for anchor tags, forms, link/script tags, and check common discovery files like robots.txt and sitemap.xml.
    - Implement a concurrent, recursive crawler in Go with rate-limiting, depth-limits, and domain scoping to build a dynamic Sitemap.
    - Feed discovered URLs and form inputs into the fuzzing execution pipeline.

- [x] **Task 49: Automated Session & CSRF Management**
  - **Design Goal:** Maintain active authenticated sessions and handle CSRF protection mechanisms dynamically throughout fuzzing runs.
  - **Implementation Details:**
    - Detect session expirations dynamically (e.g., HTTP 401/403 or specific redirect patterns) and automate re-authentication flows.
    - Identify anti-CSRF tokens in HTML forms and cookies, dynamically fetching fresh tokens and injecting them into headers/bodies of outgoing fuzz requests.

- [x] **Task 50: Expand Active Scanning Rules (Path Traversal, OS Command Injection, SSTI, XXE)**
  - **Design Goal:** Extend the vulnerabilities coverage of the core scanner beyond API-specific vulnerabilities to general web application flaws.
  - **Implementation Details:**
    - Implement a Path Traversal and File Inclusion (LFI/RFI) analyzer injecting traversal/inclusion payloads and verifying response indicators.
    - Implement an OS Command Injection analyzer injecting shell payloads and checking for out-of-band interactions or timing delays.
    - Implement Server-Side Template Injection (SSTI) and XML External Entity (XXE) analyzers with dedicated payloads and detectors.

- [x] **Task 51: User Authentication, Cloudflare-Hosted Browser Running, and Custom Runners**
  - **Design Goal:** Support multi-user collaboration by adding user registration, allowing browser-based runs on Cloudflare using Cloudflare tokens, and letting users register and connect their own self-hosted runners.
  - **Implementation Details:**
    - **Database & Storage Architecture:**
      - Use **Cloudflare D1** (SQLite in local/self-hosted dev) to store relational metadata: user credentials (JWT/OAuth2), configuration profiles, custom runner states, and high-level scan statistics.
      - Use **Cloudflare R2** (local directory or MinIO in local dev) to store raw scan results, full HTTP request/response logs (HAR files), and generated HTML/Markdown reports, linking them via URLs in D1.
      - Use **Cloudflare Durable Objects** to manage real-time WebSocket communication and coordinate job assignments with registered custom runners.
    - Implement user registration and authentication (e.g., JWT-based or OAuth2).
    - Build integration with Cloudflare Workers/Pages utilizing Cloudflare API tokens to trigger scans directly from browser.
    - Implement a runner registration system (e.g. WebSocket connection or long polling) allowing external runners to register, authenticate, and pull scan jobs from the central coordinator.

- [x] **Task 52: Standardize Configuration Schema & Optimize Web Config Export**
  - **Design Goal:** Resolve configuration mismatch bugs by unifying CLI and Web schemas, and optimize the dashboard's exported config size by refining endpoint inclusion rules.
  - **Implementation Details:**
    - Verify and align schemas between CLI configurations and the Web dashboard settings to ensure complete compatibility (1:1 conversion).
    - Limit the web dashboard's configuration export format so that downloading config from the Web UI does not dump excessive endpoints.
    - Implement client-side and server-side config schema validation to prevent malformed or incompatible options from being imported.

- [x] **Task 53: CI/CD Integration, Fail-on-Severity, and SARIF/JUnit Reports**
  - **Design Goal:** Support DevSecOps workflows by enabling automated gatekeeping in CI pipelines and exporting industry-standard security analysis formats.
  - **Implementation Details:**
    - Add CLI flags (e.g. `--fail-on-severity`) to exit with non-zero codes when specific vulnerability thresholds are met.
    - Generate report outputs in SARIF (Static Analysis Results Interchange Format) to integrate natively with GitHub Code Scanning alerts, and JUnit XML for general CI test runners.

- [x] **Task 54: Finding Triaging, Suppressions, and Ignore Rules**
  - **Design Goal:** Reduce noise and manage false positives effectively by allowing developers to mute or skip specific vulnerability alerts.
  - **Implementation Details:**
    - Allow users to mark findings as `False Positive`, `Ignored`, or `Acknowledged` in the web dashboard.
    - Export a `swazz.ignore.json` configuration containing rules (such as matched endpoint, payload, or vulnerability type) to automatically suppress matching findings in subsequent CLI and Web runs.

- [x] **Task 55: Stateful API Fuzzing & Request Chaining**
  - **Design Goal:** Enable fuzzing of complex multi-step workflows by dynamically passing variables extracted from earlier HTTP responses into subsequent requests.
  - **Implementation Details:**
    - Define variable extraction rules (e.g. extracting a created resource ID from a JSON body or Location header during a POST request).
    - Map extracted variables into the fuzzing execution pipeline to be injected into URL paths, headers, or bodies of subsequent requests (e.g. GET/PUT/DELETE) to fuzz authenticated multi-step flows.

- [x] **Task 56: HAR File Support (Traffic Replay Fuzzing)**
  - **Design Goal:** Enable "zero-setup" fuzzing by allowing users to import HTTP Archive (HAR) files captured directly from browser developer tools. This provides instant fuzzing of undocumented (shadow) APIs and automatic replay of real-world authentication states (cookies, tokens, CSRF headers).
  - **Success Criteria:**
    - Swazz correctly parses standard `.har` files exported from Chrome/Firefox.
    - Swazz extracts distinct endpoints (Method + URL), headers, and payloads from the HAR file and converts them into the internal `EndpointConfig` structure.
    - Implemented a heuristic Type/Schema Inference engine that guesses data types (`string`, `integer`, `boolean`) from the raw HAR JSON payloads and mutates them appropriately.
    - Implemented a filtering mechanism allowing users to specify a target domain/regex so that third-party analytics and static assets present in the HAR file are ignored.
    - **Config File Integration:** Instead of a new CLI flag, users can specify the path to a `.har` file directly in the config (`target` or `spec` field) just like an OpenAPI spec.
    - **Authentication Compatibility:** If the user has defined an `auth_sequence` in the config, Swazz must execute it and apply the fresh tokens/cookies to the requests extracted from the HAR file (overriding the expired ones captured in the browser).
    - **Web Dashboard:** Users can upload a `.har` file directly through the Web UI configuration panel.

- [ ] **Task 57: Cloudflare Queues Integration for Scaling Scans & Buffering Findings**
  - **Design Goal:** Improve the system's scalability, reliability, and resilience by decoupling task dispatch and result ingestion from synchronous request/WebSocket paths, mitigating D1 database pressure under high concurrency.
  - **Implementation Details:**
    - **Scan Queue:** Create a Cloudflare Queue for incoming scans. Instead of returning `503 No runners available` when no runners are online, push scan configurations to the queue. Have the coordinator pull and assign them when a runner connects.
    - **Finding & Log Buffer:** Push fuzzer findings/events generated by Go runners to a separate Cloudflare Queue. Configure a consumer Worker to process findings in batches (e.g., up to 100-500 messages) and execute bulk database insertions into Cloudflare D1.
    - **Reliable Notification Webhooks:** Queue Slack, Discord, or generic Webhook notifications to guarantee delivery with automatic retry logic, decoupling slow external network calls from the main runner sync flow.

- [ ] **Task 58: Content Security Policy (CSP) Security Analysis**
  - **Design Goal:** Detect insecure, overly permissive, or missing Content Security Policies in target API and web application HTTP responses.
  - **Implementation Details:**
    - Parse headers like Content-Security-Policy and Content-Security-Policy-Report-Only in the response analyzer.
    - Flag unsafe directives such as `unsafe-inline`, `unsafe-eval`, or wildcard sources (`*`) that weaken protection against XSS and data injection.

- [ ] **Task 59: Headless Browser Crawler & Interception Sniffer**
  - **Design Goal:** Enable target discovery by crawling web applications using a browser engine, capturing and sniffing all background API requests to automatically populate the fuzzer path list.
  - **Implementation Details:**
    - Spin up a headless browser to crawl target pages.
    - Intercept network request traffic (AJAX, fetch requests, form submissions) and convert them to internal API specifications for fuzzing.

- [ ] **Task 60: DefectDojo Integration Enhancements**
  - **Design Goal:** Improve metadata richness when importing Swazz reports into DefectDojo by correctly mapping vulnerabilities, scopes, and payloads.
  - **Implementation Details:**
    - Ensure correct mapping of severity levels, grouping, service names, and URL paths.
    - Embed fuzzed payloads, request/response bodies, and corresponding MITRE CWE identifiers into exported report formats.

- [ ] **Task 61: Case-Insensitive URL Exclusions**
  - **Design Goal:** Prevent scan contamination by ensuring target path exclusion matching ignores alphabetical casing.
  - **Implementation Details:**
    - Modify URL filtering logic to perform case-insensitive comparisons against defined exclude paths (e.g. `/api/admin` matching `/API/Admin`).

- [ ] **Task 62: Browser Extension for Real-Time Traffic Capturing**
  - **Design Goal:** Build a browser extension (similar to Cobalt) that sniffs web traffic as the user interacts with the app, recording API endpoints directly into the Swazz configuration profile.
  - **Implementation Details:**
    - Capture HTTP/HTTPS requests on specified domains in background service workers.
    - Synchronize captured endpoints and authentication states in real-time with the local runner profile.

- [ ] **Task 63: UI Actions for Ignoring Findings & Accepting Risks**
  - **Design Goal:** Allow security auditors to triage issues directly in the dashboard by ignoring false positives or acknowledging accepted risks.
  - **Implementation Details:**
    - Add buttons to individual findings to mute them or mark them as "Accept Risk".
    - Automatically append corresponding rules to `swazz.ignore.json`.

- [ ] **Task 64: Include Test Profile Type in SARIF Reports**
  - **Design Goal:** Provide better context in CI/CD pipelines by embedding the exact fuzzer test profile/vulnerability category in SARIF output files.

- [ ] **Task 65: Refine BOLA/IDOR Tests to Ignore Requests without Auth Substitution**
  - **Design Goal:** Reduce false positive findings by skipping BOLA evaluation on endpoints where no authorization tokens or parameters were present in the baseline request to swap.

- [ ] **Task 66: Fix URL Casing Conversion in SARIF Output**
  - **Design Goal:** Resolve the bug where URLs in exported SARIF logs are incorrectly capitalized (e.g., converting `/api/bank` to `/Api/Bank`).

- [ ] **Task 67: Restart Runner Agent Command in Web UI**
  - **Design Goal:** Allow remote management of runners by providing a button in the Web UI dashboard to restart connected runner agent processes.

- [ ] **Task 68: Agent Update Notifications**
  - **Design Goal:** Automatically check and notify administrators in the dashboard logs when connected Go runner agents are running outdated versions.

- [ ] **Task 69: Model Context Protocol (MCP) Support**
  - **Design Goal:** Expose Swazz commands and findings through an MCP server interface, allowing AI coding assistants to trigger and query scans natively.

- [ ] **Task 70: JSONC Support for Configuration Files**
  - **Design Goal:** Allow users to annotate their `swazz.config.json`, `swazz.ignore.json`, and `wrangler.config.json` files with `//` and `/* */` comments. JSONC (JSON with Comments) is the de-facto standard for developer-facing config files (VS Code, TypeScript, ESLint), and its absence currently forces users to maintain separate out-of-band documentation for non-obvious config fields.
  - **Implementation Details:**
    - **Go backend (CLI + agent):** Introduce a `stripJSONC(data []byte) []byte` utility in `packages/container/` (e.g., `jsonc.go`) that strips `// line` and `/* block */` comments while preserving byte offsets (for accurate parse error messages). Apply it to every `os.ReadFile` / `json.Unmarshal` call for user-supplied config files:
      - `runCLI()` in [cli.go](./packages/container/cli.go) — `swazz.config.json` and `--config` path.
      - `LoadIgnoreRules()` in [ignore.go](./packages/container/internal/classifier/ignore.go) — `swazz.ignore.json`.
      - Any config loading in [wizard.go](./packages/container/wizard.go).
    - **No new dependency required:** a simple state-machine parser (~40 LOC) handles comments without pulling in an external library. Edge cases to cover: comments inside strings must be ignored, escaped quotes (`\"`), and CRLF line endings.
    - **Rename example files to `.jsonc`:** All example/template config files in the repository root must be renamed from `.json` to `.jsonc` to signal to editors that comments are valid in these files:
      - `swazz.config.example.json` → `swazz.config.example.jsonc`
      - `swazz.ignore.example.json` → `swazz.ignore.example.jsonc` (if present)
      - `wraggler.config.example.json` → `wraggler.config.example.jsonc`
      - Update all references in `README.md`, `DOCKER.md`, `CONTRIBUTING.md`, `docs/`, and CI workflows.
      - The actual runtime default filenames (`swazz.config.json`, `swazz.ignore.json`) remain `.json` for backward compatibility — users can rename them to `.jsonc` at their discretion since the parser handles both extensions transparently.
    - **Web UI:** Update the Monaco-based config editor in the dashboard (if present) to set the language mode to `jsonc` so the editor natively highlights comments without showing lint errors.
    - **Tests:** Add `packages/container/jsonc_test.go` covering: `//` comment on its own line, inline `//` comment after a value, `/* */` block comment spanning multiple lines, comment inside a string value (must not be stripped), nested escaped quotes, empty input, and valid plain JSON (must pass through unchanged).

- [ ] **Task 71: Runner Registration UI — Shared vs Private Mode**
  - **Design Goal:** The current Settings page shows a single `docker run` command to register a runner without making it clear that this runner joins the **Shared Pool** (available to all users). Users must be able to choose between two explicit modes — **Shared Runner** (contributes compute to the community pool) and **Private Runner** (exclusive to the owner, matched to their Ed25519 signing key). The distinction must be visually obvious before a user copies and runs any command.
  - **Current problem:** `UserSettings.tsx` generates only one `docker run ... --key` command for key-authenticated private runners and shows no mention of the Shared Pool or what it means. A user running with `--token` unknowingly contributes their runner to all other users. The coordinator's `isPrivateRunner()` check ([Coordinator.ts L53-55](./packages/edge/src/Coordinator.ts)) silently routes jobs based on this distinction, but the UI exposes none of it.
  - **Implementation Details:**
    - **Mode selector in `UserSettings.tsx`:** Replace the single runner command card with a **two-tab or two-card layout** titled `Shared Runner` and `Private Runner`, each with:
      - A clear **description badge**: e.g. 🌐 `Shared — jobs from all users may run on this machine` vs 🔒 `Private — only your own scans will be dispatched to this runner`.
      - The appropriate `docker run` command for that mode.
      - A **warning callout** on the Shared tab: `⚠️ By registering a shared runner you agree to execute fuzzing jobs on behalf of other platform users. Only run this on an isolated, containerised environment.`
    - **Shared Runner command** (token-based — no key auth, falls into shared pool):
      ```
      docker run --rm -it ghcr.io/sech0us3/swazz-cli:<tag> run-agent \
        --coordinator <wss-url>/api/runners/connect \
        --token <api_key>
      ```
      The `api_key` field must be exposed in the Settings page (already stored in `users.api_key` in D1). Show it in a masked `<input type="password">` with a copy button.
    - **Private Runner command** (key-based — `pubKeyHex` tag causes `isPrivateRunner()` to return `true`):
      ```
      # Step 1: Generate keys (one-time)
      docker run --rm -it -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:<tag> generate-keys

      # Step 2: Register your public key (copy from swazz_runner.pub)
      # (done automatically when key is used for the first time — see docs)

      # Step 3: Start the private runner
      docker run --rm -it -v $(pwd)/swazz_runner.key:/swazz_runner.key \
        ghcr.io/sech0us3/swazz-cli:<tag> run-agent \
        --coordinator <wss-url>/api/runners/connect \
        --key /swazz_runner.key
      ```
    - **Public key registration flow:** Currently the coordinator validates `X-Runner-Public-Key` against `users.public_key` in D1 ([runners.ts L24-30](./packages/edge/src/routes/runners.ts)). The UI must expose a field to paste/upload the contents of `swazz_runner.pub` and a **Save Public Key** button that calls `PATCH /api/auth/me` (or a new `PUT /api/users/me/public-key` endpoint) to persist it. Without this, a key-mode runner gets `401 Unauthorized: Invalid public key`.
    - **`/api/runners` response enrichment:** Add an `isShared: boolean` field per runner in the `/runners` list endpoint ([Coordinator.ts L220-240](./packages/edge/src/Coordinator.ts)) derived from `!isPrivateRunner(ws)`, and surface it in the Runners tab of Project Settings with a badge (`Shared` / `Private`).
    - **Runner name display:** The `--name` flag value is already stored as a `name:<value>` tag. Surface it in Settings as an optional `Runner Name` input pre-filled with `hostname`, so users can identify their runners in the dashboard.

- [ ] **Task 72: Propagate `projectId` from Web UI to Backend on Scan Start**
  - **Design Goal:** Scans started from the Web UI must be correctly linked to the active project in D1 so that project-level history, reporting, and access control work end-to-end. Currently `projectId` is only stored locally in IndexedDB (for the run history sidebar) but is never sent to `POST /api/runs`, so the server-side `scans` table always stores an empty `project_id` for web-initiated scans regardless of which project is active.
  - **Root cause:** In [useFuzzSession.ts L128-132](./packages/web/src/hooks/useFuzzSession.ts), `finalConfig` is built from `SwazzConfig` which has no `projectId` field. The `projectId` is only placed in `runRec` (the local IDB record). It is never included in the `POST /api/runs` body sent to the edge worker.
  - **Implementation Details:**
    - **`useFuzzSession.ts`:** After building `finalConfig`, read `activeProject` from the app store and pass it as a top-level field in the request body:
      ```typescript
      // useFuzzSession.ts ~L195
      const activeProject = useAppStore.getState().activeProject;
      await start({ ...finalConfig, projectId: activeProject?.id }, onResult, onComplete);
      ```
    - **`useRunner.ts` (`start` function):** The `config` object passed to `POST /api/runs` already becomes `{ config: configToSend }`. Extract `projectId` before sending to avoid leaking it into the scan config consumed by the agent:
      ```typescript
      const { projectId, ...agentConfig } = configToSend;
      const body = JSON.stringify({ config: agentConfig, projectId: projectId ?? '' });
      ```
    - **`POST /api/runs` edge handler ([runners.ts L132-155](./packages/edge/src/routes/runners.ts)):** `projectId` is already read from `body.config.projectId`. After the fix it should instead be read from the top-level `body.projectId` (to keep agent config clean). Update the destructuring accordingly.
    - **`checkScanMembership`** will then correctly follow the project membership path for project-linked scans and the `user_id` direct-ownership path for standalone scans — no changes required there.
    - **No schema changes needed** — `project_id` column already exists in `scans` table.

