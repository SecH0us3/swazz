---
layout: default
title: Security Review
---

# Swazz Security Review & Threat Model 🛡️

This document provides a comprehensive security review and threat model of the Swazz Smart API Fuzzer. It details the trust boundaries, cryptographic protocols, mitigations against Server-Side Request Forgery (SSRF), agent authentication flows, and schema resolution safety measures.

---

## 1. System Architecture & Trust Boundaries

Swazz operates as a hybrid architecture divided into three main components:
1. **Web Dashboard (`packages/web`)**: The React-based frontend browser client.
2. **Edge Coordinator (`packages/edge`)**: A Cloudflare Hono Worker and Durable Object proxying commands, orchestrating runners, caching Swagger documents in Cloudflare R2, and storing metadata in SQLite D1.
3. **Go Runner Agent (`packages/container`)**: A high-performance execution engine running locally (CLI) or as a background service connected to the Edge Coordinator via WebSockets.

### High-Level System Architecture & Component Interaction

```mermaid
graph TD
    %% Define components
    subgraph UI ["Client Tier (packages/web)"]
        Dashboard["Dashboard UI"]
        Inspector["Request Inspector"]
    end

    subgraph Edge ["Edge Coordinator (packages/edge)"]
        Worker["Hono API Worker (index.ts)"]
        DO["Durable Object (Coordinator.ts)"]
        D1[("SQLite D1 Database")]
        R2[("R2 Object Storage")]
    end

    subgraph Runner ["Execution Tier (packages/container)"]
        Agent["Go Agent (agent.go)"]
        Fuzzer["Fuzzing Engine (runner.go)"]
    end

    Target["Target Server API"]

    %% Define connections and flows
    Dashboard -- "HTTPS /api" --> Worker
    Worker -- "Durable Object Binding" --> DO
    DO -- "1. Read/Write Metadata" --> D1
    DO -- "2. Cache specs (Parsed & Raw)" --> R2
    
    Agent -- "3. Secure WebSockets (WSS)" --> DO
    DO -- "4. Dispatch jobs / send cancel" --> Agent
    Agent --> Fuzzer
    Fuzzer -- "5. Smart Payload Fuzzing" --> Target
    Fuzzer -- "6. Real-time Results (WSS)" --> DO
    DO -- "7. WebSocket Event Stream" --> Dashboard
```

### Trust Levels & Boundaries
- **User Dashboard to Edge API (HTTP/TLS)**: Users authenticate via username/password or token. Once authenticated, users can manage projects and trigger scans. Data access is restricted using row-level ownership checks (e.g. project/scan membership).
- **Go Runner Agent to Edge Coordinator (WSS/TLS)**: The agent executes in a potentially untrusted environment (e.g., local developer machines or shared runner networks). It must authenticate before being permitted to receive jobs or upload spec parses.
- **Go Runner Agent to Target API (HTTP/S)**: The fuzzer issues massive quantities of highly mutated and potentially malicious payloads. This outbound execution line is heavily guarded to prevent exploitation of the runner's own network.

---

## 2. Server-Side Request Forgery (SSRF) Protection

Because Swazz fetches OpenAPI specifications from user-supplied URLs and issues HTTP fuzzing requests to target systems, it is a high-value target for SSRF attacks. An attacker could register a target or supply a Swagger specification URL pointing to internal hosts (e.g., `http://localhost:8080/admin` or cloud metadata services like `http://169.254.169.254/latest/meta-data/`).

Swazz implements a **dual-layer SSRF mitigation engine** with DNS pinning to block these attacks.

### SSRF Protection Layers
1. **Cloud Agent Mode (`packages/container/internal/safenet/safenet.go`)**: 
   When running in cloud/agent mode, outbound connections to private, loopback, link-local, and unspecified addresses are blocked by default. 
   - Blocked CIDRs include: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918), `127.0.0.0/8` (Loopback), `169.254.0.0/16` (Link-local/Cloud Metadata), `::1/128` (IPv6 Loopback), `fe80::/10` (IPv6 Link-local), and `0.0.0.0/8` / `::/128` (Unspecified).
   - This check is bypassable for local debug setups only if `AllowLocalNetwork` is explicitly configured.
2. **Local CLI Mode (`packages/container/internal/security/ssrf.go`)**:
   Provides custom SSRF protection wrapping the standard Go transport. By default, it restricts access to private IPs unless `--allow-private-ips` is passed (defaulting to `false` in production environments, and configured via the `SWAZZ_ALLOW_PRIVATE_IPS` environment variable).

### DNS Rebinding & Pinning Flow
To prevent Time-of-Check to Time-of-Use (TOCTOU) DNS rebinding attacks (where a DNS entry resolves to a public IP during verification but returns a private IP during connection execution), Swazz handles resolution and dial routing explicitly:

```mermaid
sequenceDiagram
    autonumber
    participant R as Fuzz Runner
    participant DNS as DNS Resolver
    participant SSRF as SSRF Validator (safenet/ssrf)
    participant Target as Target Host (Resolved IP)

    R->>DNS: Resolve Hostname (e.g. evil.com)
    DNS-->>R: Return IP addresses (e.g. [1.2.3.4, 127.0.0.1])
    R->>SSRF: Validate IP list
    note over SSRF: Check all resolved IPs against blocked CIDR list
    alt Any IP in blocked range (e.g. 127.0.0.1)
        SSRF-->>R: Block Request (SSRF policy error)
    else All IPs safe (e.g. only [1.2.3.4])
        SSRF-->>R: Proceed with safe IP list
        R->>Target: Dial safe IP directly (Pin connection to 1.2.3.4)
        Target-->>R: Return HTTP Response
    end
```

---

## 3. Agent-to-Coordinator Security & Authentication

Shared agents connect to the Cloudflare Durable Object coordinator to accept scan jobs. To prevent rogue runners from hijacking work, stealing user configurations, or injecting false reports, Swazz supports **Ed25519 Cryptographic Challenge-Response Authentication**.

### Challenge-Response Flow

```mermaid
sequenceDiagram
    autonumber
    participant A as Go Agent (agent.go)
    participant C as Hono Router (runners.ts)
    participant DO as Durable Object (Coordinator.ts)
    participant DB as SQLite D1 Database

    A->>C: Connect WS with X-Runner-Public-Key header
    C->>DB: Check if user exists with public_key
    DB-->>C: User Record (Valid)
    C->>DO: Forward WebSocket Connection
    note over DO: Set state to runner-pending
    DO->>DO: Generate cryptographically secure 32-byte nonce
    DO-->>A: WS Challenge Message { type: "challenge", nonce }
    note over A: Sign nonce using private key (Ed25519)
    A-->>DO: WS Challenge Response { signature: "<hex_sig>" }
    DO->>DO: Verify signature using SubtleCrypto Web API
    alt Signature is Valid
        DO->>DO: Promote state to runner (Active)
        DO-->>A: WS Authentication Successful { type: "auth_ok" }
    else Signature is Invalid
        DO-->>A: WS Authentication Failed
        DO->>DO: Terminate Socket Connection
    end
```

### Safety Features
- **Key Generation**: Agents generate keypairs via cryptographically secure randomness (`ed25519.GenerateKey(nil)` utilizing `crypto/rand`).
- **Auth Timeout**: The coordinator enforces a strict **5-second timeout** on pending handshakes. If challenge verification is not completed within 5 seconds, the WebSocket is forcefully closed to mitigate resource exhaustion attacks.

---

## 4. User Session & Identity Management

Authentication and session controls on the Web platform enforce the following security parameters:

- **Password Hashing**: Done via **PBKDF2 with SHA-256** using 100,000 iterations and a unique salt. The hashing and verification are performed on the server side using the Cloudflare WebCrypto API.
- **JWT Authentication**: Users receive a JSON Web Token (JWT) upon successful login, signed with a secure asymmetric key or environmental secret.
- **Failed Login Rate Limiting**:
  - Keeps track of failed login attempts by username and IP address.
  - Automatically locks out login capability for a user/IP after **5 failed attempts** for a duration of **15 minutes**.
- **Turnstile Verification**: The login and register pages validate a Cloudflare Turnstile token to deter bots and automated brute-force attacks.
- **Data Isolation**: Database queries validating project updates, scan retrievals, and deletions verify project membership using `checkProjectMembership` or scan membership using `checkScanMembership`.

### JWT/Key Authentication Sequences

```mermaid
sequenceDiagram
    autonumber
    actor User as Web/API Client
    participant Worker as Hono API Worker (index.ts)
    participant DB as SQLite D1 Database

    %% Session Login
    Note over User, Worker: Option A: Login with Credentials
    User->>Worker: POST /api/auth/login (username, password)
    Worker->>DB: Query user by username
    DB-->>Worker: Return stored hash (PBKDF2)
    Worker->>Worker: Verify password (timingSafeEqual)
    alt Password Valid
        Worker->>Worker: Sign JWT token (HS256 with JWT_SECRET)
        Worker-->>User: Return JWT token
    else Password Invalid
        Worker-->>User: 401 Unauthorized
    end

    %% Session Request
    Note over User, Worker: Option B: Authenticating API Requests
    User->>Worker: GET /api/projects (Authorization: Bearer <token>)
    alt Token starts with swazz_live_
        Worker->>DB: Query user by api_key
        DB-->>Worker: Return User Record
    else Standard JWT
        Worker->>Worker: Verify JWT signature (HS256 using JWT_SECRET)
    end
    alt Auth Valid
        Worker-->>User: Proceed (200 OK with Data)
    else Auth Invalid
        Worker-->>User: 401 Unauthorized
    end
```

