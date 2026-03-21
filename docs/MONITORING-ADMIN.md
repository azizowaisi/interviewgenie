# Admin monitoring dashboard (`admin.interviewgenie.teckiz.com`)

Lightweight **in-cluster** monitoring: one pod (`monitoring-service`) serves a small **FastAPI** JSON API plus a static **admin UI** (no Prometheus/Grafana).

## What you get

- **Cluster overview**: node readiness, pod counts, CPU/memory **when metrics-server works**
- **Services** & **pods** tables with usage (from Metrics API)
- **Logs**: `GET /api/logs?pod=...` (same as `kubectl logs`)
- **Restart**: rollout restart for **allowed Deployments** only (`POST /api/restart?deployment=...`)

## DNS & TLS

1. Create **`A`** record: `admin.interviewgenie.teckiz.com` → your VM IP (same as main app).
2. Apply manifests (`kubectl apply -k k8s/`). Traefik **IngressRoute** `interview-ai-admin` requests a Let’s Encrypt cert for the admin host (same `certResolver: le` pattern as the main site).

## URLs

| URL | Purpose |
|-----|---------|
| `https://admin.interviewgenie.teckiz.com/` | Dashboard (same UI as below) |
| `https://admin.interviewgenie.teckiz.com/admin/` | Dashboard (hash routes: `#/`, `#/services`, `#/pods`, `#/logs`) |

## metrics-server (k3s)

HPA and this dashboard need **metrics-server**. k3s often includes it. If `kubectl top nodes` fails, install or patch:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# k3s: add arg to deployment
#   --kubelet-insecure-tls
kubectl -n kube-system edit deployment metrics-server
```

## API (optional token)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Liveness |
| GET | `/api/cluster` | Overview JSON |
| GET | `/api/pods` | Pods in `TARGET_NAMESPACE` |
| GET | `/api/services` | Services in namespace |
| GET | `/api/logs?pod=&container=&tail=` | Pod logs (text) |
| POST | `/api/restart?deployment=` | Rollout restart (allowlist) |

If Secret **`monitoring-admin`** exists with key **`ADMIN_TOKEN`**, all `/api/*` routes require header **`X-Admin-Token: <value>`** or **`Authorization: Bearer <value>`**. The UI stores the token in `localStorage` when you type it in the header bar.

Create the secret:

```bash
kubectl create secret generic monitoring-admin \
  -n interview-ai \
  --from-literal=ADMIN_TOKEN='your-long-random-string'
kubectl rollout restart deployment/monitoring-service -n interview-ai
```

## RBAC

- **Role** in `interview-ai`: pods, pods/log, services, deployments (patch), pod metrics.
- **ClusterRole**: nodes + node metrics (for overview).

Restart is limited to deployments listed in env **`RESTARTABLE_DEPLOYMENTS`** on the monitoring Deployment (default includes app services + ollama + whisper). **MongoDB** is a **StatefulSet** — the UI does not offer deployment restart for `mongo`/`mongodb` services; use `kubectl` if needed.

## Resource footprint

Deployment defaults: **requests** 50m CPU / 128Mi RAM, **limits** 500m CPU / 384Mi RAM (stays under ~500MB RAM).

## Building the image

Same as other services:

```bash
docker build -t interview-ai/monitoring-service:latest ./backend/monitoring-service
```

CI builds `monitoring-service` when `SERVICES` includes it in `.github/workflows/build-and-deploy.yml`.

## Nginx on the VM

If you terminate TLS on the VM with Nginx instead of Traefik, proxy to the **ClusterIP** service or NodePort you expose; the example `proxy_pass http://localhost:3001` matches a local port-forward:

```bash
kubectl port-forward -n interview-ai svc/monitoring-service 3001:3001
```

In production with k3s, prefer the **IngressRoute** in `k8s/ingress/admin-ingressroute.yaml`.
