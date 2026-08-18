# 🔑 Swazz Licensing Operational Guide

This document contains full operational procedures for **Product Owners (Vendors)** and **Enterprise Clients** for issuing, managing, and activating Swazz Enterprise Commercial Licenses.

---

# Part 1: Product Owner Operational Manual (Инструкция для владельца)

## 1. Prerequisites & Dependencies

To generate, sign, and issue cryptographic licenses, the Product Owner needs:
* **Go 1.22+** installed on the license issuing machine/server.
* **OpenSSL** (built into Mac/Linux) to generate the initial Ed25519 keypair.

---

## 2. One-Time Setup: Master Keypair Generation

> [!CAUTION]
> Generate the master keypair **ONCE** for the lifetime of the product. The **Private Key** must be guarded with extreme security and NEVER committed to Git or shipped to clients.

Run the following commands in a secure terminal:

```bash
# 1. Generate Master Ed25519 Private Key (Keep SECURE & PRIVATE!)
openssl genpkey -algorithm ed25519 -out swazz_master_private.pem

# 2. Extract Master Ed25519 Public Key (To be embedded in Swazz binary)
openssl pkey -in swazz_master_private.pem -pubout -out swazz_master_public.pem
```

### Key Storage Rules:
* **`swazz_master_private.pem`**: Store in 1Password / HashiCorp Vault / AWS Secrets Manager. **NEVER** commit to Git.
* **`swazz_master_public.pem`**: Not used directly — the hex-encoded 32-byte public key is what gets embedded.

### Embed the Public Key

After generating the keypair, run the issuing script once (see Step 3). The output will include the **Public Key (hex)** — a 64-character hex string.

