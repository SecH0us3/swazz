# 🗺 Swazz Roadmap (Completed Tasks)

This file contains completed tasks.


## 📝 Documentation & Onboarding

- [x] **Task 1:** Create `SECURITY.md` to establish a formal vulnerability reporting process and security policy.

- [x] **Task 2:** Add a comprehensive CI/CD integration guide (`docs/ci_cd.md`) with a working GitHub Actions example for SARIF reporting.

- [x] **Task 4:** Create `CONTRIBUTING.md` (and `docs/contributing.md`) with local setup instructions, code standards, and testing guides (`go test ./...`).

- [x] **Task 10:** Upgrade the documentation site to a modern theme with built-in search and interactive code examples (e.g., using "Just the Docs" Jekyll theme or migrating to Docusaurus/VitePress).

- [x] **Task 11:** Design and add an Open Graph social preview image (1280x640) for the GitHub repository and documentation site.

- [x] **Task 12:** Create a local "Vulnerable Demo API" (e.g., in a `demo/` folder) so users can immediately test Swazz capabilities out of the box.

- [x] **Task 3:** Add high-quality screenshots or GIFs of the Web Dashboard (Heatmap, Inspector) to the `README.md`. *(Depends on: Task 12)*

- [x] **Task 119: Rebuild Documentation Site with Search**
  - **Design Goal:** Fully rebuild the documentation site using a modern framework (e.g. VitePress or Docusaurus) to provide a more convenient and structured layout, featuring full offline-capable search and interactive code blocks.
  - **Implementation Details:**
    - Initialize VitePress or Docusaurus in the documentation workspace.
    - Port existing markdown guides to the new site layout.
    - Configure search capabilities (such as local search) and deploy themes fitting the project's aesthetics.

- [x] **Task 123: User Action Audit Trail Logging**
  - **Design Goal:** Maintain a secure and auditable history of important user actions within projects, tracking state-changing operations (non-GET requests) to meet compliance and governance needs.
  - **Implementation Details:**
    - Create a database table `audit_logs` (schema: `id, project_id, user_id, action, details, ip_address, timestamp`).
    - Implement a backend middleware or helper in Hono that intercepts non-GET requests (POST, PUT, PATCH, DELETE) to project-scoped endpoints.
    - Automatically log details of key actions (e.g. member additions/removals, role modifications, settings updates, scan executions) into the `audit_logs` table.
    - Expose an API endpoint `GET /api/projects/:id/audit-logs` (accessible only to owners/admins).
    - Design an "Audit Trail" tab in Project Settings to view, search, and export the logs.

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

- [x] **Task 82: Analyze and Fix Memory Leaks in the Golang Application**
  - **Design Goal:** Identify, analyze, and resolve memory leaks (heap growth or goroutine leaks) in the Go fuzzer agent to ensure stability during long-running continuous fuzzing sessions.
  - **Implementation Details:**
    - Instrument the Go application with runtime/pprof or a localhost-bound net/http/pprof server for dynamic profiling.
    - Run extended load testing/fuzzing sessions and capture heap and goroutine profiles.
    - Analyze the profiles to locate unbounded memory allocations, orphaned goroutines, or unclosed resource handles.
    - Implement the necessary fixes and add automated memory leak detection (e.g., using `goleak` in tests) to prevent regression.

- [x] **Task 85: Lifetime Username Lock via Secure Hashing**
  - **Design Goal:** Prevent recycling or hijacking of usernames by storing a lifetime secure hash of all registered usernames (even after GDPR deletion), ensuring that once a username is taken, it can never be claimed by another account.
  - **Implementation Details:**
    - When a user registers, generate a salted SHA-256 hash of their username.
    - Store this hash in a persistent `username_registry` table.
    - When a user requests deletion (or when the account is purged), do not delete the record from `username_registry`.
    - Modify the registration endpoint to check if the hash of the requested username exists in `username_registry` and reject it if found.

- [x] **Task 67: Restart Runner Agent Command in Web UI**
  - **Design Goal:** Allow remote management of runners by providing a button in the Web UI dashboard to restart connected runner agent processes.

- [x] **Task 95: Implement GitHub OAuth Authentication**
  - **Design Goal:** Allow users to log in or register using their GitHub accounts.
  - **Implementation Details:**
    - Set up OAuth 2.0 configuration for GitHub on the edge coordinator.
    - Implement callback handling routes (`GET /api/auth/callback/github`) to exchange code for access tokens and fetch user profiles.
    - Handle user registration and session creation for OAuth-authenticated users, and support linking existing accounts.
    - Add a "Sign in with GitHub" button to the frontend authentication modals.

- [x] **Task 120: Project-Level E2EE Key Backup & Recovery (Backup File + Seed Phrase)**
  - **Design Goal:** Support exporting and importing the Project X25519 private key in Project Settings via a downloaded backup file (`.swazzkey`) or a 12-word mnemonic seed phrase, enabling seamless device migration and collaboration without losing access to historical encrypted reports. Includes a link in the UI to the [Key Backup & Recovery guide](./docs/encryption_backup.md).
  - **Implementation Details:**
    - Built UI buttons in Project Settings to download the private key as a `.swazzkey` file (JSON JWK format) or reveal a 12-word mnemonic seed phrase.
    - Implemented import/recovery fields in the project initialization UI flow to allow users to enter a seed phrase or upload a `.swazzkey` file to restore the private key to local IndexedDB (`KeyStorage`).
    - Derived the X25519 private key from the mnemonic seed phrase using PBKDF2 client-side derivation and standard wordlist validation.

