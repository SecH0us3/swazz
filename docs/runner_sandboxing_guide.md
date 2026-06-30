# Swazz Runner Sandboxing Guide

This guide describes best practices for running the `swazz-engine` runner securely in production environments using Docker container sandboxing. 

Security scanning engines inherently handle untrusted inputs (e.g. target schemas, user-supplied wordlists, host names). Sandboxing is critical to ensure that even under a worst-case scenario (e.g., zero-day vulnerability in the Go runtime), the host network and system remain completely secure.

---

## Sandboxing Strategy

To achieve defense-in-depth, we apply a multi-layered sandboxing approach:

```
┌────────────────────────────────────────────────────────┐
│                     Docker Sandbox                     │
│  ┌──────────────────────────────────────────────────┐  │
│  │                   Rootless Exec                  │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │            No Linux Capabilities           │  │  │
│  │  │  ┌──────────────────────────────────────┐  │  │  │
│  │  │  │         Isolated Network /           │  │  │  │
│  │  │  │         safenet CIDR Block           │  │  │  │
│  │  │  └──────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 1. Rootless Container Execution

By default, Docker containers run as the `root` user inside the container namespace. If a container breakout occurs, the attacker may gain root access to the host.

### Solution: Run as Non-Root User
Ensure the container runs as a non-privileged user (such as `nonroot` with UID/GID `65532`).

#### Dockerfile Configuration
The official Swazz Runner Dockerfile is built on top of the secure `gcr.io/distroless/static-debian12:nonroot` base image, which contains no shell, no package manager, and is pre-configured with a dedicated non-privileged user:
```dockerfile
# Run as non-root user (uid 65532)
USER nonroot:nonroot
```

#### Run-time Enforcement
Even if the image does not enforce it, you can override the user at runtime (specifying the distroless nonroot UID/GID):
```bash
docker run --user 65532:65532 swazz-engine:latest
```

---

## 2. Drop Linux Capabilities (`--cap-drop=ALL`)

Linux capabilities split the privileges traditionally associated with superuser (root) into distinct units. By default, Docker grants a subset of these capabilities to containers (like `NET_RAW`, `CHOWN`, `DAC_OVERRIDE`). 

Since `swazz-engine` is a pure Go binary that performs web requests, it does not require **any** special Linux capabilities.

### Run-time Enforcement
Always drop all capabilities when starting the runner:
```bash
docker run --cap-drop=ALL swazz-engine:latest
```

---

## 3. Resource Limiting

Resource exhaustion (Denial of Service) can impact other containers or host services. Docker allows strict limits on CPU and memory consumption.

### Run-time Enforcement
Limit the CPU shares and memory allocation to prevent resource exhaustion attacks:
```bash
docker run \
  --memory="512m" \
  --memory-swap="512m" \
  --cpus="1.0" \
  swazz-engine:latest
```

---

## 4. Network Namespace Sandboxing

A running security engine needs outbound internet access to scan targets but should have absolutely no access to the host's local network, other containers on the same host, or sensitive internal endpoints.

### Solution: Dedicated, Isolated Bridge Network
Do not run the container on the default bridge or host network. Create an isolated user-defined bridge network with customized iptables rules, or run with internet-only access.

#### Example: Running with an Isolated Bridge Network
```bash
# Create a secure user-defined network
docker network create --driver bridge secure-scan-net

# Run the container in the isolated network
docker run --network secure-scan-net swazz-engine:latest
```

#### Blocking Private Access at the Engine Level
The engine itself has an built-in protection mechanism called `safenet` which rejects attempts to resolve or connect to loopback, link-local, private IP ranges (RFC 1918), Carrier-Grade NAT, multicast, and other reserved CIDRs.

---

## Complete Secure Docker Execution Example

Combine all of these controls into a single, production-ready invocation:

```bash
docker run -d \
  --name swazz-runner \
  --user 65532:65532 \
  --read-only \
  --cap-drop=ALL \
  --memory="512m" \
  --cpus="1.0" \
  --security-opt=no-new-privileges:true \
  --network secure-scan-net \
  swazz-engine:latest \
  --config /app/swazz.config.json
```

### Explanations of Security Flags:
| Flag | Security Benefit |
| :--- | :--- |
| `--user 65532:65532` | Runs the process under a non-root UID/GID (default distroless nonroot user). |
| `--read-only` | Mounts the container's root filesystem as read-only. |
| `--cap-drop=ALL` | Removes all Linux kernel capabilities. |
| `--memory="512m"` | Restricts RAM usage to 512MB to prevent OOM/DoS. |
| `--cpus="1.0"` | Limits CPU usage to a maximum of 1 core. |
| `--security-opt=no-new-privileges:true` | Prevents tasks from gaining new privileges via `setuid` or `setgid` binaries. |
| `--network secure-scan-net` | Connects the container to an isolated, non-default network namespace. |
