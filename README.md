# ⚡️ swazz — Smart API Fuzzer

[![CI](https://github.com/SecH0us3/swazz/actions/workflows/ci.yml/badge.svg)](https://github.com/SecH0us3/swazz/actions)
[![SARIF](https://img.shields.io/badge/report-SARIF-blueviolet)](https://sarifweb.azurewebsites.net/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**swazz** is a modern, smart API fuzzer designed for security researchers and developers. It parses OpenAPI (Swagger) specifications to automatically identify crashes, logic flaws, and security vulnerabilities (XSS, Injection, etc.) through intelligent payload generation.

---

## 🚀 Key Features

- **⚡️ Smart Fuzzing**: Context-aware payload generation based on parameter types and schemas.
- **🔐 Auth Pipelines**: Support for complex, multi-step authentication sequences (login -> cookie collection -> fuzzing).
- **🎯 Precision Control**: Define custom rules to ignore specific status codes or elevate them to errors/warnings.
- **📊 Professional Reporting**: Export findings in **SARIF** (for CI/CD integration), **JSON**, or standalone **HTML** reports.
- **🛠 Interactive Wizard**: Fast setup with `swazz-engine wizard` — no manual JSON editing required.
- **🌐 Web Dashboard**: Real-time Heatmap and Request Inspector for deep-dive analysis.

---

## 📦 Installation

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

---

## ⚙️ Configuration Example

`swazz` uses a flexible JSON configuration for fine-grained control:

```json
{
  "swagger_urls": ["https://api.example.com/swagger.json"],
  "base_url": "https://api.example.com/v1",
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

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
