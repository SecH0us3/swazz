# Swazz Runner: Docker Images Guide

The Swazz Local Runner (`swazz-engine`) is designed to run securely in any environment. Because different environments have different requirements (e.g., maximum security vs. CI compatibility vs. AI CLI support), we provide multiple Dockerfiles in the `packages/container/` directory.

Choose the one that best fits your use case.

---

## 1. Minimal / Standalone (Maximum Security)

**File:** `packages/container/Dockerfile`
**Base Image:** `gcr.io/distroless/static-debian12`

This is the default image. It uses Google's Distroless base image, which means it contains **no shell** (`/bin/sh`), no package managers, and almost zero attack surface.

**Use Case:** 
- Running the runner on an isolated VM or standalone Docker host.
- Kubernetes deployments where maximum security is required.
- Environments where you do *not* need to execute arbitrary scripts or AI CLIs.

**How to build & run:**
```bash
docker build -t swazz-runner:latest -f packages/container/Dockerfile packages/container/
docker run -e SWAZZ_API_KEY="your-key" swazz-runner:latest
```

*(Note: This image will **not** work natively as a GitLab CI script runner because GitLab requires `/bin/sh` to inject pipeline steps).*

---

## 2. CI/CD Environments (GitLab, GitHub Actions)

**File:** `packages/container/Dockerfile.ci`
**Base Image:** `alpine:latest`

This image is built on Alpine Linux and adds `bash`, `curl`, `jq`, and `git`. It includes a shell (`/bin/sh`), which is strictly required by CI/CD platforms like GitLab CI to inject pipeline scripts.

**Use Case:**
- You want to use Swazz as a GitLab CI Runner or in GitHub Actions.
- You need to execute basic pre-scan or post-scan shell scripts.
- You need `git` to clone repositories or check out specific branches before scanning.

**How to build & run:**
```bash
docker build -t swazz-runner:ci -f packages/container/Dockerfile.ci packages/container/
docker run -e SWAZZ_API_KEY="your-key" swazz-runner:ci
```

---

## 3. Specialized AI & Remediation Images (Inheritance)

For Auto-Fix and Remediation capabilities, we use **Docker Inheritance**. Instead of copying the base CI tools into every file, our specialized images (`Dockerfile.ai`, `Dockerfile.node`, `Dockerfile.dotnet`) inherit from `swazz-runner:ci`.

**Important Requirement:** You MUST build the CI image first before building these:
```bash
docker build -t swazz-runner:ci -f packages/container/Dockerfile.ci packages/container/
```

### 3a. AI Remediation (Fat Image)
**File:** `packages/container/Dockerfile.ai`
Bundles multiple runtimes (Node.js, Python 3) and CLI tools (`gh`, `glab`, `claude-cli`, `agy`). Use this if you have custom AI prompts using Python or Node CLIs.

**How to build:**
```bash
docker build -t swazz-runner:ai -f packages/container/Dockerfile.ai packages/container/
```

### 3b. Node.js Environment
**File:** `packages/container/Dockerfile.node`
Adds Node.js and Yarn to the CI image. Ideal if your project relies on Node and you want the runner to be able to execute `npm run build` or `npm run test` as part of the auto-remediation workflow.

### 3c. .NET Environment
**File:** `packages/container/Dockerfile.dotnet`
Adds the .NET 8 SDK to the CI image for compiling or testing C# projects during remediation.

---

## Best Practices

1. **Never hardcode secrets** inside the Dockerfiles. Always pass them at runtime using `-e` or a `.env` file.
2. **Resource Limits:** The runner can consume significant memory during intensive fuzzing. Set memory limits when running:
   ```bash
   docker run --memory="512m" --cpus="1.0" swazz-runner:latest
   ```
3. **Network Isolation:** For ultimate security, consider running the runner in a network namespace that can only reach your target application and the Swazz API, blocking outbound access to untrusted domains.
