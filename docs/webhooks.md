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

---

## 🔒 Verifying Webhook Signatures

To ensure that webhook payloads are authentic and were sent by Swazz (rather than a malicious third-party), Swazz signs each outbound request payload using a unique secret key.

The signature is sent in the custom header `X-Swazz-Signature` with the format:
```
X-Swazz-Signature: t=1720000000,v1=a8d8e3f6...
```
Where:
- `t` is the Unix epoch timestamp (in seconds) of when the dispatch was initiated.
- `v1` is the HMAC-SHA256 signature generated over the string concatenation `${timestamp}.${JSON.stringify(webhookPayload)}`.

### Verification Steps

1. **Extract** the timestamp (`t`) and the signature (`v1`) from the `X-Swazz-Signature` header.
2. **Prevent Replay Attacks** by verifying that the difference between the current time and the timestamp `t` is within a reasonable window (e.g., 5 minutes or 300 seconds).
3. **Compute the Signature** on your server using:
   - **Secret key**: the webhook secret displayed in your Project Settings.
   - **Message**: the string `${timestamp}.${requestRawBody}` (where `requestRawBody` is the raw JSON string payload received in the HTTP request body).
4. **Compare** the computed signature with the signature `v1` from the header using a constant-time comparison algorithm to prevent timing attacks.

### Verification Example (Node.js / Express)

```javascript
const crypto = require('crypto');

app.post('/webhooks/swazz', express.raw({ type: 'application/json' }), (req, res) => {
    const signatureHeader = req.headers['x-swazz-signature'];
    if (!signatureHeader) {
        return res.status(401).send('Missing signature header');
    }

    // Parse the header
    const parts = signatureHeader.split(',');
    const tPart = parts.find(p => p.startsWith('t='));
    const vPart = parts.find(p => p.startsWith('v1='));
    
    if (!tPart || !vPart) {
        return res.status(400).send('Malformed signature header');
    }

    const timestamp = tPart.split('=')[1];
    const signature = vPart.split('=')[1];
    
    // Prevent replay attacks (e.g. 5-minute tolerance)
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    if (parseInt(timestamp, 10) < fiveMinutesAgo) {
        return res.status(400).send('Request expired (replay attack detected)');
    }

    // Compute signature
    const webhookSecret = process.env.SWAZZ_WEBHOOK_SECRET; // e.g. whsec_...
    const message = `${timestamp}.${req.body.toString('utf8')}`;
    
    const computedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(message)
        .digest('hex');

    // Secure constant-time comparison
    try {
        const isVerified = crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(computedSignature, 'hex')
        );
        
        if (!isVerified) {
            return res.status(401).send('Invalid signature');
        }
    } catch {
        return res.status(401).send('Invalid signature');
    }

    // Signature verified! Process payload
    const payload = JSON.parse(req.body);
    console.log('Received event:', payload.event);
    res.sendStatus(200);
});
```
