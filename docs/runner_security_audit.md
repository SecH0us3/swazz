# Swazz Runner Security Audit

This document details the security model, architecture, and threat profile of the Swazz Runner execution engine. The runner is designed from the ground up for safe, restricted execution of security scans, ensuring it cannot be exploited to compromise the host system.

---

## 1. Execution Sandbox & Process Isolation

The Swazz Runner operates with a zero-trust model regarding system execution. It contains **absolutely no capabilities** for command execution or interactive shell invocation.

### Zero Shell Execution
* **No `os/exec` imports:** The runner codebase contains zero imports of Go's `os/exec` package. It does not spawn subprocesses, execute system commands (`bash`, `sh`, etc.), or run external binaries.
* **No Command Evaluation:** All request parsing, HTTP fuzzing, and analysis are performed purely in memory via Go's native standard library packages (`net/http`, `encoding/json`, etc.). There is no risk of command injection because there is no command interpreter invoked at any point in the runner lifecycle.

---

## 2. File System Access Controls

The filesystem permissions of the runner are strictly limited to read-only operations on a minimal set of necessary resources.

### Read-Only Constraints
* **Configuration & Wordlists:** The runner only requires read access to load its configuration file (e.g., `swazz.config.json`) and specific local wordlists used for parameter and path discovery.
* **No Write Operations:** The runner does not write to the host disk. Logs are written exclusively to `stdout`/`stderr` (which can be captured by a logging agent), and scan results are either returned via HTTP response or structured JSON output to stdout.
* **No File Uploads/Persistence:** No temporary files, cache databases, or execution state are persisted on disk, minimizing the risk of disk space exhaustion or unauthorized file modification/creation.

---

## 3. Credential & Identity Exposure Protection

The runner is designed to execute stateless security scans without accessing or carrying sensitive credentials.

### Credential Isolation
* **No Host Credentials Bound:** The runner does not require root permissions, host SSH keys, AWS/cloud metadata credentials, or administrative system tokens to operate.
* **Env Var Sanitization:** The runner does not read host environment variables containing system secrets. 
* **Target Network Restrictions:** As verified by the `safenet` package security controls, the runner explicitly blocks access to cloud metadata service endpoints (e.g., `169.254.169.254`) and private subnets, preventing target scanning from leaking system-level or infrastructure-level credentials.
