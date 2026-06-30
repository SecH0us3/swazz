---
layout: default
title: Cloudflare KV & Cache Research
---

# Cloudflare KV & Cache API Optimization Research ⚡️

This document presents a technical analysis of integrating **Cloudflare KV** and the **Cache API** into the Swazz Edge Coordinator architecture. The goal is to optimize latency, offload read transactions from the D1 Database and Durable Objects (DO), and minimize Cloudflare billing costs.

---

## 1. Architectural Baseline & Problem Statement

Currently, the Swazz Edge Coordinator (`packages/edge`) utilizes:
1. **D1 (SQLite at the Edge)**: For persistent metadata storage (users, projects, scans, ignored rules).
2. **Durable Objects (DO - `RunnerCoordinator`)**: For stateful, strongly-consistent coordination of active WebSocket runner connections, live scan sessions, and WebSocket message routing.
3. **R2 (Object Storage)**: For storing raw and parsed Swagger/OpenAPI schemas and fuzz reports.

### Challenges:
* **Centralization**: Durable Objects reside in a single coordinator isolate region (typically closest to the first client connection), introducing latency overhead for global users.
* **D1 Transaction Load**: Read operations (e.g., verifying user session tokens or API keys on every API call) execute database queries, which increases D1 read-unit consumption and limits global throughput.
* **DO Active-Class Pricing**: Durable Objects incur billing costs per active-class hour ($12.50 per million active GB-seconds). Keeping DOs active solely to track runner status or rate limits is cost-inefficient.

---

## 2. Technical Comparison Matrix

| Storage Primitive | Consistency Model | Read Latency (Global) | Write Latency | Cost Profile | Storage Lifespan | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Workers Memory (Isolate Cache)** | Ephemeral / Non-replicated | < 1 ms (Local) | < 1 ms (Local) | Free | Minutes (Isolate lifecycle) | High-frequency rate limit sliding windows, local memoization. |
| **Cache API** | Ephemeral / Region-bound | 10–30 ms (Regional CDN) | < 10 ms (via cache.put) | Free | Hours/Days (Evicts on cold start) | Parsed spec files, static payload dictionaries, public R2 assets. |
| **Cloudflare KV** | Eventual Consistency (up to 60s) | 10–15 ms (Edge Cache) | 1–2 seconds | $0.50/M reads<br/>$5.00/M writes | Persistent | API key authorization lists, global session blacklists, feature flags. |
| **Durable Objects (DO)** | Strong Consistency (Single-leader) | 50–200 ms (Centralized) | 50–200 ms | $12.50/M GB-s | Persistent | Stateful WebSocket routing, active scan run orchestration. |
| **D1 Database** | Strong Consistency (Primary-replica) | 50–300 ms | 100–500 ms | $0.001/10K reads<br/>$0.01/10K writes | Persistent | Core transactional metadata (users, settings, historical runs). |

---

## 3. Analysis of Optimization Use Cases

### A. Global API Rate Limiting
* **Current State**: Handled in-memory inside the Durable Object.
* **KV Evaluation**: Storing rate limit counters in KV is a known anti-pattern. KV has a write rate limit of **1,000 writes/second per namespace**. High-frequency API calls would saturate KV write buffers, leading to replication delays and eventual rate-limit bypass.
* **Recommendation**: Implement a **hybrid sliding-window rate limiter**:
  1. Use **Workers local memory** for local, ultra-fast isolate-level rate checks.
  2. Use **Workers KV** (with a short TTL) to store blocklists of banned IPs/tokens globally.
  3. Fall back to **KV** only for global, persistent blacklists of bad actors.

### B. Scan Fuzzer Payload Catalog Caching
* **Current State**: Go runner agents download default wordlists and payload catalogs directly from the Coordinator, which reads them from R2 or static builds.
* **Cache API Evaluation**: Highly optimal. Payload catalogs and static wordlists (e.g. XSS dictionaries) are completely static.
* **Implementation Plan**:
  * Serve payload files via `/api/wordlists/*` endpoints.
  * Apply `Cache-Control: public, max-age=604800` headers.
  * Use Cloudflare's `caches.default` to cache responses regionally at edge POPs (note that the Cache API requires a custom domain and is not active on default workers.dev subdomains).
  * **Result**: Zero cost on R2 download operations, reducing fuzzer boot time from seconds to milliseconds.

