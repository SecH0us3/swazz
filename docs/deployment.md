---
title: Deployment
---

# Production Deployment Guidelines 🚀

This guide outlines the production deployment topology, environment configurations, and security hardening steps required to run Swazz in a secure, scalable, and reliable manner.

---

## 1. Deployment Topology Options

Swazz's hybrid architecture allows for two main deployment models:

```
                  ┌──────────────────────────────┐
                  │   Browser React Dashboard    │
                  └──────────────┬───────────────┘
                                 │ HTTPS / WSS
                                 ▼
                  ┌──────────────────────────────┐
                  │ Cloudflare Edge Coordinator  │
                  │   (Hono Worker + DO + R2)    │
                  └──────────────┬───────────────┘
                                 │ WSS (Auth Challenged)
                                 ▼
                  ┌──────────────────────────────┐
                  │ Go Runner Agent (Isolated)   │
                  └──────────────┬───────────────┘
                                 │ HTTP / HTTPS (SSRF Protected)
                                 ▼
                  ┌──────────────────────────────┐
                  │      Target API Server       │
                  └──────────────────────────────┘
```

### Option A: Cloud Hybrid (Recommended for Teams)
In this model, the control plane is fully managed and serverless, while the scanning runners are hosted on private VM/container instances:
1. **Frontend Dashboard**: Deployed on **Cloudflare Pages** for global, low-latency delivery.
2. **Edge Coordinator**: Deployed as a **Cloudflare Worker** utilizing a **Durable Object** for real-time runner coordination, **SQLite D1** for metadata, and **R2** for object storage.
3. **Go Runner Agent**: Deployed in your own cloud network (GCP, AWS, Azure, or on-premise Kubernetes) running in background agent mode.

### Option B: Self-Hosted Single VM (Recommended for Personal Dev)
The entire stack is deployed on a single virtual machine (VM) using **Docker Compose**:
- React frontend runs behind an **Nginx** container.
- Go backend runs as a containerized service.
- Local SQLite files/databases are mounted via Docker volumes.

---

## 2. Option A: Cloud Hybrid Deployment Walkthrough

### 1. Pre-requisites & Accounts
- A Cloudflare Account (with Workers, D1, and R2 enabled).
- A VM/container host to run the Go engine (e.g., GCP Compute Engine, AWS EC2).

### 2. Coordinator (Cloudflare Workers & D1)
1. Initialize the SQLite D1 database and apply migrations:
   ```bash
   npx wrangler d1 create swazz_db
   npx wrangler d1 migrations apply swazz_db --remote
   ```
2. Configure your environment variables in `wrangler.toml` (or via the Cloudflare dashboard):
   - `AUTH_ENABLED=true`
   - `ALLOWED_ORIGINS=https://dashboard.yourdomain.com`
   - `VERSION=1.0.0`
3. Deploy the coordinator:
   ```bash
   cd packages/edge
   npm run deploy
   ```

### 3. Frontend (Cloudflare Pages)
1. Build the dashboard bundles:
   ```bash
   cd packages/web
   npm run build
   ```
2. Deploy to Cloudflare Pages:
   ```bash
   npm run deploy
   ```
   *(Ensure you configure Pages Custom Domain to match your `ALLOWED_ORIGINS` setting.)*

### 4. Runner Agent Setup (Isolated VM)
1. Generate an Ed25519 keypair for the agent:
   ```bash
   swazz-engine generate-keys
   ```
   This generates `swazz_runner.key` and prints the user public key. Save the public key in your user profile on the Swazz Web Dashboard.
2. Run the agent in daemon/service mode:
   ```bash
   swazz-engine start-agent \
     --coordinator wss://your-coordinator.workers.dev/api/runners/connect \
     --key /path/to/swazz_runner.key \
     --name "production-runner-01"
   ```
   Ensure the service is monitored (e.g., via `systemd` or as a Kubernetes Deployment with a restart policy).

---

## 3. Option B: Self-Hosted Docker Compose Walkthrough

For rapid self-hosted environments:

1. **Clone and Configure Environment**:
   ```bash
   cp .env.example .env
   ```
2. **Configure Hardened Production Values** in `.env`:
   ```env
   # Control ports
   FRONTEND_PORT=80
   BACKEND_PORT=8080

   # Disable debug log verbosity in production
   LOG_LEVEL=info

   # CRITICAL: Define the exact domain hosting the UI
   ALLOWED_ORIGIN=https://swazz.yourdomain.com

   # CRITICAL: Block scanning internal subnets
   SWAZZ_ALLOW_PRIVATE_IPS=false
   ```
3. **Build and Run**:
   ```bash
   docker compose -f compose.yml up -d --build
   ```

---

## 4. Security Hardening Checklist

When deploying Swazz to production, ensure all of the following controls are strictly verified:

| Check | Control | Risk Addressed | Implementation Detail |
| :--- | :--- | :--- | :--- |
| 🛡️ | **Disable Private IP Fuzzing** | Server-Side Request Forgery (SSRF) | Set `SWAZZ_ALLOW_PRIVATE_IPS=false` or ensure `AllowLocalNetwork=false` in Go agent configurations. |
| 🔑 | **Pin Docker Image Tags** | Supply Chain Compromise | In Dockerfiles and Compose configurations, use specific SHA-256 hashes instead of `latest` or mutable version tags. |
| 🌐 | **Restrict CORS Headers** | Cross-Origin Data Leakage | Set `ALLOWED_ORIGIN` (compose) or `ALLOWED_ORIGINS` (Workers) to the exact URL of your frontend dashboard. Never use `*`. |
| 🤖 | **Enable Turnstile CAPTCHA** | Brute-force & Bot registrations | Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` variables to enable Captcha verification during registration/login. |
| 🔒 | **Enforce HTTPS / SSL** | MitM & Token theft | Use a reverse proxy (e.g., Traefik, Nginx) in front of compose deployments to manage SSL termination via Let's Encrypt. |
| 👮 | **Agent Isolation** | Host system compromise | Run target fuzzing runners inside stateless, isolated docker containers or scratch VMs with no connection to the agent's internal subnet. |
