---
layout: default
title: Home
---

# Swazz: Smart API Fuzzer ⚡️

Welcome to the official documentation for **Swazz**! 

Swazz is an advanced, high-performance Smart API Fuzzer designed to identify crashes, logic flaws, and security vulnerabilities (such as XSS, SQL injection, and boundary bypassing) by automatically parsing your Swagger/OpenAPI specifications.

## 🌟 Key Features

- **Smart Payload Generation**: Automatically generates context-aware payloads based on API schema definitions (e.g., proper UUIDs, massive strings, malicious payloads).
- **Hybrid Architecture**: Fast Go-based execution engine (`packages/container`) paired with a modern React 19 web dashboard (`packages/web`).
- **Interactive Web UI**: Features a real-time Endpoint × Status heatmap, dynamic request inspector, and easy configuration management.
- **Robust CLI**: Run headless CI/CD integrations with high concurrency and detailed reporting.
- **Cloudflare Ready**: Built-in support for Edge deployment.

## 🧭 Navigation

Explore the documentation to get started and master Swazz:

- [Installation Guide](./installation.html) - Learn how to build and install Swazz.
- [Usage & Configuration](./usage.html) - Discover CLI and Web UI usage.
- [CI/CD Integration](./ci_cd.html) - Integrate Swazz into GitHub Actions, GitLab CI, and more with SARIF reporting.
- [Architecture & Internals](./architecture.html) - Deep dive into the hybrid architecture and source code structure.

---
*Built with ❤️ for secure and reliable APIs.*
