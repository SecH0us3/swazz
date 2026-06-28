# Cloudflare Queues Integration for Scaling Scans & Buffering Findings

This document outlines the architecture, data flows, and configuration details for the **Cloudflare Queues** integration in Swazz.

---

## 1. Architecture Overview

To support high-concurrency scans and protect database instances from peak write pressure, Swazz uses a **Queue Broker Pattern** using Cloudflare Queues. 

External client runner agents never interact directly with the queues. Instead, the **Edge Coordinator** acts as a secure intermediary. This ensures that runner processes do not require Cloudflare account credentials or direct queue bindings, maintaining strict tenant isolation.

```
                           +----------------------+
                           |  Frontend Dashboard  |
                           +----------+-----------+
                                      |
                                  WS / HTTP
                                      v
+------------------+       +----------+-----------+
|  Private Runner  | <---> |                      |
+------------------+       |   Edge Coordinator   |
                           |                      |
+------------------+       +----+-----------+-----+
|  Shared Runner   | <---> |    |           |
+------------------+       +----+-----------+-----+
                                |           |
                            Enqueue      Enqueue
                                |           |
                                v           v
                       +--------+----+  +---+--------+
                       | SCAN_QUEUE  |  | FINDINGS_  |
                       |             |  |  QUEUE     |
                       +--------+----+  +---+--------+
                                |           |
                             Consumer    Consumer
                                |           |
                                v           v
                       +--------+----+  +---+--------+
                       | Coordinator |  | D1 Database|
                       |  Dispatch   |  |            |
                       +-------------+  +------------+
```

---

## 2. Queue Details

### 2.1 Scan Job Queue (`swazz-scan-queue`)
* **Purpose**: Offloads scan submissions from synchronous HTTP request paths and handles queuing when runners are offline.
* **Binding**: `SCAN_QUEUE`
* **Batch Size**: `1` (timeout: `0` seconds) to guarantee immediate processing.
* **Flow**:
  1. The client submits a scan. The coordinator writes the scan record to D1 with status `queued` and enqueues the configuration.
  2. The consumer processes the message, calling `/dispatch` on the coordinator DO.
  3. If a compatible runner is active, it receives the job, and the scan status becomes `dispatched`.
  4. If no runner is online, the scan status remains `queued` in D1, and the message is acknowledged. When a runner of that user connects, the coordinator DO pulls the queued scan and starts execution.

### 2.2 Findings & Events Buffer Queue (`swazz-findings-queue`)
* **Purpose**: Buffers real-time logs, progress metrics, and findings from runners before writing them to the database, protecting D1 from write exhaustion.
* **Binding**: `FINDINGS_QUEUE`
* **Batch Size**: `100` (timeout: `2` seconds).
* **Flow**:
  1. The runner streams findings and metrics to the coordinator DO over WebSocket.
  2. The coordinator enqueues each event to `FINDINGS_QUEUE` and broadcasts it to active UI clients.
  3. The consumer receives events in batches (up to 100 messages or every 2 seconds) and bulk-inserts them into the D1 `scan_events` table.

---

## 3. Configuration & Settings

The bindings are configured in `wrangler.toml` under the `queues` namespace:

```toml
[[queues.producers]]
queue = "swazz-scan-queue"
binding = "SCAN_QUEUE"

[[queues.producers]]
queue = "swazz-findings-queue"
binding = "FINDINGS_QUEUE"

[[queues.consumers]]
queue = "swazz-scan-queue"
max_batch_size = 1
max_batch_timeout = 0

[[queues.consumers]]
queue = "swazz-findings-queue"
max_batch_size = 100
max_batch_timeout = 2
```

---

## 4. UI Indicators (Queued State)

When a scan is queued, the coordinator WebSocket broadcasts a `queued` state message to the client. The frontend dashboard parses this and renders:
* A pulsing orange indicator dot.
* Descriptive `"Queued"` status text in the header status bar.
* Once a runner picks up the job, the UI smoothly transitions to `"Running"` with a green indicator dot.
