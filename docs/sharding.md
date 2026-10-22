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

---

## 5. The coordinator Durable Object {#coordinator}

The database is not the only single instance: there is one coordinator Durable Object (`RunnerCoordinator`, named `global-coordinator`) for the whole deployment. Everything live goes through it:

* runner agents' WebSocket connections and the runner registry (`StateManager`);
* scan dispatch from the scan queue, and the resume and delivery bookkeeping of running scans;
* dashboard event streams, MCP SSE sessions and OOB callbacks;
* spec parse requests forwarded to runners;
* the stalled-scan watchdog, runner restarts and user revocation.

A Durable Object runs single-threaded (requests interleave only at `await`s), so this one object bounds how many runners, streams and dispatches the platform can serve, and it is a single point of failure for all of them.

### Helper abstraction: `coordinatorStub`

As with `getDB`, every caller reaches the coordinator through one helper, and a test (`test/unit/utils/coordinator.test.ts`) fails if any other source file under `packages/edge/src` names the `COORDINATOR_DO` binding:

```typescript
import { coordinatorStub } from './utils/coordinator';

const res = await coordinatorStub(env).fetch(new Request('http://do/runners'));
```

Today it always resolves to `global-coordinator`. Sharding gives it a key.

### Sharding plan

**Key: the owner of the runners.** A scan only ever runs on its project owner's runners (`getProjectOwnerForScan`), so one coordinator per owner (`owner:<userId>`) keeps a scan, its runners and its viewers in one object, with no cross-object messaging on the hot path.

| Entry point | How it finds its shard |
| --- | --- |
| Runner connect | The owner of the runner's token or key |
| Scan dispatch (queue consumer) | The scan's project owner |
| Dashboard stream, scan controls | The scan's project owner, after the access check that already runs |
| MCP session | The SSE stream (`/api/mcp/sse`) and the messages posted to it (`/api/mcp/message`) must land in the same object, so the shard key goes into the `connectionId` the stream hands out. Tool calls themselves go through the API routes and are routed there. |
| Spec parse | The owner of the project being configured. The parse request carries only the user today, so it has to carry the project too. |
| Runner list, runner restart | The project's owner (list) or the runner's owner (restart) |
| OOB callback | Needs a lookup from scan to owner, or the shard key in the callback token |
| Watchdog (cron) | Fans out to the owners that have active scans (one D1 query) |
| User revocation | The user's own shard, plus the shards of projects they are a member of |

With `AUTH_ENABLED` off there is no owner to route by: everything stays on the default key.

**Migration.**
1. Route behind a flag, with the default key `global-coordinator`, so nothing changes until it is switched.
2. Switch: new scans dispatch to owner shards, and runners connect there. The global object stops dispatching but keeps the runners it holds until their scans end; their streams and controls keep routing to it by scan, since it is recorded which object a scan started on.
3. Then the global object closes its idle runner sockets, and the runners reconnect to their owner's shard on their own. Scans still running there after a deadline are failed and re-queued: their resume and delivery state lives in that object's storage and is not copied.

**Non-goals.** This does not shard D1 (sections 1–4). It also does not split one large owner across objects: an owner whose runners outgrow one object needs a second key level, such as owner plus runner pool.
