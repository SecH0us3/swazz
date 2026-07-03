# 🗺 Swazz Roadmap

This roadmap tracks planned features, documentation improvements, and architectural changes for the **Swazz** fuzzer. 

> **AI Assistant Note:** Antigravity can automatically execute these tasks. Just say: *"Antigravity, start working on task X"* and the AI will implement the feature and check it off the list.


## 🟢 Low Complexity

- [ ] **Task 97: Closed Beta Launch & Infrastructure Capacity Control**
  - **Design Goal:** Establish a closed beta registration limit (max 50 users) to progressively scale and stress-test target coordination infrastructure without running into capacity exhaustion.
  - **Implementation Details:**
    - Implement a registration counter check in `POST /api/auth/register` to reject new signups once the user registry count reaches 50.
    - Support admin invites or bypass codes to register extra users manually during the beta phase.
    - Design status banners in the web client dashboard alerting users about the current beta limits.


- [ ] **Task 98: RSS Feed Integration**
  - **Design Goal:** Provide a standard RSS feed for product updates, security disclosures, or public scan releases.
  - **Implementation Details:**
    - Create a public route (`GET /api/feed.xml` or `/feed.rss`) serving well-formatted RSS XML content.
    - Render posts, updates, or public releases with proper XML namespaces, publishing dates, and author credits.

- [ ] **Task 99: Secondary Product Blog**
  - **Design Goal:** Design and mount a realistic secondary blog section/layout to publish technical articles, vulnerability writeups, and security research related to Swazz fuzzer findings.
  - **Implementation Details:**
    - Set up a clean, modern blog index and article layout in the frontend web application.
    - Support markdown article rendering and sharing actions to drive organic technical traffic.

- [ ] **Task 107: Scans History Tab Layout Reorganization**
  - **Design Goal:** Redesign the scans history list to use a tabbed interface for clearer navigation and visual organization.
  - **Implementation Details:**
    - Reorganize history layouts into categorized tabs (e.g. Active, Completed, All, Failed).



## 🟡 Medium Complexity

- [ ] **Task 69: Model Context Protocol (MCP) Support**
  - **Design Goal:** Expose Swazz commands and findings through an MCP server interface, allowing AI coding assistants to trigger and query scans natively.

- [ ] **Task 88: Password Change, Reset Flow, and Backup Codes**
  - **Design Goal:** Provide secure password management tools including dynamic password changes, email-based password recovery (forgot password flow), and 2FA backup codes.
  - **Implementation Details:**
    - Implement `POST /api/auth/password/change` validating the current password before applying a new PBKDF2 hash.
    - Implement a tokenized forgot password flow: send recovery links/tokens via email, verifying them at `/api/auth/password/reset`.
    - Generate a set of 8-character numeric backup codes when 2FA is set up, saving their hashes in the database. Support logging in with a backup code in place of a TOTP code.


- [ ] **Task 114: Slow Query Monitoring**
  - **Design Goal:** Detect and surface D1 queries that exceed acceptable latency thresholds so that performance regressions are caught before they affect end users.
  - **Implementation Details:**
    - Wrap all D1 `prepare().bind().run() / .first() / .all()` calls in a thin timing helper (e.g. `timedQuery(stmt, label, env)`) that records wall-clock duration.
    - Emit a structured log line (via `console.warn` or a dedicated logger) whenever a query exceeds a configurable threshold (default: 200 ms).
    - Expose an aggregated slow-query counter as a Cloudflare Analytics Engine data point or a Workers `logpush` field so that trends are visible in the Cloudflare dashboard.
    - Add a `GET /api/admin/slow-queries` endpoint (admin-only) returning recent slow-query records stored in KV (TTL: 24h) for quick inspection without opening the Cloudflare console.

