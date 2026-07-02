---
layout: default
title: Structured Logging
---

# Structured Logging Framework 🪵

Swazz implements a unified, high-performance structured logging framework across both the Cloudflare Edge Worker and the Go container backend. This ensures consistent observability, easier debugging, and native integration with cloud monitoring pipelines.

---

## 1. Structured JSON Format Description

Both the Go backend and Edge Worker emit logs as structured JSON lines when configured. Each log entry is serialized as a JSON object containing the following standard fields:

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `timestamp` | `string` | The ISO 8601 / RFC 3339 UTC timestamp of when the event occurred (e.g., `2026-07-02T13:45:00.000Z`). |
| `level` | `string` | The severity level of the log entry. Supported values: `info`, `warn`, `error`, `debug`. |
| `module` | `string` | The system component or module emitting the log (e.g., `Coordinator`, `Cleanup`, `container`, etc.). |
| `msg` | `string` | The primary, human-readable log message. |
| `requestId` | `string` | *(Optional)* The unique identifier for the HTTP request associated with the log. |
| `traceId` | `string` | *(Optional)* The unique distributed tracing identifier for tracing requests across boundaries. |
| `error` | `object/any` | *(Optional)* An object detailing the error if the log reports a failure. For JavaScript `Error` objects, this contains `message`, `name`, and `stack`. |
| `payload` | `object` | *(Optional)* A key-value map containing additional contextual metadata and properties specific to the event. |

### Example JSON Log Line
```json
{
  "timestamp": "2026-07-02T13:45:00.000Z",
  "level": "info",
  "module": "Coordinator",
  "msg": "Runner agent connected successfully",
  "requestId": "req-98f2b1a0",
  "traceId": "tr-55c83d42",
  "payload": {
    "runnerId": "run_019a2b3c",
    "ipAddress": "192.0.2.1",
    "version": "1.4.2"
  }
}
```

---

## 2. Edge Worker Structured Logs Helper

For the Cloudflare Workers environment, Swazz uses a dedicated helper package located at [logger.ts](file:///Users/alex/src/swazz/packages/common/logging/logger.ts).

### Helper API
The helper exports three main log-level functions:
- `logInfo(env, module, msg, options)`
- `logWarn(env, module, msg, options)`
- `logError(env, module, msg, options)`

### How it Works
1. **Serialization**: The helpers format the inputs into a standardized `LogEntry` structure (converting JavaScript `Error` objects to nested JSON structures containing `message`, `name`, and `stack`).
2. **Standard Output**: The formatted object is printed to standard output via `console.log(JSON.stringify(entry))`, `console.warn(JSON.stringify(entry))`, or `console.error(JSON.stringify(entry))`.
3. **KV Buffering**: If the environment contains `SESSION_CACHE` (a Cloudflare KV namespace binding), the helpers concurrently buffer the log entry to a rolling array under the KV key `admin:logs` (capped at the last 1,000 entries). This rolling buffer is used to feed the web dashboard's real-time Admin Logs viewer.

---

## 3. Go Backend Structured Logs Configuration

The Go container backend (`packages/container`) supports switching between human-readable console logging and structured JSON logging.

### Configuration
Structured logging is enabled by setting the environment variable:
```bash
SWAZZ_LOG_FORMAT=json
```

### Go Logger Internals
- **Automatic Initialization**: On startup, the Go logger check the `SWAZZ_LOG_FORMAT` env variable. If it equals `"json"`, it activates JSON mode by disabling standard Go logger prefix flags (`log.SetFlags(0)`) so the timestamp is not doubled.
- **Output Structure**: It marshals log messages to a `JSONLog` struct and prints the stringified JSON. The default module name for container backend logs is `"container"`.
- **Level Filtering**: Log output can be filtered by setting the log level via `SetLevelByName` (e.g. `debug`, `info`, `warn`, `error`).

---

## 4. Cloudflare Logpush Configuration

To forward structured logs from Cloudflare Workers to external log aggregation, SIEM, or analysis platforms (such as Elasticsearch, Datadog, Loki, or Cloudflare Logs UI), Logpush must be enabled.

### Worker Configuration (`wrangler.toml`)
Enable Logpush and telemetry settings in [wrangler.toml](file:///Users/alex/src/swazz/packages/edge/wrangler.toml):
```toml
# Enable Logpush forwarding
logpush = true

# Configure Cloudflare Observability telemetry
[observability]
enabled = true

[observability.logs]
enabled = true
head_sampling_rate = 1
invocation_logs = true
```

*Note: Since standard logs are emitted as JSON strings, downstream aggregators can parse the payload as structured JSON directly from the message payload.*

---

## 5. Web UI Admin Logs Viewer

Swazz includes an embedded log viewer in the administration settings panel of the web application.

### Access & Authentication
1. Navigate to **Profile Settings** (accessible via the user menu dropdown in the top-right corner).
2. Select the **Admin Logs** tab in the settings navigation.
3. Authenticate by entering your **Admin Secret key** and clicking **Save & Authenticate**.
   - *Security: The Admin Secret key is matched against `ADMIN_SECRET` configured in the edge worker's environment variables. If correct, the UI saves it in `localStorage` under `admin_secret` and includes it in the `Authorization` header (`Bearer <secret>`) for requests to `/api/admin/logs`.*

### Querying and Filtering Logs
Once authenticated, the Admin Logs panel allows you to interactively monitor system health:
- **Refresh**: Manually fetch the latest logs cached in the rolling KV buffer.
- **Search**: Perform a case-insensitive text search across log messages.
- **Module Filter**: Narrow down logs to specific components (e.g. `Coordinator`, `container`).
- **Level Filter**: Filter by severity level (`All Levels`, `Info`, `Warn`, `Error`, `Debug`).
- **Inspection**: Click **Inspect** on any log row to expand the row and view the raw, formatted JSON payload (ideal for checking detailed request IDs, stack traces, or custom execution context).