- [x] **Task 112: Webhook Notifications & Report Upload Integration**
  - **Design Goal:** Support webhook notifications to allow uploading fuzzer findings/reports (including validated AI findings/remediation recommendations) to user-specified URLs.
  - **Implementation Details:**
    - Add a `webhooks` configuration section to Project Settings (allowing users to define target URLs, authentication headers, and toggle event types).
    - Save webhook configurations in D1.
    - When fuzzer events or findings are logged (including after LLM triage and patch validation), serialize the finding reports and queue a webhook delivery.
    - The edge backend stores the original reports in the D1 database, but the webhook delivery must dispatch the reports out to the client's destination URL asynchronously (e.g. using Cloudflare Workers outbound fetch, decoupled via findings queues).

- [x] **Task 89: Webhook HMAC Signature Verification**
  - **Design Goal:** Secure outbound webhook requests by signing payloads with a secret key using HMAC-SHA256, allowing receiver endpoints to verify request authenticity.
  - **Implementation Details:**
    - Generate a unique secret key (e.g., `whsec_...`) automatically upon creating a new project webhook, persisting it in the database.
    - Display the secret key in the Project Settings webhooks configuration UI so that users can configure it on their target servers.
    - Sign the JSON payload using Web Crypto's HMAC-SHA256 and attach the signature along with a timestamp in a custom header (e.g. `X-Swazz-Signature: t=1720000000,v1=signature_hex`) to prevent replay attacks.

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

- [x] **Task 104: UI/UX Right Column Cleanup**
  - **Design Goal:** Review and declutter the right-hand column/sidebar of the UI.
  - **Implementation Details:**
    - Identify controls in the right column that are redundant or rarely used.
    - Move these rarely used controls exclusively to the Project Settings page to streamline the main workspace view.

- [x] **Task 111: Fix Logo Alignment in Authenticated Header**
  - **Design Goal:** Adjust header layout alignments to fix the logo image displacement that occurs when a user is logged in.
  - **Implementation Details:**
    - Fix the CSS styling rules in the header component for logo placement under authenticated user states.

- [x] **Task 108: Multi-Scan Comparison Mode**
  - **Design Goal:** Implement a comparison view allowing users to select and compare finding statistics, coverage metrics, and diffs between two separate scans.
  - **Implementation Details:**
    - Design a comparison utility to side-by-side analyze changes, new findings, and fixed issues between scan runs.

- [x] **Task 103: Footer and Navigation Reorganization**
  - **Design Goal:** Clean up the navigation structure by moving external links and help menus.
  - **Implementation Details:**
    - Move the GitHub link and the hotkeys help menu to the footer.
    - Create an "About the project" page and add a link to it in the footer.

- [x] **Task 106: Streamline Scan Progress Header Panel**
  - **Design Goal:** Reduce the height of the top header panel that displays the scan progress, as it currently consumes too much vertical space.
  - **Implementation Details:**
    - Streamline layout and typography of the active scan header, merging metadata into compact badges.

- [x] **Task 109: Project Settings API Specifications Sub-Tab**
  - **Design Goal:** Duplicate API specs configurations and import tools directly into the project settings menu for improved target configuration.
  - **Implementation Details:**
    - Add a sub-tab under Project Settings to view, edit, and upload API specs (Swagger/HAR/Postman).

- [x] **Task 80: AI Remediation Stack & Rule Autocompletion UI**
  - **Design Goal:** Enhance the AI Remediation Config experience by dynamically appending context to the AI prompt based on user-selected tech stacks and vulnerability rules.
  - **Implementation Details:**
    - Provide a checkbox list of common tech stacks (React, Node, Go, Python, Postgres, .NET, Flask, Django, Next.js, FastAPI, Spring Boot).
    - When the user selects a stack or selects specific "Rules to Auto-Fix", automatically append relevant instructions or knowledge to the selected `CLI Execution Command` prompt templates.

