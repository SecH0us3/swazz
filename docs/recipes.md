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
        uses: docker://ghcr.io/sech0us3/swazz-cli:7d8123ae45b1480f2d12f170f3f3c7e73d8123ae
        with:
          args: start --config swazz.config.json --sarif results.sarif
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
# Run Swazz using a non-root system user
sudo systemd-run \
  -p User=swazz \
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
  -F "active=true" \
  -F "verified=true" \
  -F "scan_type=SARIF" \
  -F "minimum_severity=Low" \
  -F "engagement=4" \
  -F "file=@results.sarif"
```

---

## 🛰 Recipe 6: Fuzzing gRPC Microservices with Reflection

Fuzz a target gRPC service using Server Reflection without needing local `.proto` files:

1. Create a `swazz.config.grpc.json`:
```json
{
  "base_url": "grpc://localhost:50051",
  "swagger_urls": [
    "grpc://localhost:50051"
  ],
  "settings": {
    "iterations": 15,
    "concurrency": 5,
    "profiles": ["RANDOM", "BOUNDARY", "MALICIOUS"],
    "analyze_response_body": true
  }
}
```

2. Run Swazz CLI against the gRPC service:
```bash
swazz-engine start --config swazz.config.grpc.json --sarif grpc-findings.sarif --html grpc-report.html
```

---

## 🤖 Recipe 7: Fuzzing & Auditing Target Model Context Protocol (MCP) Servers

Audit a target MCP server across tool arguments, prototype pollution in tool names, and confirmation contracts:

1. **Inspect and verify tool confirmation contracts safely**:
   ```bash
   swazz-engine start -config swazz.config.mcp.json -mcp-list-tools
   ```

2. **Configure `swazz.config.mcp.json`**:
   ```jsonc
   {
     "mcp_server": {
       "type": "http",
       "url": "http://127.0.0.1:8000/mcp"
     },
     "global_headers": {
       "Authorization": "Bearer token-user-a"
     },
     "settings": {
       "enable_mcp_method_fuzzing": true,
       "bola_testing": true,
       "profiles": ["RANDOM", "BOUNDARY", "MALICIOUS"]
     }
   }
   ```

3. **Run fuzzing with method & tool dispatch security checks**:
   ```bash
   swazz-engine start -config swazz.config.mcp.json -mcp-fuzz-methods --sarif mcp-findings.sarif
   ```

---

## 🛡️ Recipe 5: Automated WAF Detection & Virtual Patching in CI/CD

Combine automated WAF detection with post-scan virtual patch generation in your CI/CD pipeline. If vulnerabilities are confirmed during fuzzing, Swazz exports ready-to-deploy mitigation rules to protect production APIs immediately while code-level fixes are being developed.

1. **Configure WAF Detection in `swazz.config.json`**:
   ```json
   {
     "base_url": "https://api.staging.example.com",
     "swagger_urls": ["https://api.staging.example.com/openapi.json"],
     "settings": {
       "waf_check_enabled": true,
       "profiles": ["BOUNDARY", "MALICIOUS"]
     }
   }
   ```

2. **Execute Scan with Automated Virtual Patch Export**:
   ```bash
   # Generate Cloudflare WAF Expression Rules from confirmed bypass findings
   swazz-engine start --config swazz.config.json --waf-patch cloudflare --waf-patch-output artifacts/cloudflare-waf-rules.txt --sarif results.sarif

   # Or generate multi-vendor bundles (AWS, GCP, Azure, ModSecurity, Nginx, Caddy, HAProxy, K8s)
   swazz-engine start --config swazz.config.json --waf-patch all --waf-patch-output artifacts/waf-patches/
   ```

3. **Deploy or Review Virtual Patches**:
   The resulting files contain native firewall rules and Terraform HCL snippets that your DevOps or SecOps team can review and apply to perimeter security gateways directly.


