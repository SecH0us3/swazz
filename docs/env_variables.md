# Environment Variables & Bindings Reference ⚙️

This page provides a complete reference of the environment variables, secrets, and Cloudflare Worker bindings used across the Swazz architecture.

---

## 🏛 Edge Coordinator (Cloudflare Workers)

These configurations apply to the Edge Coordinator service located in `packages/edge`. They are configured in `wrangler.toml` or bound via the Cloudflare dashboard as secrets.

### 1. Resource Bindings

| Binding Name | Type | Description |
| :--- | :--- | :--- |
| **`DB`** | D1 Database | The primary SQLite database binding (`swazz_db`) for core relational state. |
| **`STORAGE`** | R2 Bucket | Object storage bucket (`swazz-reports`) containing raw OpenAPI specs and encrypted reports. |
| **`SESSION_CACHE`** | KV Namespace | Eventual-consistency KV storage for fast token and API key lookups. |
| **`COORDINATOR_DO`** | Durable Object | Stateful `RunnerCoordinator` DO binding managing runner WebSockets and live scan sessions. |
| **`SCAN_QUEUE`** | Cloudflare Queue | Queue producer/consumer for distributing fuzzer payloads. |
| **`FINDINGS_QUEUE`** | Cloudflare Queue | Queue producer/consumer for buffering fuzzer vulnerabilities back to D1. |

### 2. Secrets (Environment Variables)

*Configure these in production using `wrangler secret put <NAME>` or via the Cloudflare Dashboard.*

| Variable Name | Description | Default / Example |
| :--- | :--- | :--- |
| **`JWT_SECRET`** | Secret key for signing and validating session JSON Web Tokens. | *Secret string* (Dev: `test-secret`) |
| **`TURNSTILE_SECRET_KEY`** | Secret key used for validating Cloudflare Turnstile CAPTCHA responses. | *Secret string* |

### 3. Config Vars (Environment Variables)

*Configure these in the `[vars]` block of `wrangler.toml`.*

| Variable Name | Description | Default / Example |
| :--- | :--- | :--- |
| **`AUTH_ENABLED`** | Enables user registration and token authentication checks. | `"true"` (Set to `"false"` in local dev) |
| **`LIMIT_ANONYMOUS`** | Restricts unauthenticated/guest capabilities. | `"true"` |
| **`ALLOWED_ORIGINS`** | CORS allowed origins list. | `"*"` |
| **`TURNSTILE_SITE_KEY`** | Public site key for Cloudflare Turnstile CAPTCHA. | `0x4AAAAAAD...` |
| **`VERSION`** | Deployed Edge Worker version. | `"1.0.0"` |

---

## 🐳 Go Runner Agent & CLI

These environment variables are read by the fuzzer agent engine (`packages/container`).

| Variable Name | Description | Allowed Values / Example |
| :--- | :--- | :--- |
| **`SWAZZ_AGENT_TOKEN`** | Cryptographic token for agent authorization on the Edge Coordinator. | *Hex/Base64 Token* |
| **`SWAZZ_LOG_LEVEL`** | Verbosity threshold for fuzzer engine logging. | `debug`, `info`, `warn`, `error` (Default: `info`) |
| **`SWAZZ_LOG_FORMAT`** | Format of log messages output to stdout/stderr. | `text`, `json` (Default: `text`) |
| **`SWAZZ_DEV`** | Bypass local URL/SSRF blocks (enables scanning `localhost`). | `1` (Bypasses check), `0` (Enforced default) |
| **`CLOUDFLARE_APPLICATION_ID`** | Optional Cloudflare Access client ID header injection. | *Header string* |