---

## 5. D1 Database & R2 Storage Caching Data Flow

To optimize performance and minimize remote runner overhead, the Edge Coordinator utilizes Cloudflare D1 for metadata indexing and Cloudflare R2 for storing schema documents.

### Cache Lookup and Write Sequences

```mermaid
sequenceDiagram
    autonumber
    participant UI as Dashboard UI
    participant Worker as Hono API Worker
    participant DO as Durable Object Coordinator
    participant DB as SQLite D1 Database
    participant R2 as R2 Object Storage
    participant Agent as Go Runner Agent

    UI->>Worker: POST /api/runs (Swagger Spec URL / Config)
    Worker->>DB: Insert scan record (status: 'pending')
    Worker->>DO: Dispatch run job (runId, url, userPublicKey)
    
    %% Cache Check
    DO->>DB: SELECT base_path, endpoints_r2_key FROM swagger_cache WHERE url = ?
    alt Cache Hit
        DB-->>DO: Return cache records (base_path, endpoints_r2_key)
        DO->>R2: GET key (endpoints_r2_key)
        R2-->>DO: Return cached endpoints (JSON)
        DO->>Agent: Dispatch job with config & endpoints
    else Cache Miss
        DB-->>DO: Return NULL
        DO->>Agent: Request endpoints parsing: parse_swagger(url, reqId)
        Agent->>Agent: Fetch & Parse OpenAPI spec
        Agent-->>DO: WS message: parse_result { reqId, base_path, endpoints, raw_swagger }
        DO->>R2: PUT raw_swagger & endpoints JSON
        R2-->>DO: Return storage keys
        DO->>DB: INSERT INTO swagger_cache (url, base_path, endpoints_r2_key, fetched_at)
        DO->>Agent: Dispatch job with config & endpoints
    end
```

---

## 6. WebSocket / SSE Streaming Sequence

Real-time scanning feedback and vulnerability discoveries are reported immediately to the front-end dashboard using persistent streaming channels.

```mermaid
sequenceDiagram
    autonumber
    actor UI as Dashboard UI
    participant Worker as Hono API Worker
    participant DO as Durable Object Coordinator
    participant Agent as Go Runner Agent
    participant DB as SQLite D1 Database

    %% Establish Streams
    UI->>Worker: WS Connection: /api/runs/:id/events
    Worker->>DO: Forward WebSocket client connection
    note over DO: Register client WebSocket in active client set for runId

    Agent->>DO: WS Connection: /connect-runner (Authenticated)
    note over DO: Register runner WebSocket in active runners set

    %% Streaming Fuzzing Events
    Agent->>DO: WS message: event { type: "event", runId, data: { status: "fuzzing", endpoint, payload } }
    DO->>UI: Broadcast WS message: event { type: "event", runId, data }
    
    %% Streaming Findings
    Agent->>DO: WS message: event { type: "finding", runId, data: { vulnerability, severity, path } }
    DO->>DB: INSERT INTO findings (scan_id, type, severity, path)
    DO->>UI: Broadcast WS message: event { type: "finding", runId, data }
```

---

## 7. OpenAPI Schema Processing Safety (OOM & ReDoS Mitigation)

Large, complex, or circular OpenAPI specifications can crash parsing tools via memory exhaustion (OOM) or stack overflows. Swazz protects its engine with the following limits:

- **DAG-based Resolution & Memoization**: References (`$ref`) are resolved and cached, transforming potential exponential-tree expansion into a Directed Acyclic Graph (DAG) with linear memory complexity.
- **Cycle Detection**: Active resolution paths are tracked on a recursion stack. Recursive loops are broken immediately, returning a fallback representation.
- **Node Budget**: Enforces a strict budget of **50,000 SchemaProperty nodes** per schema. Traversal is truncated if the budget is exceeded, saving the scanner from memory exhaustion.
- **Recursion Depth Limit**: A strict depth ceiling of **64** is enforced during schema expansion.

---

## 8. Supply Chain Security

To protect the Swazz project against supply chain compromises, the build and pipeline actions conform to strict configurations:

- **Pinned Actions & Base Images**: All GitHub Actions configurations and Dockerfiles pin dependencies and base images to specific, immutable SHA-256 commit hashes (rather than mutable version tags like `latest` or `v1`).
- **Dependency Audit**: The build process runs automated static code analysis (`gosec` for Go backend, npm security audit for frontend) to discover code and dependency vulnerabilities.
- **Excluded Rules**: The `.gosec.conf` excludes `G404` (use of weak random numbers). Since Swazz is a fuzzer, utilizing fast pseudo-random values (via `math/rand`) is required for payload variation speed. Cryptographically sensitive operations (challenge signatures, cryptographic nonces, etc.) bypass `math/rand` in favor of standard secure libraries (`crypto/rand`).