- [x] **Task 116: Deepen Tech Stack Security Guidelines & Rules Integration**
  - **Design Goal:** Curate and expand highly specific, framework-specific secure coding rules for each supported technology stack (React, Node, Go, Python, Postgres, .NET, Flask, Django, Next.js, FastAPI, Spring Boot) to generate more precise AI remediation patches.
  - **Implementation Details:**
    - Perform deep research or ingest OWASP Cheat Sheets for each specific framework/stack.
    - Define comprehensive, high-quality checklists (e.g. CSRF protection in Flask via WTF, route security and data leaking in Next.js Server Actions, entity mapping validations in Spring Boot, query formatting in C#/.NET).
    - Map each checklist to prompt templates or agent runtime configurations to further refine the AI's patch generation capabilities.

- [x] **Task 107: Scans History Tab Layout Reorganization**
  - **Design Goal:** Redesign the scans history list to use a tabbed interface for clearer navigation and visual organization.
  - **Implementation Details:**
    - Reorganize history layouts into categorized tabs (e.g. Active, Completed, All, Failed).

- [x] **Task 108: Auto-Hide Side Panels in Settings Views**
  - **Design Goal:** Automatically hide/collapse the left and right navigation/configuration panels when navigating to project or user settings to optimize screen real estate for settings forms.
  - **Implementation Details:**
    - Detect routing/view transition to Project Settings or User Settings tabs.
    - Automatically trigger states to collapse both the left sidebar and the right configuration panel.
    - Ensure the panels are restored or can be reopened when navigating away from the settings views.

- [x] **Task 129: Optimize OWASP Top 10 Tab Performance**
  - **Design Goal:** Prevent the OWASP Top 10 tab from showing an infinite loading state during active scans, and implement category highlighting and direct deduplicated filtering upon card click.
  - **Implementation Details:**
    - Replace the clearing/debouncing `setTimeout` in the `useEffect` hook in `packages/web/src/components/OWASPTop10/OWASPTop10.tsx` with a throttled query or a low-frequency polling mechanism during scans to ensure results load incrementally.
    - Highlight categories with matching findings immediately.
    - Implement category filtering upon clicking cards, deduplicating the list of results (removing duplicate findings).

## 🛡 Internal Security & Infrastructure

- [x] **Task 13:** Harden the Dockerfile (multi-stage build, distroless base, non-root user) and integrate Trivy image vulnerability scanning into GitHub Actions.

- [x] **Task 14:** Setup Static Application Security Testing (SAST) for Swazz itself using `gosec` (Go Security Checker) and GitHub CodeQL. *(Depends on: Task 2)*

- [x] **Task 15:** Configure Dependabot or Renovate to automatically update Go modules and npm dependencies.

- [x] **Task 22:** Implement E2E browser automation tests using Playwright.
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

- [x] **Task 75: Runner Token Rotation and Automatic Safety Shutdown**
  - **Design Goal:** Secure runner agent connections by supporting token rotation. If a runner's credentials are revoked or become invalid, the runner agent process must fail/exit immediately to prevent unauthorized loops.
  - **Implementation Details:**
    - Update the runner agent CLI command (`run-agent` in Go) to detect authentication failure responses (such as `401 Unauthorized`).
    - Instead of retrying connection loops indefinitely, print a critical error message and terminate the process with a non-zero exit code.

- [x] **Task 102: Custom Session Expiration per Project**
  - **Design Goal:** Allow users to choose a custom session expiration time for members participating in a project.
  - **Implementation Details:**
    - Add a project setting for member session expiration length.
    - Enforce this expiration on the edge backend when validating user sessions scoped to the project.

- [x] **Task 119: Account Login History Auditing**
  - **Design Goal:** Track and audit user login sessions (success, failed, 2FA failures) to provide security transparency. Allow project administrators/owners to view login history for any member in their project for compliance and audit logs.
  - **Implementation Details:**
    - Created database table `user_login_history` to log: IP, Country, City, Region, Timezone, Device Type, Cloudflare Ray ID, User-Agent, status (success/failed), and timestamp.
    - Leverage Cloudflare-provided geolocation and network details (using `CF-Connecting-IP`, `CF-IPCountry`, `CF-Ray`, `CF-Device-Type` headers or `c.req.raw.cf` properties).
    - Log attempts in `POST /api/auth/login` (successful login, incorrect password, rate-limited, TOTP validation failures) and `POST /api/auth/register`.
    - Implemented a backend route `GET /api/projects/:id/members/:user_id/login-history` protected by a new RBAC permission `get:/api/projects/:id/members/:user_id/login-history` (assigned to Owner/Editor roles).
    - Validate that the target `:user_id` is a member of project `:id` to prevent cross-project scanning.
    - Created a React UI tab/panel under Project Members or User Settings to display login logs in a clear, paginated table format with browser icons and geo-resolved information.

- [x] **Task 121: Container Image Signing & Verification via Cosign**
  - **Design Goal:** Secure built runner agent container images against supply chain tampering by signing release images with Cosign.
  - **Implementation Details:**
    - Generate a key pair for image signing (`cosign generate-key-pair`).
    - Store the public verification key (`cosign.pub`) in the repository under a `keys/` directory and document image verification steps.
    - Save the private key as a GitHub Action Secret `COSIGN_PRIVATE_KEY` (along with its password secret).
    - Update the build & publish CI workflow to install Cosign and sign the built Docker images after pushing them to the registry.

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

- [x] **Task 113: D1 Vertical Sharding Architecture**
  - **Design Goal:** Lay the groundwork for scaling beyond the Cloudflare D1 10 GB per-database limit by enabling manual vertical sharding across multiple D1 databases. The system should operate with a single D1 database today, but the architecture must not prevent future shard expansion.
  - **Implementation Details:**
    - Introduced a centralized `getDB(env, routingKey?)` helper in `packages/edge/src/utils/db.ts` that resolves database bindings dynamically based on routing keys (e.g. user ID, scan ID, project ID).
    - Refactored index entrypoints, Hono routes, and the coordinator Durable Object to query D1 exclusively via the `getDB` wrapper.
    - Documented the architecture design decisions and routing options in `docs/sharding.md`.
    - Added and enabled integration tests in `db.test.ts` to verify multi-shard routing.

- [x] **Task 114: Slow Query Monitoring**
  - **Design Goal:** Detect and surface D1 queries that exceed acceptable latency thresholds so that performance regressions are caught before they affect end users.
  - **Implementation Details:**
    - Wrapped all D1 `prepare().bind().run() / .first() / .all()` calls in a timing wrapper that records wall-clock duration.
    - Emits a structured log line (via `console.warn`) whenever a query exceeds a configurable threshold (default: 200 ms).
    - Exposes an aggregated slow-query counter as a Cloudflare Analytics Engine data point.
    - Added a `GET /api/admin/slow-queries` endpoint (admin-only) returning recent slow-query records stored in KV (TTL: 24h) for quick inspection without opening the Cloudflare console.


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

- [x] **Task 58: Content Security Policy (CSP) Security Analysis**
  - **Design Goal:** Detect insecure, overly permissive, or missing Content Security Policies in target API and web application HTTP responses.
  - **Implementation Details:**
    - Parse headers like `Content-Security-Policy` and `Content-Security-Policy-Report-Only` in the response analyzer.
    - Flag unsafe directives such as `unsafe-inline`, `unsafe-eval`, or wildcard sources (`*`) that weaken protection against XSS and data injection.

- [x] **Task 76: AI-Based Findings Analysis with Local Repository Context**
  - **Design Goal:** Automatically analyze and explain discovered vulnerabilities by correlating finding routes and parameters with the client's local repository code using AI (Claude or Antigravity).
  - **Implementation Details:**
    - Extend the CLI with an analysis mode (e.g., `--analyze-repo <path>`) that clones/reads the target repository.
    - Build a fast pre-indexing system in the CLI to scan the files beforehand for quick symbol and path lookup.
    - Allow users to configure instructions (prompts) specifying what vulnerabilities to prioritize and where to look.
    - Match endpoint routes from findings to file paths, retrieve relevant code context, and invoke the LLM to output remediation steps.

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

- [x] **Task 80: Immediate User Data Deletion (Right to be Forgotten)**
  - **Design Goal:** Allow users to immediately and permanently delete all their account data, project configurations, runners, and scan history to comply with privacy regulations (e.g. GDPR) and ensure clean slate capabilities.
  - **Implementation Details:**
    - Add a **Delete My Account & Data** button (with a double-confirmation prompt) in the `UserSettings` dashboard overlay.
    - Implement a `DELETE /api/users/me` edge worker API endpoint in the coordinator.
    - Ensure the endpoint executes a clean cascading database deletion in D1 (deleting `users`, associated `projects`, `scans`, `findings`, and `runners`).
    - Revoke and drop any active WebSocket runner connections matching the deleted user's ID immediately in the Durable Object.
    - Clear all client-side cache and credentials (auth tokens, cookies, and local IndexedDB databases) before redirecting the browser to the registration screen.

- [x] **Task 87: Project Invitations and Collaboration (via Email/Username)**
  - **Design Goal:** Enable multi-user collaboration inside projects by allowing project owners to invite other users to join their projects with structured Role-Based Access Control (RBAC).
  - **Implementation Details:**
    - Define a formal permission set mapping combinations of HTTP Verbs and Endpoint paths (e.g., `READ: /api/projects/:id/runs`, `WRITE: /api/projects/:id/settings`).
    - Define roles (e.g., Owner, Editor, Viewer) as collections of these verb+endpoint permission items.
    - Create a project member invitation schema and endpoints (`POST /api/projects/:id/invitations`).
    - Support inviting users directly by email (sending an invitation code or registration link) or by username, assigning them a target role.
    - Implement an invitation state machine (Pending, Accepted, Expired, Revoked) in the database.
    - Validate permissions on the edge coordinator using the RBAC mapping during API requests.
    - Update frontend Settings screen to display a "Members" tab listing active members, pending invitations, and options to invite new users or manage member roles.

- [x] **Task 94: Support Billing Plans & Admin Plan Management**
  - **Design Goal:** Support billing plans (Free by default) and allow manual plan upgrades/downgrades to "Supporter Plan" by administrators.
  - **Implementation Details:**
    - Add a `plan` column (type TEXT, default 'Free') to the `users` table in the database schema.
    - Set the default plan to 'Free' during new user registration in the Edge Coordinator.
    - Implement a mechanism (database script or coordinator admin endpoint) for manually updating user plans to 'Supporter Plan'.

- [x] **Task 110: RBAC Guest Role Restrictive Policy**
  - **Design Goal:** Enforce strict RBAC constraints on guest/viewer roles, disabling member and role modification permissions in both the UI elements and the Edge coordinator API.
  - **Implementation Details:**
    - Implement backend validation to reject members/role write operations for guest tokens, and disable the corresponding actions in the UI.

- [x] **Task 118: User-Configured Scheduled Auto-Scans**
  - **Design Goal:** Allow users to schedule automatic vulnerability scans on their projects at custom intervals, restricted by billing plan limits (e.g. only available on the "Supporter Plan").
  - **Implementation Details:**
    - Add a `cron_schedule` field to `scan_configs` or create a new `scan_schedules` table in D1.
    - Implement a Cloudflare Workers Cron Trigger or coordinator scheduler loop to fetch pending schedules, verify the user's plan is "Supporter Plan", and trigger active fuzzer runs.
    - Add a "Schedule Scan" configuration panel in the project settings web UI supporting standard cron/interval selections.

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
    - Support ignoring findings by HTTP status codes or status code ranges (e.g., `400` or `4xx`) on a per-rule basis, configurable in both `swazz.config.json` and `swazz.ignore.json`, and integrated into the frontend triage UI modal.

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

- [x] **Task 61: Case-Insensitive URL Exclusions**
  - **Design Goal:** Prevent scan contamination by ensuring target path exclusion matching ignores alphabetical casing.
  - **Implementation Details:**
    - Modify URL filtering logic to perform case-insensitive comparisons against defined exclude paths (e.g. `/api/admin` matching `/API/Admin`).

- [x] **Task 63: UI Actions for Ignoring Findings & Accepting Risks**
  - **Design Goal:** Allow security auditors to triage issues directly in the dashboard by ignoring false positives or acknowledging accepted risks.
  - **Implementation Details:**
    - Add buttons to individual findings to mute them or mark them as "Accept Risk".
    - Automatically append corresponding rules to `swazz.ignore.json`.

- [x] **Task 64: Include Test Profile Type in SARIF Reports**
  - **Design Goal:** Provide better context in CI/CD pipelines by embedding the exact fuzzer test profile/vulnerability category in SARIF output files.

- [x] **Task 65: Refine BOLA/IDOR Tests to Ignore Requests without Auth Substitution**
  - **Design Goal:** Reduce false positive findings by skipping BOLA evaluation on endpoints where no authorization tokens or parameters were present in the baseline request to swap.

- [x] **Task 66: Fix URL Casing Conversion in SARIF Output**
  - **Design Goal:** Resolve the bug where URLs in exported SARIF logs are incorrectly capitalized (e.g., converting `/api/bank` to `/Api/Bank`).

- [x] **Task 70: JSONC Support for Configuration Files**
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

- [x] **Task 71: Runner Registration UI — Shared vs Private Mode**
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
    - **Agent version display:** Surface the runner agent's version tag next to the name/status in the "Distributed Fuzzing Agents" settings table. The version tag must comply with semantic versioning (semver, e.g. `v1.0.0`).

- [x] **Task 72: Propagate `projectId` from Web UI to Backend on Scan Start**
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

- [x] **Task 73: Register Private Runners Even with Project-Specific Public Runners**
  - **Design Goal:** Ensure users can register private/custom runners for a project even if public/shared runners are already registered or available. Currently, once a runner is registered, the UI hides/removes the registration instructions and token, blocking further registrations.
  - **Implementation Details:**
    - Update the Settings/Runners UI (e.g., in `UserSettings.tsx`) to ensure the runner registration tokens and registration command cards remain visible and usable regardless of whether other runners are online.

- [x] **Task 74: Option to Disable Shared Runners in Project Configuration**
  - **Design Goal:** Allow project owners to prevent their project's fuzzing jobs from running on public/shared runners, restricting them only to their own private runners for data isolation and performance.
  - **Implementation Details:**
    - Add a `Disable Shared Runners` setting (represented by a flag like `use_shared_runners: false`) in the project configuration schema and Settings UI.
    - Update `Coordinator.ts` queue matching logic so that if shared runners are disabled for a project, the coordinator will only dispatch its scans to private runners authenticated with the owner's key.

- [x] **Task 78: Upgrade OWASP API Security Categorization to 2025 Edition**
  - **Design Goal:** Transition compliance tagging from the OWASP API Security Top 10 (2023) to the 2025 standard to keep reports up-to-date.
  - **Implementation Details:**
    - Update `packages/container/internal/classifier/owasp.go` mapping function to categorize rule IDs according to the latest OWASP 2025 categories.
    - Align Web Dashboard tables and report formatters (HTML, JSON, Markdown) to display the updated 2025 taxonomy.

- [x] **Task 79: Project Security Review & System Architecture Documentation**
  - **Design Goal:** Improve codebase transparency, security posture, and developer onboarding by performing a formal security review and documenting general system/component architecture diagrams.
  - **Implementation Details:**
    - Perform a comprehensive threat modeling and security review of the Swazz core fuzzer, edge coordinator, Web UI, and runner communication channels.
    - Produce detailed architecture flow diagrams (using Mermaid in Markdown) detailing component interaction, JWT/key authentication sequences, data flow (D1 database & R2 bucket integrations), and WebSocket/SSE streaming.
    - Write security guidelines for deployment, covering self-hosted runner network isolation and TLS configurations.

- [x] **Task 81: Limit $ref expansion in swazz (protection from OOM on dense/cyclic OpenAPI)**
  - **Design Goal:** Limit the recursive expansion of `$ref` in OpenAPI spec parsing to prevent memory blowup (OOM) on highly dense, cyclic, or complex specs.
  - **Implementation Details:**
    - Introduce DAG-based resolution with memoization (`resolvedRefs`) and recursion tracking (`inProgress`) in `resolver.go`.
    - Enforce a safety node budget limit of 50,000 nodes and recursion depth limit of 64.
    - Log warnings detailing endpoint/schema truncation context upon exceeding limits.
    - Document safety limits in architecture documentation.

- [x] **Task 83: Implement Two-Factor Authentication (2FA) via OTP**
  - **Design Goal:** Protect user accounts by adding an extra layer of security with Time-based One-Time Passwords (TOTP) compatible with Google Authenticator or other authenticator apps.
  - **Implementation Details:**
    - Generate cryptographically secure TOTP secrets on the backend edge coordinator.
    - Provide a QR code (using a client-side or backend QR generator) and a plain-text seed string for manual entry during setup.
    - Require verification of a valid OTP code before enabling 2FA for the user.
    - Update the `/api/auth/login` endpoint to require a `2fa_code` payload if 2FA is active, validating the code using a TOTP library before issuing the JWT.

- [x] **Task 89: Encrypt TOTP Secrets with User Passwords (AES-256-GCM)**
  - **Design Goal:** Increase database security by storing `two_factor_secret` in an encrypted format using AES-256-GCM, with the user's password as part of the key generation mechanism.
  - **Implementation Details:**
    - Instead of plain Base32 secrets in the DB, encrypt the generated seed using Web Crypto API's AES-256-GCM.
    - Derive a key using PBKDF2 from the user's raw password combined with a unique salt.
    - Store the unique initialization vector (IV) and the encrypted payload in the `two_factor_secret` column.
    - Decrypt the secret on-the-fly during login/verification inside edge memory (which has access to the user's raw password parameter).

- [x] **Task 35:** Add high-quality screenshots or GIFs of the Web Dashboard to the `README.md` *(replaces Task 3)*.
  - **Design Goal:** Create a strong first impression for developers visiting the GitHub repository. *(Depends on: Task 21 completion for mutation diff screenshots)*
  - **Implementation Details:**
    - Capture screenshots/GIFs of: Heatmap view during an active run against the demo API (Task 12), Inspector with request detail & mutation diff (Task 21), Configuration sidebar with payload categories modal, HTML export report, CLI terminal output.
    - Optimize images for web (compressed PNG or animated WebP, <500KB each).
    - Add a visual "Features" section to `README.md` with an image carousel or table layout.

- [x] **Task 90: Implement CSRF Protection Middleware in Coordinator**
  - **Design Goal:** Protect state-changing HTTP endpoints (POST, PUT, DELETE, PATCH) on the edge coordinator from Cross-Site Request Forgery attacks, establishing double-submit cookie validation.
  - **Implementation Details:**
    - Implement a custom CSRF protection middleware in Hono (or integrate `hono/csrf`).
    - Verify that requests with credentials validate the `X-CSRF-Token` HTTP request header against a cryptographically secure token stored in a HTTP-only session cookie.
    - Ensure that safe methods (GET, HEAD, OPTIONS) bypass CSRF checks.
    - Update frontend request hooks (`useRunner`, `useFuzzSession`, auth actions) to dynamically parse the CSRF token from the DOM/cookies and attach it to state-changing API request headers.

- [x] **Task 91: Modernize Login Page & Form Security Features**
  - **Design Goal:** Enhance the login form and backend authentication logic to match modern security best practices, protecting against brute-force, credentials stuffing, and username enumeration while maintaining a frictionless user experience.
  - **Implementation Details:**
    - **Split Data Entry:** Split the login process into two steps: Step 1 collects the username/email and returns a short-lived temporary session token (regardless of user existence). Step 2 accepts the token and password to finalize authentication.
    - **Adaptive/Dynamic CAPTCHA:** Integrate Cloudflare Turnstile, but configure it dynamically. Only show/require CAPTCHA when auth failure rates or login request volume exceed baseline thresholds.
    - **Defensive Delays (Anti-Enumeration):** Introduce dynamic response delays. If a user does not exist, inject a random delay (e.g., 150-250ms) to ensure overall request latency matches database-heavy lookups of valid users.
    - **Rate Limiting:** Implement IP-based and overall system rate limiting for authentication endpoints, returning HTTP 429 when limits are breached.
    - **Weak Password Rejection & Strength Meter:** Reject weak passwords during registration using a blacklist or k-Anonymity (Pwned Passwords). Add a dynamic password strength meter on the UI, encouraging password manager usage.
    - **Passwordless Option:** Support magic link authentication via short-lived, single-use email tokens verified against the client IP/device.

- [x] **Task 92: Modern Landing Page with Popup Authentication**
  - **Design Goal:** Replace the current login/registration screen with a high-converting, premium-looking sales landing page, opening the login/registration forms inside a modern, glassmorphic popup modal.
  - **Implementation Details:**
    - Design a modern landing page showcasing Swazz features, benefits, and call-to-actions.
    - Implement a modal dialog for authentication, replacing the full-screen LoginScreen with a responsive popup window.

- [x] **Task 96: Implement Content Negotiation for Landing Page**
  - **Design Goal:** Support content negotiation on the landing page so that when a client sends an `Accept: text/markdown` header, the server returns the page content in clean Markdown instead of HTML.
  - **Implementation Details:**
    - Check the `Accept` header of incoming requests to the landing page routes.
    - If the client requests `text/markdown`, return the landing page layout and copy in clean Markdown.
    - For standard browser requests (requesting `text/html`), continue returning the rich HTML/JS frontend application.
    - For reference, consult the MDN Content Negotiation specification (https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation).

- [x] **Task 93: Runner Launch Security Review & Target Sandboxing**
  - **Design Goal:** Prevent runner misuse (such as unauthorized external network scanning, SSRF, or local container escape) by performing a comprehensive security review and implementing target validation filters and sandboxing constraints on runner execution.
  - **Implementation Details:**
    - Implement a strict destination whitelist/blacklist check in the fuzzer runner to prevent scanning internal cloud/private endpoints (e.g. metadata service `169.254.169.254` or local loopback `127.0.0.1`).
    - Audit how the runner executes shell commands, binds keys, or mounts filesystems during runner execution.
    - Provide a security guide for sandboxing runners in Docker containers (e.g., using `--cap-drop`, rootless mode, and CPU/memory constraints).

- [x] **Task 96: KV Read-Through Cache for API Key & Session Token Verification**
  - **Design Goal:** Reduce D1 database read transaction costs by ~90% and cut API request authentication latency from 150ms to ~15ms by introducing a Cloudflare KV read-through cache for API key verification in `getUserIdFromRequest()`.
  - **Implementation Details:**
    - Add `SESSION_CACHE` KV namespace binding to `wrangler.toml` and `Env` interface (optional — graceful fallback to D1-only when not bound).
    - Implement KV read-through cache with positive (5 min TTL) and negative (1 min TTL) caching for `swazz_live_*` API key tokens.
    - Add cache invalidation on API key regeneration (`POST /api/auth/regenerate-key`) and scheduled account deletion (`cleanupScheduledDeletions`).
    - JWT tokens remain unaffected (verified locally via HMAC without D1 queries).

- [x] **Task 100: Actualize Landing Page Content & Valuable Capabilities**
  - **Design Goal:** Update the landing page copy to explicitly list all supported API spec formats (OpenAPI, GraphQL, SOAP, Swagger files) and highlight the most valuable features and capabilities of the Swazz platform.
  - **Implementation Details:**
    - Update the marketing copy on the landing page to mention SOAP and Swagger support alongside OpenAPI and GraphQL.
    - Highlight core capabilities like OWASP Top 10 mapping, request mutation visual diffs, private runner Ed25519 authentication, and real-time fuzzer metrics.

- [x] **Task 60: DefectDojo Integration Enhancements**
  - **Design Goal:** Improve metadata richness when importing Swazz reports into DefectDojo by correctly mapping vulnerabilities, scopes, and payloads.
  - **Implementation Details:**
    - Ensure correct mapping of severity levels, grouping, service names, and URL paths.
    - Embed fuzzed payloads, request/response bodies, and corresponding MITRE CWE identifiers into exported report formats.

- [x] **Task 84: Implement Passkey Authentication Support (WebAuthn)**
  - **Design Goal:** Provide a modern, passwordless authentication alternative using biometric sensors (FaceID, TouchID, Windows Hello) or physical security keys via the WebAuthn API.
  - **Implementation Details:**
    - Implement WebAuthn registration and authentication flows in the edge coordinator backend.
    - Store credential public keys and signature counters in the users D1 database.
    - Update the frontend LoginScreen to support passkey registration in user settings and passkey login as an alternative to both passwords and 2FA OTP codes.

- [x] **Task 86: Cloudflare KV and Cache API Optimization Research**
  - **Design Goal:** Identify parts of the coordinator and runner architectures that would benefit from global, low-latency Cloudflare KV or regional Cache API storage (e.g., global API rate limiting, scan fuzzer payload catalog caching, global session blacklists, or feature flags).
  - **Implementation Details:**
    - Document KV read/write cost trade-offs vs in-memory Workers isolate caching.
    - Research using KV for keeping track of active runner heartbeat state to avoid Durable Object lookups.

- [x] **Task 68: Agent Update Notifications**
  - **Design Goal:** Automatically check and notify administrators in the dashboard logs when connected Go runner agents are running outdated versions.

- [x] **Task 57: Cloudflare Queues Integration for Scaling Scans & Buffering Findings**
  - **Design Goal:** Improve the system's scalability, reliability, and resilience by decoupling task dispatch and result ingestion from synchronous request/WebSocket paths, mitigating D1 database pressure under high concurrency.
  - **Implementation Details:**
    - **Scan Queue:** Create a Cloudflare Queue for incoming scans. Instead of returning `503 No runners available` when no runners are online, push scan configurations to the queue. Have the coordinator pull and assign them when a runner connects.
    - **Finding & Log Buffer:** Push fuzzer findings/events generated by Go runners to a separate Cloudflare Queue. Configure a consumer Worker to process findings in batches (e.g., up to 100-500 messages) and execute bulk database insertions into Cloudflare D1.
    - **Reliable Notification Webhooks:** Queue Slack, Discord, or generic Webhook notifications to guarantee delivery with automatic retry logic, decoupling slow external network calls from the main runner sync flow.

- [x] **Task 115: Structured Logging Framework**
  - **Design Goal:** Provide a unified, searchable, JSON‑structured logging system across all workers (edge, container, web) to simplify debugging, observability, and alerting.
  - **Implementation Details:**
    - Introduce a tiny logging helper (e.g. `logInfo`, `logWarn`, `logError`) that emits JSON with fields: `timestamp`, `level`, `module`, `msg`, `requestId`, `traceId` (if available), and any additional `payload`.
    - Use Cloudflare Workers `console.log` / `console.warn` – these automatically forward JSON to Cloudflare Logpush if enabled.
    - Replace ad‑hoc `console.log("something")` calls throughout the codebase with the new helpers (search & replace).
    - Add a `logpush` configuration in `wrangler.toml` to ship logs to a destination (e.g., Elasticsearch, Loki, or Cloudflare Logs UI).
    - Provide a small UI component in the web app (admin panel) that fetches recent logs via the new `/api/admin/logs` endpoint (admin‑only) – the endpoint reads from KV where a short‑term rolling buffer (e.g., last 10 k entries) is stored.
  - **Short‑Term Action:**
    - Create `packages/common/logging/logger.ts` with the helper functions.
    - Export and replace inline `console.*` calls in existing modules (edge, container, web) via a focused commit.
    - Document usage guidelines in `docs/logging.md`.

- [x] **Task 77: Dynamic Analytics Dashboard**
  - **Design Goal:** Provide visual insights into fuzzing history, vulnerability trends, and runner performance over time in a dynamic dashboard.
  - **Implementation Details:**
    - Add an Analytics tab/page in the Web UI dashboard.
    - Query historical tables (e.g., `scans`, `findings`, and runner metrics) from the D1 database to render dynamic charts (e.g., using Chart.js or Recharts).
    - Render stats showing scan frequencies, vulnerability categories over time, and runner utilization metrics.

- [x] **Task 101: Deploy & Publish Live Vulnerable Demo API**
  - **Design Goal:** Deploy a publicly accessible instance of the Vulnerable Demo API, enabling new users to immediately run their first fuzzing scan against a live, interactive target.
  - **Implementation Details:**
    - Deploy the Vulnerable Demo API to a cloud platform (Cloudflare Workers) as an independent worker with custom domain `bbad.secmy.app`.
    - Set up dynamic server origin injection in the swagger spec returned by the Worker.
    - Update the onboarding welcome landing page and configurations to target `https://bbad.secmy.app/swagger.json`.
    - Support clicking the "Try Vulnerable Demo" button to automatically load and run the scan.

- [x] **Task 69: Model Context Protocol (MCP) Support**
  - **Design Goal:** Expose Swazz commands and findings through an MCP server interface, allowing AI coding assistants to trigger and query scans natively.
  - **Implementation Details:**
    - Secure API Key Storage using SHA-256 one-way hashing on backend (plain text returned once on creation/rotation, masked on subsequent loads).
    - Dynamic MCP annotations registry mapping tools to Hono REST endpoints.
    - Internal App fetch route dispatching ensuring full authorization and RBAC verification.
    - Local RAG server merging cloud tools and dynamic forwarding of remote requests.
    - Frontend UserSettings key rotation & masking UI and automated E2E & unit tests.
- [x] **Task 97: Closed Beta Launch & Infrastructure Capacity Control**
  - **Design Goal:** Establish a closed beta registration limit (max 50 users) to progressively scale and stress-test target coordination infrastructure without running into capacity exhaustion.
  - **Implementation Details:**
    - Implement a registration counter check in `POST /api/auth/register` to reject new signups once the user registry count reaches 50.
    - Support admin invites or bypass codes to register extra users manually during the beta phase.
    - Design status banners in the web client dashboard alerting users about the current beta limits.

- [x] **Task 117: Query Runner Logs in Web UI scoped to Scans**
  - **Design Goal:** Allow developers to view execution logs generated by private or public runner agents during a specific fuzzing scan directly in the Web UI, simplifying debugging of connectivity, timeouts, or target reachability issues.
  - **Implementation Details:**
    - Extend the Go runner agent to capture its console output (stdout/stderr or logger messages) during a scan.
    - Stream these logs via the WebSocket connection to the edge coordinator as specific `runner_log` events.
    - Save these logs in a new D1 table `runner_logs` (schema: `id, scan_id, timestamp, level, message`) or reuse the `scan_events` table with a custom payload structure.
    - Implement a backend route `GET /api/scans/:id/runner-logs` (scoped to project viewer permissions) fetching logs for the specified scan.
    - Build a "Runner Logs" tab in the Active Scan and Scans History UI pages to view, search, and copy logs.

- [x] **Task 124: Refactor remaining edge routes to Service Classes**
  - **Design Goal:** Apply the architecture used in `projects.ts` (extracting logic to `*Services` class, inheriting from `BaseService`, and injecting via DI) to the rest of the edge application routes (e.g. `scans`, `runners`, `auth`, `misc`, `rbac`).
  - **Implementation Details:**
    - Isolate D1 queries and business logic from Hono HTTP handlers.
    - Setup dependency injection factories for testing.
    - Write robust unit tests with mocked services for each refactored route.


- [x] **Task 105: Fix RBAC Logical Gaps (Validation Checks)**
  - **Design Goal:** Ensure API robustness by verifying the existence of entities before modifying them.
  - **Implementation Details:**
    - `updateMemberRoles`: Verify user is a project member before applying updates.
    - `updateCustomRole` & `deleteCustomRole`: Verify the role exists before performing updates/deletes.
    - `createInvitation`: Prevent sending multiple active invitations to the same user/email in the same project.

- [x] **Task 106: Fix Authentication Bypasses in Scans Service**
  - **Design Goal:** Ensure that unauthenticated requests do not bypass RBAC checks when `AUTH_ENABLED` is true.
  - **Implementation Details:**
    - In `ScansService`, methods like `createScan`, `getScans`, `getScan`, `updateScan`, and `generateUploadUrl` currently skip RBAC checks if `userId` is `null` (e.g. unauthenticated request), allowing them to bypass `project_id` restrictions.
    - Require `userId` to be present if `AUTH_ENABLED === 'true'` and the target entity is tied to a `project_id`.

- [x] **Task 128: Direct User & Service Account Provisioning**
  - **Design Goal:** Enable project administrators to create and configure user profiles and service accounts directly from the project membership interface, providing immediate credential or API token generation.
  - **Implementation Details:**
    - Add a "Create User / Service Account" modal next to the invite options in `packages/web/src/components/ProjectSettings/MembersRolesTab.tsx`.
    - Implement a backend endpoint (e.g., `POST /api/projects/:id/members/create`) in `packages/edge/` to register and automatically join a new user to the project, assigning roles immediately.
    - Define corresponding RBAC permissions (e.g., `post:/api/projects/:id/members/create`) in `packages/edge/src/config/rbac.ts` and assign to default roles (like `owner` and `editor`).
    - Provide secure generation of credentials (a generated password or permanent API key) that are stored using a strong one-way cryptographic hash (e.g., bcrypt or SHA-256) in the database and displayed only once to the admin upon creation.
    - Add validation ensuring the username is between 3 and 20 characters, matching the project's standard criteria `^[a-zA-Z0-9_\-]{3,20}$`.
    - Ensure service accounts can be flagged as non-interactive (API-only) to restrict interactive UI login.

- [x] **Task 128-SSTI: Dynamic SSTI Math Expressions**
  - **Design Goal:** Reduce false positives in SSTI detection by replacing the static `7*7` mathematical evaluation check with dynamic multiplication or addition of random prime numbers less than 100.
  - **Implementation Details:**
    - Generate SSTI payloads dynamically with randomized math expressions (e.g. multiplying or adding two random prime numbers less than 100).
    - Evaluate these expressions during analyzer checks dynamically instead of relying on a hardcoded string `49`.

- [x] **Task 140: Landing Page UX Redesign**
  - **Design Goal:** Improve the conversion funnel by redesigning the hero section and establishing brand consistency without relying on the login flow.
  - **Implementation Details:**
    - Replace the static login screenshot with a dynamic demo/GIF of actual OWASP findings.
    - Add a clear primary CTA (e.g., "Run a live demo scan").
    - Add social proof (GitHub stars, scan metrics, etc.).
    - Align the landing page visual style with the product dashboard.

- [x] **Task 141: Login & Registration Flow Redesign**
  - **Design Goal:** Provide a frictionless, bug-free entry into the application.
  - **Implementation Details:**
    - Remove the auto-opening login modal on the first visit.
    - Prioritize GitHub Auth as the primary method and "Try without signup" as secondary.
    - Postpone the mandatory E2EE key generation (seed phrase) until the user actually has findings to protect.
    - Fix the Cloudflare Turnstile "Verification failed" P0 bug on auth gates.

