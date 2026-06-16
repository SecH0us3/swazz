# 🚀 Swazz Task 51: Multi-User Auth, Cloudflare Runs & Custom Runners

This document compiles the complete implementation plan, architectural design, database schemas, and step-by-step checklist for **Task 51**.

---

## 🏗 1. Unified Architecture Overview (TypeScript Edge API)

To maximize global performance and eliminate code duplication, the system uses a **Split-Brain Architecture optimized for the Edge**:

* **Frontend (`packages/web`):** The React dashboard. It always talks to the TypeScript API.
* **Unified API (`packages/edge`):** A single TypeScript API layer (Hono) that manages users, projects, configurations, and scan history.
  * **Cloud Mode:** Deployed as a stateless Cloudflare Worker running globally on all edge nodes for zero-latency database reads (using **Cloudflare D1** read replicas).
  * **Local Mode:** Run locally via Wrangler using a local `.sqlite` file.
* **Fuzzing Engine (`packages/container`):** The Go codebase is strictly a **"Headless Runner"** and CLI tool. It does *not* host an HTTP API server for the dashboard.
* **Runner Coordination:** A WebSocket server (backed by a single **Durable Object** in Cloudflare) coordinates real-time scan job dispatching to the headless Go runners.
* **Shared Runner Encryption:** To leverage public volunteer runners safely, scan results can be encrypted on the runner using the user's public key. Decryption happens locally in the browser.

---

## 💾 2. Cloudflare R2 & Presigned Uploads

During fuzzing runs, Swazz generates a massive volume of raw data. Storing this in D1 is highly discouraged because of size limits.

### How R2 is utilized:
* **Cloudflare D1 (Metadata):** Stores lightweight metadata: User profiles, projects, and scan run summaries.
* **Presigned URLs:** To prevent overloading the Cloudflare Worker coordinator with massive uploads, the Go runner requests a **Presigned Upload URL** from the coordinator. The runner then streams the packed scan results directly to R2.
* **Egress Cost:** Cloudflare R2 has **zero egress fees**, making it free to download large HTML reports from the dashboard.

---

## 🗄 3. Database Schema & Migration Strategy

### Primary Keys: ULID
All primary keys (`id TEXT`) MUST use **ULID** (Universally Unique Lexicographically Sortable Identifier). This allows native cursor-based pagination and sorting without heavy index scans.

### Schema Definition
```sql
-- 1. Users table (Optional when auth.enabled = false)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- ULID
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    public_key TEXT,
    retention_days INTEGER DEFAULT 90,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Scans/Jobs history
CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    profile TEXT NOT NULL,
    status TEXT NOT NULL,
    summary_stats TEXT,
    report_url TEXT,
    is_encrypted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

-- 4. Configuration Profiles
CREATE TABLE IF NOT EXISTS scan_configs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Registered Runners
CREATE TABLE IF NOT EXISTS runners (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    is_shared BOOLEAN DEFAULT 0,
    status TEXT NOT NULL,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 📋 4. Implementation Checklist & Phase Sequence

### 📦 Phase 1: Removing Go HTTP Server & Preparing Headless Runner
**Context:** We are abandoning the Go-based API. The Go codebase (`packages/container`) becomes a pure CLI tool and headless runner.
- [ ] **Delete Obsolete Code:** Remove the `packages/container/api/` directory entirely.
- [ ] **Refactor `main.go`:** Remove the `case "serve"` logic. Remove `github.com/gin-gonic/gin` to reduce binary size.
- [ ] **Add Agent Command:** Add `case "run-agent"` in `main.go`. This command must accept `--coordinator <ws-url>` and `--token <secret>`.
- [ ] **WebSocket Client:** Implement a WebSocket client in Go (`nhooyr.io/websocket`) to connect to the Edge API Durable Object.

### 🔓 Phase 2: Unified TypeScript API (Hono)
**Context:** The API layer is now built in `packages/edge` using Hono.
- [ ] **Framework Setup:** Initialize `hono` in `packages/edge/src/index.ts`. 
- [ ] **Configuration:** Bind D1 database and R2 bucket in `wrangler.toml`.
- [ ] **Database Migrations:** Add `.sql` schema definitions into `packages/edge/migrations/`.
- [ ] **Build Core Endpoints:** Implement REST endpoints for `GET /api/projects`, `POST /api/scans`.

### 🔐 Phase 3: Authentication & Workspace UI
- [ ] **Auth Endpoints:** Implement `/api/auth/register` and `/api/auth/login` in the Edge API. Use `oslo/password` or WASM bcrypt.
- [ ] **React API Client:** Update `packages/web/vite.config.ts` to proxy to the Wrangler dev server. Ensure HTTP-Only auth cookies are passed.

### 📡 Phase 4: Remote Runner Orchestration (Shared vs Private)
- [ ] **WebSocket Protocol:** Define JSON payloads for Runner ↔ Coordinator communication (`JobDispatch`, `JobProgress`, `JobComplete`).
- [ ] **Encryption Pipeline:** Implement client-side X25519 key generation in React.
- [ ] **SSRF Network Filter:** Implement a custom `DialContext` in the Go HTTP client to block RFC 1918 IPs.

### ☁️ Phase 5: Cloudflare Integrations (Durable Objects & Presigned URLs)
- [ ] **Durable Objects:** Implement `RunnerCoordinator implements DurableObject` in TypeScript. It will hold active WebSocket connections and broadcast events.
- [ ] **R2 Presigned URLs:** Implement `POST /api/scans/:id/upload-url` inside the Edge API (using `@aws-sdk/client-s3`) to sign a short-lived `PUT` URL for the runner.
### 📚 Phase 6: Documentation & Deployment Updates
- [ ] **Update Dockerfiles:** 
  - Update `packages/container/Dockerfile.cli` to document the new `run-agent` command and required environment variables (e.g., `COORDINATOR_URL`, `RUNNER_TOKEN`).
  - Update `packages/web/Dockerfile` (if necessary) to ensure the Node/Nginx setup points to the correct Edge API URL in production instead of expecting a local Go server.
- [ ] **Update Documentation (`docs/`):**
  - Update `docs/architecture.md` to explain the Unified TypeScript API and the headless nature of the Go runner.
  - Update `docs/usage.md` to reflect the removal of the `serve` command and the introduction of the `run-agent` command for custom runners.
  - Add a section in `docs/installation.md` about setting up the Cloudflare D1/R2 bindings and configuring `wrangler.toml` for self-hosting the Edge API.

---

## 🛡️ 5. Authentication Protection & Rate Limiting

To secure the user registration and login endpoints, a hybrid protection mechanism is utilized:

### 1. Bot & Spam Protection (Cloudflare Turnstile)
* **Client Side (React):** Integrate the Turnstile widget on the Login and Registration screens. Render the widget only when `auth.enabled` is `true`. Include the solved `cf-turnstile-response` token in the API request body.
* **Server Side (Go/Worker):** Validate the Turnstile response token by sending an HTTP POST verification request to `https://challenges.cloudflare.com/turnstile/v0/siteverify` using the configured site secret. Fail with `403 Forbidden` if validation fails.
* **Local Fallback:** Automatically bypass Turnstile validation if `auth.enabled` is `false` to keep local testing seamless.

