# Swazz Webhook Notifications

Swazz supports outbound Webhook Notifications to deliver real-time scan updates and vulnerability findings directly to your external endpoints.

---

## ⚙️ Configuration

You can configure webhooks under **Project Settings > Webhooks** in the dashboard.
- **Target URL**: The HTTP/HTTPS endpoint capable of accepting incoming `POST` requests with JSON payloads.
- **Custom Headers**: A JSON object of custom headers (e.g. authentication tokens, custom user-agents, secret signatures) to include in the outbound request:
  ```json
  {
    "Authorization": "Bearer my-secret-token",
    "X-Swazz-Signature": "custom-auth-signature"
  }
  ```
- **Trigger Events**: Choose which events trigger the webhook dispatch.

---

## 📡 Supported Event Types

| Event Key | Label | Description |
| :--- | :--- | :--- |
| `scan.started` | Scan Started | Triggered when a new fuzzer scan run starts and gets assigned to a runner agent. |
| `scan.completed` | Scan Completed | Triggered when a fuzzer scan completes successfully. |
| `scan.failed` | Scan Failed | Triggered when a fuzzer scan run fails or encounters errors. |
| `finding.triaged` | AI Triage / Patch | Triggered when AI analysis completes triage and generates proposed remediation patches. |

---

## 📦 Webhook Payloads

All webhook requests are sent as `POST` requests with `Content-Type: application/json`.

### Common Envelope

Every webhook payload conforms to the following schema:
```json
{
  "event": "string",
  "timestamp": "ISO 8601 string",
  "project_id": "string",
  "data": {}
}
```

### Examples

#### `scan.started` / `scan.completed` / `scan.failed`
```json
{
  "event": "scan.completed",
  "timestamp": "2026-07-08T19:04:16.123Z",
  "project_id": "01KX17S88YXW30R7YAKDBVTGKR",
  "data": {
    "scan_id": "01KX17S88YXW30R7YAKDBVTG12",
    "status": "completed",
    "target_url": "https://api.example.com",
    "profile": "MALICIOUS",
    "summary_stats": {
      "total_requests": 412,
      "failed_requests": 2,
      "anomalies": 1
    },
    "created_at": "2026-07-08T19:00:00.000Z",
    "completed_at": "2026-07-08T19:04:15.000Z"
  }
}
```


#### `finding.triaged`
```json
{
  "event": "finding.triaged",
  "timestamp": "2026-07-08T19:03:00.789Z",
  "project_id": "01KX17S88YXW30R7YAKDBVTGKR",
  "data": {
    "id": "7ca647dc-fa2b-474c-8822-26cb49bb55af",
    "scan_id": "01KX17S88YXW30R7YAKDBVTG12",
    "rule_id": "malicious_sqli",
    "level": "error",
    "message": "Potential SQL Injection vulnerability detected on GET /api/v1/users/{id} via parameter 'id'.",
    "evidence": "...",
    "ai_status": "completed",
    "ai_relevance": "true",
    "ai_explanation": "The fuzzer payload caused a database error in the response body indicating unescaped input concatenation.",
    "ai_remediation": "Use parameterized queries or ORM to escape SQL parameters.",
    "ai_proposed_patch": "...",
    "pr_link": "https://github.com/my-org/my-api/pull/12"
  }
}
```
