# D1 Database Sharding Strategy & Forward-Compatibility

This document outlines the design decisions and architectural approach for scaling the Swazz database beyond Cloudflare's D1 10 GB per-database limit using manual vertical sharding.

---

## 1. Goal

As a high-performance API fuzzer, Swazz writes a significant volume of scan logs, findings, and events. To prevent database space exhaustion and database lockups as the platform grows, we must design for vertical sharding. 

The system operates with a single D1 database today, but the codebase has been structured with a database lookup helper to support future database bindings seamlessly.

---

## 2. Helper abstraction: `getDB`

All query preparation and execution sites inside the Cloudflare edge coordinator must pass through the `getDB` helper instead of directly accessing `env.DB`.

```typescript
import { getDB } from './utils/db';

// Example query
const user = await getDB(c.env).prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
```

The helper signature is defined as:
```typescript
export function getDB(env: Env, shardId?: number): D1Database;
```

Today, `getDB` always resolves to `env.DB`. Tomorrow, it will read `shardId` (or derive it from context) to return `env.DB_SHARD_1`, `env.DB_SHARD_2`, etc.

---

## 3. Explored Routing Strategies

We evaluated three potential database routing strategies for future sharding expansion:

### Option A: UUIDv8 Shard-Tagged IDs (Deferred / Potential)
* **Concept**: Encode the shard ID directly into the first nibble/byte of newly generated IDs (e.g. `shard_id | random_bits`).
* **Pros**: Zero extra database or KV lookups at query time. The coordinator extracts the shard ID from the entity ID (such as `project_id` or `scan_id`) and routes directly to the correct database binding.
* **Cons**: Non-standard UUID parsing in Go/Node and potential collision risks.

### Option B: Metadata Lookup Table (Chosen Option for Future)
* **Concept**: Maintain a routing map (e.g., `project_id -> shard_id`) inside Cloudflare KV or a primary Metadata D1 database.
* **Pros**: Simple, uses standard UUIDv4 everywhere, decoupled from ID generation.
* **Cons**: Slight lookup overhead (mitigated by caching in Cloudflare KV / local memory).

### Option C: Tenant-Based Sharding
* **Concept**: Shard all tables by user/organization owner. All projects, scans, and findings for a given tenant reside on the same database shard.
* **Pros**: Simplifies cross-entity SQL `JOIN` operations (e.g. joining `scans` and `scan_events` inside a single project).
* **Cons**: High skew risk if a single enterprise tenant grows exceptionally large.

---

## 4. Current Path Forward

1. **Standard UUIDv4**: We continue to generate standard UUIDs for all rows.
2. **Unified Helper Access**: All API routes, queue consumers, and DO coordinators must call `getDB(env, shardId?)`.
3. **Database Shard Routing**: When sharding is activated, `getDB` will resolve the `shardId` mapping and route queries to the correct Cloudflare D1 binding.
