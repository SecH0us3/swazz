# Kubernetes Deployment Guide

Swazz provides an official Helm chart to deploy the entire application stack—Web UI, Edge Coordinator API, and scalable Runner Agents—to a Kubernetes cluster.

## Prerequisites

- **Kubernetes Cluster**: A running cluster (e.g., Minikube, Docker Desktop, EKS, GKE, or AKS).
- **Helm**: Helm v3 installed locally.

## Deployment Architecture

The deployment consists of four main components:
1. **Web UI**: The React frontend dashboard.
2. **Edge Coordinator API**: The central API that manages projects, runner connections, and vulnerabilities.
3. **Runner Agents**: The worker nodes that execute DAST scanning and fuzzing. These can be horizontally scaled depending on your scanning load.
4. **MCP Auto-Discovery CronJob**: Scheduled worker that scans Kubernetes namespaces for MCP-annotated services, probes endpoints, generates fuzzing configs, and executes automated DAST security scans.

## Quick Start

1. **Clone the repository** (or navigate to your local copy):
   ```bash
   git clone https://github.com/SecH0us3/swazz.git
   cd swazz
   ```

2. **Configure your values**
   Copy the default `values.yaml` or create an override file (`my-values.yaml`) to set your environment variables, specifically `global.jwtSecret` and optional discovery settings:
   ```yaml
   global:
     domain: swazz.yourdomain.com
     jwtSecret: "YOUR_SUPER_SECRET_JWT_KEY"

   runner:
     replicaCount: 3 # Scale your fuzzers
     env:
       RUNNER_TOKEN: "your_custom_token"

   discovery:
     enabled: true # Enable Kubernetes MCP Auto-Discovery
     schedule: "0 2 * * *" # Every day at 02:00 UTC
     reports:
       uploadTo: "coordinator"
       coordinatorURL: "http://swazz-edge:80"
       coordinatorToken: "swazz_live_default_token"
   ```

3. **Install the Chart**
   Run the following command from the root of the repository:
   ```bash
   helm install swazz ./deploy/helm/swazz -f my-values.yaml --namespace swazz-security --create-namespace
   ```

4. **Verify the Deployment**
   Check that all pods are running:
   ```bash
   kubectl get pods -n swazz-security
   ```

## Configuration Reference

Key values you can configure in `values.yaml`:

| Parameter | Description | Default |
| --- | --- | --- |
| `global.domain` | The base domain for ingress routing | `swazz.local` |
| `global.jwtSecret` | Secret used to sign authentication tokens | `change-me-in-production` |
| `web.replicaCount` | Number of frontend pods | `1` |
| `edge.replicaCount` | Number of coordinator API pods | `1` |
| `runner.replicaCount` | Number of fuzzer agent pods | `1` |
| `discovery.enabled` | Enable Kubernetes MCP Auto-Discovery CronJob | `false` |
| `discovery.schedule` | Cron schedule for discovery jobs | `0 2 * * *` |
| `discovery.concurrency` | Concurrent MCP probes and scan workers | `5` |
| `discovery.iterations` | Iterations per fuzzing profile | `10` |
| `discovery.profiles` | Fuzzing profiles to apply | `BOUNDARY,MALICIOUS` |
| `discovery.excludeNamespaces` | Comma-separated namespaces to exclude | `kube-system,kube-public,kube-node-lease` |
| `discovery.reports.uploadTo` | Report upload target (`local` or `coordinator`) | `local` |
| `discovery.reports.sarif` | Generate SARIF format reports | `true` |
| `discovery.reports.html` | Generate HTML format reports | `true` |

## Kubernetes MCP Auto-Discovery

To enable Swazz to automatically discover and scan MCP servers running in your cluster, annotate your target Kubernetes Services with standard `mcp.network/*` annotations:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-mcp-service
  namespace: prod
  annotations:
    mcp.network/enabled: "true"
    mcp.network/port: "8080"
    mcp.network/path: "/mcp"
    mcp.network/transport: "http" # "http" or "sse"
    mcp.network/name: "Production MCP Server"
    mcp.network/auth-secret: "mcp-auth-token" # (Optional) K8s secret containing 'token' key
spec:
  ports:
    - port: 8080
      targetPort: 8080
  selector:
    app: my-mcp-service
```

When the discovery CronJob runs, it queries the Kubernetes API for annotated services, verifies endpoint health via MCP handshake (`initialize` + `tools/list`), builds scan configs, and runs vulnerability scans automatically.

## Scaling Runner Agents

The Runner Agents perform the heavy lifting. To increase scanning capacity, simply increase the `runner.replicaCount` in your `values.yaml` and upgrade the release:
```bash
helm upgrade swazz ./deploy/helm/swazz -f my-values.yaml -n swazz-security
```
You can also set up a Horizontal Pod Autoscaler (HPA) to scale the runners dynamically based on CPU/Memory usage.

## Ingress Setup

By default, the chart provisions an Ingress resource utilizing the `nginx` ingress class. It routes traffic based on the `global.domain` value:
- `https://swazz.yourdomain.com/` → Web UI
- `https://swazz.yourdomain.com/api` → Coordinator API

Ensure your cluster has an Ingress controller running and your DNS records point to the controller's external IP.