### 2. Rate Limiting & Account Lockout
* **Network-Level (Cloudflare WAF):** Configure a custom Cloudflare WAF Rate Limiting rule on the path `/api/auth/*` (e.g., maximum 5–10 requests per minute per IP address) to block credential-stuffing bots and raw brute-force attacks at the edge.
* **Application-Level (Go/Worker Code):** Implement user-specific login throttling (e.g., temporarily lock a specific user account/email address in the database for 15 minutes after 5 consecutive failed login attempts) to protect against distributed brute-force attacks from multiple IP addresses.

---

## 🔒 6. Runner Security Constraints

When utilizing external or shared runners via `swazz-engine run-agent`, strict defense-in-depth measures must be implemented to prevent malicious use of the system:

### 1. SSRF Network Filter
To prevent a malicious user from dispatching a scan targeting internal networks or cloud provider metadata through a Volunteer/Shared runner:
* The Go HTTP client used by the fuzzer must override the `DialContext` to intercept all outbound DNS resolutions.
* Any target resolving to a private/reserved subnet (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`), or cloud metadata endpoints (`169.254.169.254`) **MUST BE BLOCKED** immediately.

### 2. Strict Container Enforcer
To limit the blast radius if a vulnerability exists in the Swazz engine itself, remote runners should not run directly on host OS environments.
* Upon startup, the `swazz-engine run-agent` command must verify its environment.
* It will check for the existence of `/.dockerenv` or container-specific cgroups. If these are missing, the agent will exit with a fatal error advising the user to run it via the official Docker image.
* This constraint is bypassed in local offline mode (`swazz-engine start`) to preserve local developer experience.

### 3. Secure Presigned URL Workflow (R2 Uploads)
Since fuzzing scans can take hours, generating a long-lived upload URL at the start of the job is a severe security risk. S3/R2 presigned URLs cannot easily be made "strictly single-use", so we rely on Just-In-Time (JIT) provisioning:
* **Just-in-Time Generation:** The runner must request the Presigned Upload URL from the Edge Coordinator *only* after the scan has fully completed, immediately prior to uploading the archive.
* **Short TTL:** The generated URL must have a strictly short expiration time (e.g., 10–15 minutes), providing just enough window to complete the data transfer.
* **Strict Constraints:** The URL must be locked to the `PUT` HTTP method (preventing `GET` access to read other reports) and hardcoded to the exact object key corresponding to the scan (`reports/<project_id>/<scan_id>.enc`).

