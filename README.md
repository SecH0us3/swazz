# ⚡️ swazz — Smart API Fuzzer

[![CI](https://github.com/SecH0us3/swazz/actions/workflows/ci.yml/badge.svg)](https://github.com/SecH0us3/swazz/actions)
[![SARIF](https://img.shields.io/badge/report-SARIF-blueviolet)](https://sarifweb.azurewebsites.net/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-GitHub_Pages-blue.svg)](https://SecH0us3.github.io/swazz/)

**swazz** is a modern, smart API fuzzer designed for security researchers and developers. It parses OpenAPI (Swagger) specifications to automatically identify crashes, logic flaws, and security vulnerabilities (XSS, Injection, etc.) through intelligent payload generation.

---

## 🚀 Key Features

- **⚡️ Smart Fuzzing**: Context-aware payload generation based on parameter types and schemas.
- **🔐 Auth Pipelines**: Support for complex, multi-step authentication sequences (login -> cookie collection -> fuzzing).
- **🎯 Precision Control**: Define custom rules to ignore specific status codes or elevate them to errors/warnings.
- **📊 Professional Reporting**: Export findings in **SARIF** (for CI/CD integration), **JSON**, or standalone **HTML** reports (now also accessible directly from the Web UI).
- **🛠 Interactive Wizard**: Fast setup with `swazz-engine wizard` — no manual JSON editing required.
- **🌐 Web Dashboard**: Real-time Heatmap and Request Inspector for deep-dive analysis.

---

## 📦 Installation

### Download Binary
You can download the pre-compiled CLI binary from the [Releases](https://github.com/SecH0us3/swazz/releases) page for Linux, macOS, and Windows.

### Docker & Cloudflare
We publish the Swazz engine Docker container to the GitHub Container Registry (`ghcr.io/sech0us3/swazz`) for our users. It is optimized for minimal resource usage. For security reasons and to guarantee reproducibility, we **never use the `latest` tag**.

Always use a specific commit SHA hash. You must specify the hash of the new build you want to use (you can find these hashes in our Release notes or commit history).

```bash
# Example using a commit SHA hash (replace <COMMIT_SHA> with the actual hash from the latest build):
docker pull ghcr.io/sech0us3/swazz:<COMMIT_SHA>
docker run -p 8080:8080 ghcr.io/sech0us3/swazz:<COMMIT_SHA>
```

### Build from Source
```bash
# Clone the repository
git clone https://github.com/SecH0us3/swazz.git
cd swazz

# Build the engine
cd packages/container
go build -o swazz-engine main.go
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
./swazz-engine start --config swazz.config.json --fail-on-error --sarif findings.sarif
```

### 4. Test on the Vulnerable Demo API
If you want to quickly test Swazz's capabilities, we provide a built-in vulnerable API simulated as a Cloudflare Worker in the `demo/` folder.
> **⚠️ Disclaimer:** The code in the `demo/` directory is intentionally designed with vulnerabilities (like SQL injection) for testing Swazz. It should **NOT** be used in production or audited for security issues.

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
- **Formats**: OpenAPI 2.0/3.0, SARIF, JSON

---

## 📚 Documentation

Comprehensive documentation, including installation guides, usage instructions, and architecture details, is available at the [Official Swazz Documentation](https://SecH0us3.github.io/swazz/).

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