- [ ] **Task 116: Deepen Tech Stack Security Guidelines & Rules Integration**
  - **Design Goal:** Curate and expand highly specific, framework-specific secure coding rules for each supported technology stack (React, Node, Go, Python, Postgres, .NET, Flask, Django, Next.js, FastAPI, Spring Boot) to generate more precise AI remediation patches.
  - **Implementation Details:**
    - Perform deep research or ingest OWASP Cheat Sheets for each specific framework/stack.
    - Define comprehensive, high-quality checklists (e.g. CSRF protection in Flask via WTF, route security and data leaking in Next.js Server Actions, entity mapping validations in Spring Boot, query formatting in C#/.NET).
    - Map each checklist to prompt templates or agent runtime configurations to further refine the AI's patch generation capabilities.


## 🔴 High Complexity

- [ ] **Task 48: Implement Active Web Crawler (Spider)**
  - **Design Goal:** Enable target discovery by dynamically crawling web applications from a starting URL without relying solely on static API specifications.
  - **Implementation Details:**
    - Parse HTML responses for anchor tags, forms, link/script tags, and check common discovery files like robots.txt and sitemap.xml.
    - Implement a concurrent, recursive crawler in Go with rate-limiting, depth-limits, and domain scoping to build a dynamic Sitemap.
    - Feed discovered URLs and form inputs into the fuzzing execution pipeline.

- [ ] **Task 59: Headless Browser Crawler & Interception Sniffer**
  - **Design Goal:** Enable target discovery by crawling web applications using a browser engine, capturing and sniffing all background API requests to automatically populate the fuzzer path list.
  - **Implementation Details:**
    - Spin up a headless browser to crawl target pages.
    - Intercept network request traffic (AJAX, fetch requests, form submissions) and convert them to internal API specifications for fuzzing.

- [ ] **Task 62: Browser Extension for Real-Time Traffic Capturing & Request Recording**
  - **Design Goal:** Build a browser extension (similar to Cobalt) that sniffs web traffic as the user interacts with the app, recording API endpoints and capturing client requests directly into the Swazz configuration profile. This can serve as a more optimal, zero-setup alternative to exporting/uploading HAR files.
  - **Implementation Details:**
    - Capture HTTP/HTTPS requests on specified domains in background service workers.
    - Synchronize captured endpoints and authentication states in real-time with the local runner profile.

- [ ] **Task 112: Webhook Notifications & Report Upload Integration**
  - **Design Goal:** Support webhook notifications to allow uploading fuzzer findings/reports (including validated AI findings/remediation recommendations) to user-specified URLs.
  - **Implementation Details:**
    - Add a `webhooks` configuration section to Project Settings (allowing users to define target URLs, authentication headers, and toggle event types).
    - Save webhook configurations in D1.
    - When fuzzer events or findings are logged (including after LLM triage and patch validation), serialize the finding reports and queue a webhook delivery.
    - The edge backend stores the original reports in the D1 database, but the webhook delivery must dispatch the reports out to the client's destination URL asynchronously (e.g. using Cloudflare Workers outbound fetch, decoupled via findings queues).

- [ ] **Task 117: Query Runner Logs in Web UI scoped to Scans**
  - **Design Goal:** Allow developers to view execution logs generated by private or public runner agents during a specific fuzzing scan directly in the Web UI, simplifying debugging of connectivity, timeouts, or target reachability issues.
  - **Implementation Details:**
    - Extend the Go runner agent to capture its console output (stdout/stderr or logger messages) during a scan.
    - Stream these logs via the WebSocket connection to the edge coordinator as specific `runner_log` events.
    - Save these logs in a new D1 table `runner_logs` (schema: `id, scan_id, timestamp, level, message`) or reuse the `scan_events` table with a custom payload structure.
    - Implement a backend route `GET /api/scans/:id/runner-logs` (scoped to project viewer permissions) fetching logs for the specified scan.
    - Build a "Runner Logs" tab in the Active Scan and Scans History UI pages to view, search, and copy logs.

- [ ] **Task 118: User-Configured Scheduled Auto-Scans**
  - **Design Goal:** Allow users to schedule automatic vulnerability scans on their projects at custom intervals, restricted by billing plan limits (e.g. only available on the "Supporter Plan").
  - **Implementation Details:**
    - Add a `cron_schedule` field to `scan_configs` or create a new `scan_schedules` table in D1.
    - Implement a Cloudflare Workers Cron Trigger or coordinator scheduler loop to fetch pending schedules, verify the user's plan is "Supporter Plan", and trigger active fuzzer runs.
    - Add a "Schedule Scan" configuration panel in the project settings web UI supporting standard cron/interval selections.

- [ ] **Task 120: Project-Level E2EE Key Backup & Recovery (Backup File + Seed Phrase)**
  - **Design Goal:** Support exporting and importing the Project X25519 private key in Project Settings via a downloaded backup file (`.swazzkey`) or a 12-word mnemonic seed phrase, enabling seamless device migration and collaboration without losing access to historical encrypted reports. Includes a link in the UI to the [Key Backup & Recovery guide](./docs/encryption_backup.md).
  - **Implementation Details:**
    - Build UI buttons in Project Settings to download the private key as a `.swazzkey` file (JSON JWK format) or reveal a 12-word mnemonic seed phrase.
    - Implement import/recovery fields in the project initialization UI flow to allow users to enter a seed phrase or upload a `.swazzkey` file to restore the private key to local IndexedDB (`KeyStorage`).
    - Derive the X25519 private key from the mnemonic seed phrase using PBKDF2/scrypt client-side derivation.