Update the embedded default in [`packages/container/internal/license/license.go`](https://github.com/SecH0us3/swazz/blob/master/packages/container/internal/license/license.go#L29):

```go
var DefaultPublicKeyHex = "<your-64-char-hex-public-key>"
```

Alternatively, clients/operators can set the `SWAZZ_LICENSE_PUBKEY` environment variable or compile with `-ldflags "-X swazz-engine/internal/license.DefaultPublicKeyHex=..."` to set the embedded key at runtime.

---

## 3. Step-by-Step License Issuance Workflow

When an Enterprise Client purchases a commercial license or requests a trial:

### Step 3.1: Execute License Issuance Tool

Run [`scripts/issue-license.go`](https://github.com/SecH0us3/swazz/blob/master/scripts/issue-license.go):

```bash
# Full enterprise license (all features, 1 year, 50 users)
go run scripts/issue-license.go \
  -key /path/to/swazz_master_private.pem \
  -company "Acme Corporation" \
  -days 365 \
  -features "*" \
  -max-users 50
```

```bash
# Pro tier (specific features, 90-day trial)
go run scripts/issue-license.go \
  -key /path/to/swazz_master_private.pem \
  -company "Startup Inc" \
  -days 90 \
  -features "sso,rbac,jira_sync" \
  -max-users 10
```

```bash
# CI/Automated issuance (output token to file only)
go run scripts/issue-license.go \
  -key /path/to/swazz_master_private.pem \
  -company "Automation Client" \
  -out license.key \
  -token-only
```

### Available Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `-key` | ✅ Yes | — | Path to Ed25519 PEM PKCS#8 private key |
| `-company` | ✅ Yes | — | Company / organization name |
| `-days` | No | `365` | Validity duration in days |
| `-features` | No | `*` | Comma-separated features, or `*` for all |
| `-max-users` | No | `0` | Max users (`0` = unlimited) |
| `-token-only` | No | `false` | Output raw license token string only (CI/automation) |
| `-out` | No | — | Path to save license token string to file |

### Known Feature Identifiers

| Feature ID | Description |
|---|---|
| `*` | All features unlocked (wildcard) |
| `sso` / `saml_sso` | SAML/SSO integration |
| `rbac` / `multi_tenant_rbac` | Multi-tenant RBAC |
| `compliance_reports` / `pci_soc2_reports` | PCI/SOC2 compliance reports |
| `jira_sync` | Jira issue synchronization |
| `ai_remediation_pro` | AI-powered auto-remediation |
| `unlimited_scans` | Unlimited concurrent scans |

### Step 3.2: Copy the Generated Output

The script prints the signed JWT license key:

```text
=========================================================
🔑 SWAZZ ENTERPRISE LICENSE KEY GENERATED SUCCESSFULLY
=========================================================
Company:           Acme Corporation
Issued At:         2026-08-06T05:54:00Z
Expires At:        2027-08-06T05:54:00Z (365 days)
Features:          *
Max Users:         50
---------------------------------------------------------
SWAZZ_LICENSE_KEY:
eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJjb21wYW55Ijoi...
---------------------------------------------------------
Public Key (hex, for DefaultPublicKeyHex / SWAZZ_LICENSE_PUBKEY):
a84976722d515a815a4a5ebcebf7ffecaa2d9735d10ea354ef3ddc45dfba8314
=========================================================
```

### Step 3.3: Deliver to Client

Send the generated `SWAZZ_LICENSE_KEY` string securely to the client contact via encrypted email, customer portal, or secure channel.

> [!IMPORTANT]
> The license key is a self-contained signed JWT. The client does NOT need the public key — it's already embedded in the Swazz binary.

---

## 4. Key Rotation

If the master private key is compromised:

1. Generate a new Ed25519 keypair (Step 2).
2. Update `DefaultPublicKeyHex` in `license.go` with the new public key hex.
3. Release a new version of Swazz with the updated public key.
4. Re-issue licenses to all active clients using the new private key.

---

# Part 2: Client Activation Guide (Инструкция для клиентов)

## 1. Requirements

* **Swazz Engine / Runner v1.0.0+**
* Docker / Container Runtime (or local CLI binary)
* Valid `SWAZZ_LICENSE_KEY` string provided by Swazz Enterprise Sales.

---

## 2. Activation Methods

Clients can activate their Enterprise License using any of the following methods:

### Method A: Environment Variable (Recommended for Docker / CI/CD)

Pass `SWAZZ_LICENSE_KEY` into your Swazz Docker Runner container:

```bash
docker run -d --name swazz-runner \
  -e SWAZZ_LICENSE_KEY="eyJhbGciOiJFZERTQSI..." \
  -e SWAZZ_ALLOW_PRIVATE_IPS=true \
  ghcr.io/sech0us3/swazz-runner:ai
```

### Method B: Configuration File (`swazz.config.json`)

Add the key to your project configuration file:

```json
{
  "settings": {
    "license_key": "eyJhbGciOiJFZERTQSI...",
    "concurrency": 10
  }
}
```

### Method C: Local CLI Environment

Export the environment variable before running local scans:

```bash
export SWAZZ_LICENSE_KEY="eyJhbGciOiJFZERTQSI..."
./swazz-engine start --config swazz.config.json
```

---

## 3. License Status Verification

To check license status, validity, and unlocked enterprise features at any time:

### Terminal Check:
Run the embedded license status command:
```bash
./swazz-engine license
```

### Web UI Dashboard Check:
1. Open the Swazz Dashboard at `http://localhost:5173`.
2. Navigate to **System Settings -> License & Subscription**.
3. Verify the **Enterprise Active** badge, expiration date, and enabled feature entitlements.

---

## 4. How It Works (Technical Overview)

```
┌──────────────────┐     Ed25519 Sign     ┌──────────────────┐
│  Owner Machine   │ ───────────────────▶  │  License JWT     │
│  (Private Key)   │                       │  (SWAZZ_LICENSE  │
│                  │                       │   _KEY)           │
└──────────────────┘                       └────────┬─────────┘
                                                    │
                                                    ▼ Delivered to client
                                           ┌──────────────────┐
                                           │  Swazz Engine    │
                                           │  (Public Key     │
                                           │   embedded)      │
                                           │                  │
                                           │  Ed25519 Verify  │
                                           └──────────────────┘
```

* **Signing**: Owner signs the license JWT with the **Ed25519 private key** (never leaves owner's machine).
* **Verification**: Swazz Engine verifies the JWT signature using the **Ed25519 public key** embedded at compile time (`DefaultPublicKeyHex`).
* **No phone-home**: License verification is fully offline. No network call to a license server is required.

---

## 5. Troubleshooting & Error Codes

| Error Message | Cause | Resolution |
| :--- | :--- | :--- |
| `license: invalid token format` | Token string is malformed or truncated. | Re-copy the exact `SWAZZ_LICENSE_KEY` without added whitespace or line breaks. |
| `license: invalid signature` | License was signed with a different key or tampered with. | Ensure the embedded public key matches the private key used for signing. Contact vendor. |
| `license: expired license` | License validity period (`expires_at`) has elapsed. | Contact `enterprise@swazz.secmy.app` for a license renewal token. |
| `license: public key not configured` | No public key found (empty hex and no `SWAZZ_LICENSE_PUBKEY` env). | Set `SWAZZ_LICENSE_PUBKEY` environment variable to the 64-char hex public key. |
