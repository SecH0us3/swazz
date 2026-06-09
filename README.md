# ⚡️ swazz — Smart API Fuzzer


<p align="center">
  <img src="docs/assets/og-image.png" alt="Swazz API Fuzzer" width="800">
</p>

[![CI](https://github.com/SecH0us3/swazz/actions/workflows/ci.yml/badge.svg)](https://github.com/SecH0us3/swazz/actions)
[![SARIF](https://img.shields.io/badge/report-SARIF-blueviolet)](https://sarifweb.azurewebsites.net/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-GitHub_Pages-blue.svg)](https://SecH0us3.github.io/swazz/)

**swazz** is a modern, smart API fuzzer designed for security researchers and developers. It parses OpenAPI (Swagger) specifications (in both JSON and YAML formats), Postman Collections, and SOAP (WSDL) to automatically identify crashes, logic flaws, and security vulnerabilities (XSS, Injection, etc.) through intelligent payload generation.

---

## 🚀 Key Features

- **⚡️ Smart Fuzzing**: Context-aware payload generation based on parameter types and schemas.
- **🔐 Auth Pipelines**: Support for complex, multi-step authentication sequences (login -> cookie collection -> fuzzing).
- **🛡️ Compliance Mapping**: Automatically map all discovered vulnerabilities to the **OWASP API Security Top 10 (2023)** standard in reports and the Web Dashboard.
- **🎯 Precision Control**: Define custom rules to ignore specific status codes or elevate them to errors/warnings.
- **📊 Professional Reporting**: Export findings in **SARIF** (for CI/CD integration), **JSON**, or standalone **HTML** reports (now also accessible directly from the Web UI).
- **🛠 Interactive Wizard**: Fast setup with `swazz-engine wizard` — no manual JSON editing required.
- **🌐 Web Dashboard**: Real-time Heatmap, Request Inspector, and OWASP Compliance dashboard for deep-dive analysis.

---

## 📦 Installation

### Download Binary
You can download the pre-compiled CLI binary from the [Releases](https://github.com/SecH0us3/swazz/releases) page for Linux, macOS, and Windows.

### Docker & Cloudflare
We publish two Docker images to the GitHub Container Registry:
- **API Server & Web Dashboard**: [ghcr.io/sech0us3/swazz](https://github.com/SecH0us3/swazz/pkgs/container/swazz)
- **Headless CLI Fuzzer**: [ghcr.io/sech0us3/swazz-cli](https://github.com/SecH0us3/swazz/pkgs/container/swazz-cli)

For security reasons and to guarantee reproducibility, we **never use the `latest` tag**. Always use a specific commit SHA (replace `<COMMIT_SHA>` with the actual hash from our [Releases](https://github.com/SecH0us3/swazz/releases)).

#### Running the API Server (Web Dashboard)
```bash
docker pull ghcr.io/sech0us3/swazz:<COMMIT_SHA>
# The image exposes the backend service on container port 8080. Choose any host port you prefer:
docker run -p 8080:8080 ghcr.io/sech0us3/swazz:<COMMIT_SHA>
```

#### Running the Headless CLI
```bash
docker pull ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA>
# Run fuzzing directly (mount your config file using a volume):
docker run --rm -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA> --config /app/swazz.config.json
```

If you use this repository's compose setup, host ports are parameterized via FRONTEND_PORT (default: 3000) and BACKEND_PORT (default: 8081). See DOCKER.md for details.

### Build from Source
```bash
# Clone the repository
git clone https://github.com/SecH0us3/swazz.git
cd swazz

# Build the engine
cd packages/container
go build -o swazz-engine .
```

---

## 🏁 Quick Start

### 1. Interactive Setup
Run the wizard to generate your configuration file automatically. It will guide you through Swagger URLs, Auth steps, and Rule definitions.
```bash
./swazz-engine wizard
```

### 2. Start Fuzzing
Execute the fuzzing run using your generated config.
```bash
./swazz-engine start --config swazz.config.json --html report.html
```

### 3. CI/CD Integration
Generate SARIF reports and fail the build if any security errors are found (perfect for GitHub Actions / GitLab CI).
```bash
./swazz-engine start --config swazz.config.json --fail-on-severity error --sarif findings.sarif
```

### 4. Stateful API Fuzzing & Request Chaining
Swazz can extract variables from previous responses and inject them into subsequent fuzzing requests (e.g., extracting an `AUTH_TOKEN` from a `POST /login` and injecting it as a header in later requests). Add rules via the Web Dashboard, or configure them manually:
```json
{
  "settings": {
    "chainingRules": [
      {
        "sourceEndpoint": "POST /api/login",
        "extractType": "json",
        "extractPath": "data.token",
        "variableName": "AUTH_TOKEN"
      }
    ]
  }
}
```

### 5. Test on the Vulnerable Demo API
If you want to quickly test Swazz's capabilities, we provide a built-in vulnerable API simulated as a Cloudflare Worker in the `demo/` folder.
> **⚠️ Disclaimer:** The code in the `demo/` directory is intentionally designed with vulnerabilities (like SQL injection) for testing Swazz. It should **NOT** be used in production or audited for security issues.

---

## 🔄 CI/CD Integration

Swazz is designed to work seamlessly in continuous integration pipelines. It supports exporting fuzz results to **SARIF (Static Analysis Results Interchange Format)**, allowing you to view and manage vulnerabilities directly inside your version control platform.

*   **GitHub Actions:** Automatically runs on pull requests, reporting findings inline on the files. See the [GitHub Actions Guide](docs/ci_cd.md#github-actions--sarif-reporting).
*   **GitLab CI:** Integrates directly with GitLab's Security Dashboard (via native SARIF or converted SAST reports). See the [GitLab CI Guide](docs/ci_cd.md#gitlab-ci).

For detailed setup instructions, including advanced configuration, caching, and credential injection, check out the full [CI/CD Integration Guide](docs/ci_cd.md).

---

## ⚙️ Configuration Example

`swazz` uses a flexible JSON configuration for fine-grained control:

```json
{
  "swagger_urls": ["https://api.example.com/swagger.json"],
  "base_url": "https://api.example.com/v1",
  "wordlist_files": {
    "xss": "custom_xss.txt",
    "sqli": "custom_sqli.txt"
  },
  "auth_sequence": [
    {
      "method": "POST",
      "url": "/login",
      "body": { "user": "admin", "pass": "secret" }
    }
  ],
  "rules": {
    "ignore": [404],
    "severity": {
      "200": "warning",
      "403": "error"
    }
  }
}
```

---

## 🛠 Tech Stack

- **Engine**: Go (High-performance concurrency)
- **Dashboard**: React 19, Vite, Vanilla CSS
- **Formats**: OpenAPI 2.0/3.0, Postman Collections, SOAP (WSDL), SARIF, JSON

## 🙈 Ignore Rules & Suppressions

To suppress false positives and filter noisy findings, Swazz supports ignore rules. You can triage findings in the Web Dashboard and download the rules config, or manually create `swazz.ignore.json` in your project root.

### Example `swazz.ignore.json`

```json
[
  {
    "rule_id": "swazz/reflected-xss",
    "endpoint": "/api/search",
    "method": "GET",
    "payload": "<script>alert(1)</script>"
  },
  {
    "endpoint": "/api/admin/*",
    "method": "DELETE"
  },
  {
    "rule_id": "swazz/status-500",
    "payload": ".*(sql|syntax|database).*"
  }
]
```

*   **`rule_id`**: Matches the Swazz vulnerability type (e.g. `swazz/sql-error-leak`, `swazz/reflected-xss`, `swazz/status-500`).
*   **`endpoint`**: Matches the request URL path (supports exact strings or wildcard `*` suffixes like `/api/admin/*`).
*   **`method`**: Matches the HTTP request method (case-insensitive).
*   **`payload`**: Matches the request body/parameters (supports regular expressions or substring matching).

---

## 📚 Documentation

Comprehensive documentation, including installation guides, usage instructions, and architecture details, is available at the [Official Swazz Documentation](https://SecH0us3.github.io/swazz/).

---

## 🧩 Adding Custom Error Detectors

New developers can easily add custom finding categories and error signature rules to the scanner. Custom detectors are defined as regex patterns in a single central registry in the backend engine:
- Edit the [custom.go](file:///Users/alex/src/swazz/packages/container/internal/analyzer/custom.go) file.
- Append a new `CustomRule` to the `CustomRules` slice in that file:
  ```go
  var CustomRules = []CustomRule{
      {
          RuleID:  "swazz/custom-token-leak",
          Level:   "warning", // "error", "warning", "note"
          Name:    "Custom Token Leak",
          Pattern: `(?i)custom-api-token-[a-f0-9]{32}`,
          Message: "A custom API token leak has been detected in the response body.",
      },
  }
  ```
The engine automatically runs these rules against all HTTP responses and routes findings to the dashboard and exported reports.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
