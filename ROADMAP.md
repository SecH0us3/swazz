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

- [ ] **Task 108: Auto-Hide Side Panels in Settings Views**
  - **Design Goal:** Automatically hide/collapse the left and right navigation/configuration panels when navigating to project or user settings to optimize screen real estate for settings forms.
  - **Implementation Details:**
    - Detect routing/view transition to Project Settings or User Settings tabs.
    - Automatically trigger states to collapse both the left sidebar and the right configuration panel.
    - Ensure the panels are restored or can be reopened when navigating away from the settings views.


## 🟡 Medium Complexity

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

- [ ] **Task 121: Container Image Signing & Verification via Cosign**
  - **Design Goal:** Secure built runner agent container images against supply chain tampering by signing release images with Cosign.
  - **Implementation Details:**
    - Generate a key pair for image signing (`cosign generate-key-pair`).
    - Store the public verification key (`cosign.pub`) in the repository under a `keys/` directory and document image verification steps.
    - Save the private key as a GitHub Action Secret `COSIGN_PRIVATE_KEY` (along with its password secret).
    - Update the build & publish CI workflow to install Cosign and sign the built Docker images after pushing them to the registry.

- [ ] **Task 123: User Action Audit Trail Logging**
  - **Design Goal:** Maintain a secure and auditable history of important user actions within projects, tracking state-changing operations (non-GET requests) to meet compliance and governance needs.
  - **Implementation Details:**
    - Create a database table `audit_logs` (schema: `id, project_id, user_id, action, details, ip_address, timestamp`).
    - Implement a backend middleware or helper in Hono that intercepts non-GET requests (POST, PUT, PATCH, DELETE) to project-scoped endpoints.
    - Automatically log details of key actions (e.g. member additions/removals, role modifications, settings updates, scan executions) into the `audit_logs` table.
    - Expose an API endpoint `GET /api/projects/:id/audit-logs` (accessible only to owners/admins).
    - Design an "Audit Trail" tab in Project Settings to view, search, and export the logs.



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

- [ ] **Task 122: Enterprise SAML Authentication & Organizations**
  - **Design Goal:** Support SAML SSO for enterprise customers by introducing an Organizations layer to group projects and configure IdP authentication details.
  - **Implementation Details:**
    - Create database tables for `organizations`, `organization_members` (RBAC), and `organization_saml_configs`.
    - Group projects under organizations via `organization_id` field in `projects` table.
    - Implement a domain-based login redirect checking user email domains to route employees to their mapped SAML IdP.
    - Implement a lightweight SAML Assertion Consumer Service (ACS) endpoint verifying XML signatures against IdP certificates using the Workers Web Crypto API.
    - Build UI settings tabs in the dashboard for managing organization details, team memberships, and SAML configurations.





