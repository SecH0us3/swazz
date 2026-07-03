# Actionable Recipes & Cookbooks 🍳

Welcome to the Swazz recipes catalog. Below you will find production-ready configurations and commands for common use-cases.

---

## ⚡️ Recipe 1: CI/CD Pipeline Automation (GitHub Actions)

Add this workflow file to `.github/workflows/swazz-fuzz.yml` to automatically run Swazz on every pull request and upload security results to GitHub Code Scanning.

```yaml
name: Swazz API Security Scan

on:
  pull_request:
    branches: [ master ]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
      
      - name: Run Swazz Fuzzer
        # Pin to verified commit hash
        uses: docker://ghcr.io/sech0us3/swazz-cli:7d8123ae45b14
        with:
          args: start --config swazz.config.json --output sarif --out-file results.sarif
        env:
          SWAZZ_AGENT_TOKEN: ${{ secrets.SWAZZ_AGENT_TOKEN }}

      - name: Upload SARIF Report
        uses: github/codeql-action/upload-sarif@9e0d7b8d25671d64c341c19c0152d693099fb5ba # v3
        with:
          sarif_file: results.sarif
```

---

## 👥 Recipe 2: Detecting BOLA (IDOR) with Multi-Identity

To scan for Broken Object Level Authorization, you must feed Swazz the authorization headers for two distinct users (Victim and Attacker).

1. Create a `swazz.config.json` containing:
```json
{
  "base_url": "https://api.target.local",
  "rules": {
    "bola_testing": {
      "enabled": true,
      "identities": [
        {
          "name": "User_A_Victim",
          "headers": {
            "Authorization": "Bearer eyJhbGciOi..."
          }
        },
        {
          "name": "User_B_Attacker",
          "headers": {
            "Authorization": "Bearer eyJhbGciOi..."
          }
        }
      ]
    }
  }
}
```
2. Run the scan. Swazz will automatically substitute cross-identity parameters and verify if User B can access User A's objects.

---

## 📯 Recipe 3: Intercepting HAR files & Replay

For zero-setup scans, record your browser sessions using DevTools and upload them:

1. Open DevTools (F12) -> Network -> Check "Preserve Log".
2. Perform user flows (e.g. login, create object, delete object).
3. Right click on request log -> "Save all as HAR with content".
4. Run Swazz in traffic replay mode:
   ```bash
   swazz-engine start --har path/to/recorded.har --target https://api.target.local
   ```

---

## 🔒 Recipe 4: System/Network Policies for Go Runner Sandbox

Run your Go fuzzer agent with restrictive system sandbox configurations to defend against arbitrary system commands.

```bash
# Run Swazz using a non-root system user and bind-mount only local files
systemd-run --user \
  -p PrivateTmp=yes \
  -p ProtectSystem=strict \
  -p ProtectHome=yes \
  -p RestrictAddressFamilies="AF_INET AF_INET6 AF_UNIX" \
  /usr/local/bin/swazz-engine serve
```

---

## 🛡 Recipe 5: DefectDojo Integration Pipeline

Upload your scans directly to your DefectDojo dashboard via API.

```bash
curl -X POST "https://defectdojo.company.local/api/v2/import-scan/" \
  -H "Authorization: Token d3f3c7d0139b4..." \
  -H "Content-Type: multipart/form-data" \
  -F "active=true" \
  -F "verified=true" \
  -F "scan_type=SARIF" \
  -F "minimum_severity=Low" \
  -F "engagement=4" \
  -F "file=@results.sarif"
```
