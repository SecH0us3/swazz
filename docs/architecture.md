---
title: Architecture
---

# Architecture & Internals 🧠

Swazz uses a modular **hybrid architecture** that separates the high-performance fuzzing engine from the user interface.

## Repository Structure

The project is structured into workspaces:

### 1. `packages/container` (Backend Engine)
Written in Go, this is the core of Swazz. It handles all heavy lifting, multi-threading, and networking.
- `main.go`: The main entrypoint. Handles commands for both CLI (`start`) and API (`serve`).
- `internal/generator/`: Contains logic for analyzing OpenAPI specs and generating smart payloads (e.g., UUIDs, strings, large boundaries). Static payloads are kept in `internal/generator/payloads/`.
- `internal/runner/`: The concurrent execution engine. Manages rate limits, parallel execution, and HTTP clients.
- `internal/output/`: Analyzes HTTP responses and outputs them into specific formats (SARIF, JSON).
- `api/`: Gin HTTP handlers that power the Web Dashboard's backend.

### 2. `packages/web` (Frontend UI)
A React 19 Single Page Application built with Vite.
- **Strict UI Separation**: Components in `src/components/` are kept "dumb" focusing only on layout. Complex application states are managed via hooks in `src/hooks/`.
- **Vanilla CSS**: We strictly use Vanilla CSS with CSS variables (`src/index.css`) rather than utility frameworks like Tailwind. This maintains a lean, unified design language with a premium dark-theme aesthetic.
- **Service Layer**: All external API calls to the Go backend are encapsulated in `src/services/` (e.g., `swaggerService.ts`).

### 3. `packages/edge` (Optional)
Reserved for Cloudflare Workers integration and edge-deployments. For a detailed study on optimizing edge deployment costs, latency, and performance using Cloudflare KV and Cache API, see the [Cloudflare KV & Cache API Optimization Research](./cloudflare_kv_cache_research.md). To monitor database queries for performance regressions, refer to the [D1 Slow Query Monitoring Guide](./slow_queries.md).

## Smart Fuzzing Workflow

1. **Parse**: The engine loads the OpenAPI JSON/YAML spec.
2. **Generate**: For each endpoint and parameter, the Generator creates standard requests and boundary/malicious requests based on the types (String, Int, UUID array, etc.).
3. **Execute**: The Runner executes these requests concurrently against the target API.
4. **Analyze**: The response analyzer checks for unexpected status codes (e.g., 500 Internal Server Error) or data leaks, reporting them back via the CLI or live via SSE to the React Dashboard.

## OpenAPI Safety Limits & OOM Protection

To protect the fuzzing runner from excessive memory usage (OOM) on very large, dense, or cyclic OpenAPI specifications, Swazz implements the following schema resolution safety mechanisms:

- **DAG-based Resolution & Memoization**: Each schema reference (`$ref`) is resolved exactly once per root schema and cached. Subsequent encounters of the same reference reuse the cached resolved representation. This transforms an exponential-size resolution tree into a linear-size Directed Acyclic Graph (DAG).
- **Cycle Detection**: Active traversal paths track references on the recursion stack to break cycles safely. Circular references return a fallback `object` schema representation to prevent infinite recursion.
- **Node Budget**: A safety limit of **50,000 SchemaProperty nodes** is enforced during resolution. If exceeded, schema expansion is safely truncated, and a `WARN` log is emitted specifying the endpoint context where the truncation occurred.
- **Depth Limit**: Recursion is limited to a maximum depth of **64**. If exceeded, the schema resolves to a fallback `object`.

## Security & Threat Model 🛡️

For a comprehensive analysis of Swazz's security controls, network isolation mechanisms (including SSRF protection and DNS pinning), agent cryptographic challenge-response authentication, and user access policies, please refer to the [Security Review & Threat Model](./security_review.md).

## CSRF Protection Strategy

Swazz implements a double-submit cookie validation pattern to protect all state-changing endpoints (`POST`, `PUT`, `DELETE`, `PATCH`) under `/api/*` on the coordinator edge server:
- **Token Generation**: On every safe request (`GET`), a cryptographically secure random token (UUID) is generated if not already present in the `csrf_token` cookie. The cookie is marked as `HttpOnly`, `SameSite=Lax`, and `Secure` (when running over HTTPS or localhost).
- **Double-Submit Validation**: The token is copied to the `X-CSRF-Token` response header on safe requests. The frontend reads and stores this token in memory (Zustand state). For all state-changing requests, the client must attach the token in the `X-CSRF-Token` request header.
- **Bypass Patterns**:
  - Safe methods (`GET`, `HEAD`, `OPTIONS`) bypass CSRF validation.
  - Requests authenticated via custom headers, such as `Authorization: Bearer <token>` (the primary auth flow for runners and CLI clients) or `X-Upload-Token` (used by runners for report uploads), bypass CSRF validation since cross-site requests cannot set custom headers.

[← Back to Usage](./usage.md)

---

## Audit Trail System

Swazz maintains an immutable, per-project audit log of all state-changing operations to support compliance and governance requirements.

### Table Schema (`audit_logs`)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (ULID) | Primary key |
| `project_id` | TEXT | FK → `projects.id` (ON DELETE CASCADE) |
| `user_id` | TEXT (nullable) | Actor's user ID — no FK cascade, survives user deletion |
| `actor_username` | TEXT | Snapshot of username at time of action |
| `actor_role` | TEXT | Snapshot of role at time of action |
| `action` | TEXT | RBAC permission key, e.g. `patch:/api/projects/:id` |
| `action_label` | TEXT | Human-readable label, e.g. `Updated project settings` |
| `source` | TEXT | `web` \| `api_key` \| `mcp` |
| `ip_address` | TEXT | Caller's IP address |
| `timestamp` | DATETIME | UTC, auto-set |

### Source Detection

| Value | Detection logic |
|---|---|
| `mcp` | Request path starts with `/api/mcp` OR `X-MCP-Client` header is present |
| `api_key` | Bearer token starts with `swazz_live_` |
| `web` | All other authenticated requests (JWT session) |

### Logged Actions

All project-scoped mutating routes are automatically instrumented via the `auditLog()` Hono middleware:

- Project settings updated / deleted
- Scan configuration saved
- Scan schedule updated
- Scan launched
- Member invited / removed / role updated
- Custom role created / updated / deleted

### RBAC Access

The `get:/api/projects/:id/audit-logs` permission is granted to **owner** and **editor** roles only. Viewers cannot access audit data.

### User Deletion Resilience

`actor_username` is denormalised (snapshotted at write time) into every audit row. The `user_id` column has no `ON DELETE CASCADE` constraint. This ensures audit history remains intact and human-readable even after a user account is deleted — deleted actors are displayed as `[deleted user]` in the UI.

### Export

The Audit Trail UI tab supports CSV export of filtered results via a client-side `Blob` download, preserving all active filters (search query, source type) at export time.

