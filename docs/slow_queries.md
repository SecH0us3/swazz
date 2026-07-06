# D1 Slow Query Monitoring ⏱️

Swazz features an integrated slow query monitoring system for Cloudflare D1 databases. This helps developers and administrators detect latency regressions and optimize database indexes.

## Design and Architecture

Database operations in the edge coordinator are automatically monitored. The `getDB` wrapper intercepts all database interactions using a JavaScript `Proxy`. It monitors:
- **Prepared Statements**: Timing executions of `first()`, `run()`, `all()`, and `raw()`.
- **Database Executions**: Timing executions of `exec()`.
- **Batch Queries**: Timing operations grouped under `batch()`.

Whenever a database query exceeds the configured threshold, Swazz triggers three notification channels:
1. **Structured Log**: Logs a warning via `console.warn` with serialized JSON detailing the query, duration, threshold, and timestamp.
2. **Cloudflare Analytics Engine**: Writes a data point to `ANALYTICS_ENGINE` (if bound) for dashboard visualization.
3. **KV Cache**: Appends the query metadata to the `admin:slow-queries` KV array in the session cache (limited to the 100 most recent queries) with a 24-hour TTL.

## Configuration

You can configure the threshold via the environment variables or wrangler configuration:

| Variable | Description | Default |
|----------|-------------|---------|
| `SLOW_QUERY_THRESHOLD_MS` | The query latency threshold in milliseconds. Queries slower than this are flagged. | `200` |

## Admin inspection Endpoint

Administrators can retrieve the list of recent slow queries using the admin secret:

### Fetch Recent Slow Queries
`GET /api/admin/slow-queries`

**Headers:**
* `Authorization: Bearer <ADMIN_SECRET>` or `X-Admin-Secret: <ADMIN_SECRET>`

**Example Response:**
```json
[
  {
    "event": "slow_query",
    "query": "SELECT * FROM users WHERE delete_requested_at IS NOT NULL",
    "duration": 284,
    "threshold": 200,
    "timestamp": "2026-07-06T08:01:28.636Z"
  }
]
```