### C. Global Session Blacklists & API Key Verification
* **Current State**: On every request, `packages/edge/src/routes/*` queries the D1 database to verify JWT tokens and CLI API keys.
* **KV Evaluation**: Exceptional fit. Revocation and API key generation are write-light (once per login/revocation) and read-heavy (every API request).
* **Implementation Plan**:
  * Upon API key generation or user login, store the key/session metadata in KV (`key: session:<token_id>`, `val: { userId, expired }`).
  * On logout/revocation, write to KV with a TTL matching the token lifespan.
  * Workers inspect KV first. To prevent cache-miss storms from invalid tokens, cache both active sessions and explicit revocation/invalid states in KV, querying D1 only on a complete cache miss.
  * **Result**: Reduces D1 database read transaction costs by **~90%** and cuts API request latency from 150ms to ~15ms.

### D. Runner Heartbeat Tracking (KV vs. DO)
* **Goal**: Research using KV to keep track of active runner heartbeat state to avoid Durable Object lookups.
* **Durable Object Approach**:
  * Runners maintain stateful WebSockets connected directly to the DO.
  * Runner list queries read state directly from the DO memory (instant, real-time, zero additional cost).
* **KV Alternative**:
  * Runners write periodic heartbeat timestamps (e.g., every 5 seconds) to a KV namespace.
  * Edge workers read KV to determine which runners are active.
* **Trade-Off Analysis**:
  * **Cost**: If 10 private runners write heartbeats every 5 seconds, that translates to:

    $$\frac{10 \text{ runners} \times 12 \text{ heartbeats/min} \times 60 \text{ min} \times 24 \text{ hours} \times 30 \text{ days}}{1,000,000} \approx 5.18 \text{ million KV writes/month}$$

    At $\$5.00$ per million KV writes, this costs **$\$25.90\text{/month}$** just for idle heartbeats.
  * **Consistency**: KV's eventual consistency (up to 60s replication delay) means the dashboard will display stale runner statuses (e.g., indicating a runner is connected when it has crashed, or vice versa).
* **Conclusion**: Storing heartbeats in KV is **inefficient** and **costly**. Stateful WebSocket connections are naturally handled in the memory of the Durable Object coordinator, which remains the most real-time and cost-effective approach for runner tracking.

---

## 4. Proposed Architectural Design

```
                     +---------------------------------------+
                     |         React Client / CLI            |
                     +---------------------------------------+
                                   |         |
                  [Cached assets]  |         |  [API Requests]
                                   v         v
                     +---------------------------------------+
                     |         Cloudflare Edge Worker        |
                     +---------------------------------------+
                      /            |             \           \
       [API Key check]             |             |            \ [Cached Spec/Wordlist]
      [Session active?]            |             |             \
            v                      v             v              v
     +--------------+      +--------------+  +--------+   +-----------+
     |  Global KV   |      | Coordinator  |  |   D1   |   | Cache API |
     |  (Fast Read) |      | (Durable Obj)|  |Database|   |  (Regional|
     +--------------+      +--------------+  +--------+   |    CDN)   |
                           | Active WS    |               +-----------+
                           | Connections  |
                           +--------------+
```

---

## 5. Next Steps & Recommendations
1. **Enable Session and API Key Caching in KV** *(Implemented in Task 96)*:
   * Migrated API token lookup from direct D1 reads to KV read-through caching with positive/negative cache entries and cache invalidation on key regeneration.
2. **Leverage Cache API for Static Assets**:
   * Route `/api/wordlists` through the Cache API with edge caching enabled.
3. **Retain Durable Objects for WebSocket Stateful Connections**:
   * Keep runner connection state and WebSocket routing inside the global Coordinator DO, as the KV heartbeat alternative is too costly and slow.
